/**
 * 飞虹 Code - 能力来源域路由（B2② 拆分自 web/server.ts 1834-2824）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 包含区块：
 * - 节点系统（Plugin Node）：连接外部节点，扩展插件/模板/能力来源
 * - 技能市场（插件市场）：聚合 ClawHub + Agent-Foundry + 自定义节点 + 自定义来源
 * - 自动化：快捷指令集（一键发起任务）
 * - 模板库
 * - 办公助理：内置能力清单 + 节点能力 + 自定义来源
 *
 * 依赖经 deps 显式注入（homeDir/queue/loadJsonFile/saveJsonFile），
 * 本模块不得反向 import web/server 或 cli/*。
 */
import express, { type Request, type Response } from 'express';
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import dns from 'node:dns';
import { publicTask, type TaskQueue } from '../task-queue';

type ExpressApp = ReturnType<typeof express>;

export interface CapabilitySourceDeps {
  homeDir: string;
  queue: TaskQueue;
  loadJsonFile: <T>(file: string, fallback: T) => T;
  saveJsonFile: (file: string, data: unknown) => boolean;
}

export function registerCapabilitySourceRoutes(app: ExpressApp, deps: CapabilitySourceDeps): void {
  const { homeDir, queue, loadJsonFile, saveJsonFile } = deps;
  /* ========== 节点系统（Plugin Node）：连接外部节点，扩展插件/模板/能力来源 ========== */
  interface PluginNode {
    id: string;
    name: string;
    type: 'http' | 'git' | 'local';
    url: string;
    apiKey?: string;
    capabilities: string[]; // templates / skills / office
    status: 'connected' | 'disconnected' | 'error';
    lastSyncAt?: string;
    lastError?: string;
    enabled: boolean;
    createdAt: string;
  }
  interface CustomSource {
    id: string;
    name: string;
    type: 'templates' | 'skills' | 'office';
    nodeId?: string;
    url: string;
    enabled: boolean;
    createdAt: string;
  }
  interface NodeTemplate {
    id: string;
    title: string;
    category: string;
    goal: string;
    icon: string;
    source: string;
    nodeId?: string;
  }
  interface NodeSkill {
    id: string;
    name: string;
    description: string;
    source: string;
    author?: string;
    category: string;
    tags: string[];
    downloads: number;
    installHint: string;
    homepage: string;
    rawUrl: string;
    nodeId?: string;
  }
  interface NodeOfficeCapability {
    id: string;
    icon: string;
    title: string;
    desc: string;
    prompt: string;
    source: string;
    nodeId?: string;
  }

  const nodesFile = join(homeDir, 'nodes.json');
  const sourcesFile = join(homeDir, 'sources.json');
  const nodeDataDir = join(homeDir, 'node-data');

  function loadNodes(): PluginNode[] {
    const list = loadJsonFile<PluginNode[]>(nodesFile, []);
    return Array.isArray(list) ? list : [];
  }
  function saveNodes(list: PluginNode[]): boolean {
    return saveJsonFile(nodesFile, list);
  }
  function loadSources(): CustomSource[] {
    const list = loadJsonFile<CustomSource[]>(sourcesFile, []);
    return Array.isArray(list) ? list : [];
  }
  function saveSources(list: CustomSource[]): boolean {
    return saveJsonFile(sourcesFile, list);
  }
  function loadNodeData<T>(nodeId: string, type: string, fallback: T): T {
    const file = join(nodeDataDir, nodeId, `${type}.json`);
    return loadJsonFile<T>(file, fallback);
  }
  function saveNodeData<T>(nodeId: string, type: string, data: T): boolean {
    const file = join(nodeDataDir, nodeId, `${type}.json`);
    return saveJsonFile(file, data);
  }

  // 测试节点连接
  async function testNodeConnection(node: PluginNode): Promise<{ ok: boolean; error?: string; capabilities?: string[] }> {
    try {
      if (node.type === 'local') {
        const dir = resolve(node.url);
        if (!existsSync(dir) || !statSync(dir).isDirectory()) {
          return { ok: false, error: '本地目录不存在' };
        }
        const caps: string[] = [];
        if (existsSync(join(dir, 'templates.json'))) caps.push('templates');
        if (existsSync(join(dir, 'skills.json'))) caps.push('skills');
        if (existsSync(join(dir, 'office.json'))) caps.push('office');
        return { ok: true, capabilities: caps.length ? caps : node.capabilities };
      }
      // http / git 类型：请求节点的 /api/health 或 manifest
      const url = node.type === 'http'
        ? node.url.replace(/\/$/, '') + '/api/health'
        : node.url;
      const headers: Record<string, string> = { 'User-Agent': 'fhcode-node/1.0' };
      if (node.apiKey) headers['Authorization'] = 'Bearer ' + node.apiKey;
      const r = await fetchWithRetry(url, 25000, 0);
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      if (node.type === 'http') {
        const data = await r.json().catch(() => ({}));
        return { ok: true, capabilities: Array.isArray(data.capabilities) ? data.capabilities : node.capabilities };
      }
      return { ok: true, capabilities: node.capabilities };
    } catch (e: any) {
      return { ok: false, error: e?.message || '连接失败' };
    }
  }

  // 从节点同步数据
  async function syncNodeData(node: PluginNode): Promise<{ ok: boolean; error?: string; synced: string[] }> {
    const synced: string[] = [];
    try {
      if (node.type === 'local') {
        const dir = resolve(node.url);
        for (const cap of node.capabilities) {
          const file = join(dir, `${cap}.json`);
          if (existsSync(file)) {
            const data = JSON.parse(readFileSync(file, 'utf8'));
            saveNodeData(node.id, cap, data);
            synced.push(cap);
          }
        }
        return { ok: true, synced };
      }
      // http 类型
      if (node.type === 'http') {
        const base = node.url.replace(/\/$/, '');
        const headers: Record<string, string> = { 'User-Agent': 'fhcode-node/1.0' };
        if (node.apiKey) headers['Authorization'] = 'Bearer ' + node.apiKey;
        for (const cap of node.capabilities) {
          try {
            const r = await fetch(`${base}/api/node/${cap}`, { headers, signal: AbortSignal.timeout(15000) });
            if (r.ok) {
              const data = await r.json();
              const list = Array.isArray(data) ? data : (data.items || data.list || []);
              saveNodeData(node.id, cap, list);
              synced.push(cap);
            }
          } catch { /* skip */ }
        }
        return { ok: true, synced };
      }
      // git 类型：暂不支持自动 clone，标记为需手动同步
      return { ok: false, error: 'Git 节点暂不支持自动同步，请使用本地目录方式', synced };
    } catch (e: any) {
      return { ok: false, error: e?.message || '同步失败', synced };
    }
  }

  // 节点 CRUD
  app.get('/api/nodes', (_req: Request, res: Response) => {
    const nodes = loadNodes().map((n) => {
      const { apiKey, ...rest } = n;
      return { ...rest, hasApiKey: !!apiKey };
    });
    res.json({ ok: true, nodes });
  });
  app.post('/api/nodes', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const type = (['http', 'git', 'local'] as const).find((t) => t === body.type) || 'http';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined;
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((c: string) => ['templates', 'skills', 'office'].includes(c)) : ['templates', 'skills', 'office'];
    if (!name || !url) {
      res.status(400).json({ ok: false, error: '缺少 name 或 url 字段' });
      return;
    }
    const node: PluginNode = {
      id: `node_${Date.now()}_${randomUUID().slice(0, 4)}`,
      name, type, url, apiKey, capabilities,
      status: 'disconnected',
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const list = loadNodes();
    list.push(node);
    if (!saveNodes(list)) {
      res.status(500).json({ ok: false, error: '节点保存失败' });
      return;
    }
    // 自动测试连接
    const test = await testNodeConnection(node);
    node.status = test.ok ? 'connected' : 'error';
    node.lastError = test.error;
    if (test.capabilities) node.capabilities = test.capabilities;
    saveNodes(list);
    res.status(201).json({ ok: true, node: { ...node, apiKey: undefined, hasApiKey: !!apiKey }, connection: test });
  });
  app.put('/api/nodes/:id', async (req: Request, res: Response) => {
    const list = loadNodes();
    const idx = list.findIndex((n) => n.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ ok: false, error: '节点不存在' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, any>;
    const node = list[idx];
    if (typeof body.name === 'string' && body.name.trim()) node.name = body.name.trim();
    if (typeof body.url === 'string' && body.url.trim()) node.url = body.url.trim();
    if (typeof body.type === 'string' && ['http', 'git', 'local'].includes(body.type)) node.type = body.type as PluginNode['type'];
    if (typeof body.apiKey === 'string') node.apiKey = body.apiKey.trim() ? body.apiKey.trim() : undefined;
    if (Array.isArray(body.capabilities)) node.capabilities = body.capabilities.filter((c: string) => ['templates', 'skills', 'office'].includes(c));
    if (typeof body.enabled === 'boolean') node.enabled = body.enabled;
    if (!saveNodes(list)) {
      res.status(500).json({ ok: false, error: '节点更新失败' });
      return;
    }
    res.json({ ok: true, node: { ...node, apiKey: undefined, hasApiKey: !!node.apiKey } });
  });
  app.delete('/api/nodes/:id', (req: Request, res: Response) => {
    const list = loadNodes();
    const next = list.filter((n) => n.id !== req.params.id);
    if (next.length === list.length) {
      res.status(404).json({ ok: false, error: '节点不存在' });
      return;
    }
    if (!saveNodes(next)) {
      res.status(500).json({ ok: false, error: '节点删除失败' });
      return;
    }
    res.json({ ok: true });
  });
  app.post('/api/nodes/:id/test', async (req: Request, res: Response) => {
    const node = loadNodes().find((n) => n.id === req.params.id);
    if (!node) {
      res.status(404).json({ ok: false, error: '节点不存在' });
      return;
    }
    const test = await testNodeConnection(node);
    // 更新节点状态
    const list = loadNodes();
    const idx = list.findIndex((n) => n.id === node.id);
    if (idx >= 0) {
      list[idx].status = test.ok ? 'connected' : 'error';
      list[idx].lastError = test.error;
      if (test.capabilities) list[idx].capabilities = test.capabilities;
      saveNodes(list);
    }
    res.json({ ok: test.ok, error: test.error, capabilities: test.capabilities });
  });
  app.post('/api/nodes/:id/sync', async (req: Request, res: Response) => {
    const node = loadNodes().find((n) => n.id === req.params.id);
    if (!node) {
      res.status(404).json({ ok: false, error: '节点不存在' });
      return;
    }
    const result = await syncNodeData(node);
    const list = loadNodes();
    const idx = list.findIndex((n) => n.id === node.id);
    if (idx >= 0) {
      list[idx].lastSyncAt = new Date().toISOString();
      list[idx].status = result.ok ? 'connected' : 'error';
      list[idx].lastError = result.error;
      saveNodes(list);
    }
    res.json({ ok: result.ok, error: result.error, synced: result.synced });
  });

  // 自定义来源 CRUD
  app.get('/api/sources', (_req: Request, res: Response) => {
    res.json({ ok: true, sources: loadSources() });
  });
  app.post('/api/sources', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const type = (['templates', 'skills', 'office'] as const).find((t) => t === body.type);
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const nodeId = typeof body.nodeId === 'string' && body.nodeId.trim() ? body.nodeId.trim() : undefined;
    if (!name || !type || !url) {
      res.status(400).json({ ok: false, error: '缺少 name / type / url 字段' });
      return;
    }
    const source: CustomSource = {
      id: `src_${Date.now()}_${randomUUID().slice(0, 4)}`,
      name, type, url, nodeId,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const list = loadSources();
    list.push(source);
    if (!saveSources(list)) {
      res.status(500).json({ ok: false, error: '来源保存失败' });
      return;
    }
    res.status(201).json({ ok: true, source });
  });
  app.put('/api/sources/:id', (req: Request, res: Response) => {
    const list = loadSources();
    const idx = list.findIndex((s) => s.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ ok: false, error: '来源不存在' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, any>;
    const source = list[idx];
    if (typeof body.name === 'string' && body.name.trim()) source.name = body.name.trim();
    if (typeof body.url === 'string' && body.url.trim()) source.url = body.url.trim();
    if (typeof body.enabled === 'boolean') source.enabled = body.enabled;
    if (typeof body.nodeId === 'string') source.nodeId = body.nodeId.trim() || undefined;
    if (!saveSources(list)) {
      res.status(500).json({ ok: false, error: '来源更新失败' });
      return;
    }
    res.json({ ok: true, source });
  });
  app.delete('/api/sources/:id', (req: Request, res: Response) => {
    const list = loadSources();
    const next = list.filter((s) => s.id !== req.params.id);
    if (next.length === list.length) {
      res.status(404).json({ ok: false, error: '来源不存在' });
      return;
    }
    if (!saveSources(next)) {
      res.status(500).json({ ok: false, error: '来源删除失败' });
      return;
    }
    res.json({ ok: true });
  });

  // 从所有启用的节点收集数据
  function collectNodeTemplates(): NodeTemplate[] {
    const result: NodeTemplate[] = [];
    for (const node of loadNodes()) {
      if (!node.enabled || !node.capabilities.includes('templates')) continue;
      const data = loadNodeData<NodeTemplate[]>(node.id, 'templates', []);
      if (Array.isArray(data)) {
        result.push(...data.map((t) => ({ ...t, source: node.name, nodeId: node.id })));
      }
    }
    return result;
  }
  function collectNodeSkills(): NodeSkill[] {
    const result: NodeSkill[] = [];
    for (const node of loadNodes()) {
      if (!node.enabled || !node.capabilities.includes('skills')) continue;
      const data = loadNodeData<NodeSkill[]>(node.id, 'skills', []);
      if (Array.isArray(data)) {
        result.push(...data.map((s) => ({ ...s, source: node.name, nodeId: node.id })));
      }
    }
    return result;
  }
  function collectNodeOffice(): NodeOfficeCapability[] {
    const result: NodeOfficeCapability[] = [];
    for (const node of loadNodes()) {
      if (!node.enabled || !node.capabilities.includes('office')) continue;
      const data = loadNodeData<NodeOfficeCapability[]>(node.id, 'office', []);
      if (Array.isArray(data)) {
        result.push(...data.map((c) => ({ ...c, source: node.name, nodeId: node.id })));
      }
    }
    return result;
  }

  /* ========== 技能市场（插件市场）：聚合 ClawHub + Agent-Foundry + 自定义节点 + 自定义来源 ========== */
  const CLAWHUB_API = 'https://clawhub.ai/api/v1/skills';
  const AGENT_FOUNDRY_CATALOG =
    'https://raw.githubusercontent.com/hebertzhu/agent-foundry/main/catalog/skills-catalog.json';

  async function fetchWithRetry(url: string, timeoutMs = 25000, retries = 1): Promise<any> {
    // 强制 IPv4 优先：规避 IPv6 链路故障（部分网络 IPv6 路由不可达时，
    // 默认 verbatim 解析会优先走 IPv6 导致连接超时/失败）。幂等，重复调用无副作用。
    dns.setDefaultResultOrder('ipv4first');
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'User-Agent': 'fhcode-web/0.5.1' },
        });
        clearTimeout(timer);
        return r;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (attempt < retries) await new Promise((res) => setTimeout(res, 500));
      }
    }
    throw lastErr;
  }

  interface MarketSkill {
    id: string;
    name: string;
    description: string;
    source: string;
    author?: string;
    category: string;
    tags: string[];
    downloads: number;
    installHint: string;
    homepage: string;
    rawUrl: string;
  }

  async function fetchClawHubSkills(keyword: string, limit: number): Promise<MarketSkill[]> {
    try {
      const url = `${CLAWHUB_API}?limit=${limit}${keyword ? `&q=${encodeURIComponent(keyword)}` : ''}`;
      const r = await fetchWithRetry(url);
      if (!r.ok) return [];
      const data = (await r.json()) as { items?: Array<Record<string, any>> };
      return (data.items || []).map((it) => ({
        id: `clawhub:${String(it.slug || '')}`,
        name: String(it.displayName || it.slug || ''),
        description: String(it.summary || it.description || ''),
        source: 'clawhub',
        author: it.slug ? String(it.slug).split('/')[0] : undefined,
        category: 'market',
        tags: Array.isArray(it.topics) ? it.topics : [],
        downloads: Number(it.stats?.downloads ?? 0),
        installHint: `npx skills add ${String(it.slug || '')}`,
        homepage: `https://clawhub.ai/${String(it.slug || '')}`,
        rawUrl: `https://clawhub.ai/${String(it.slug || '')}`,
      }));
    } catch (e) {
      console.error('[clawhub] fetch failed:', e);
      return [];
    }
  }

  async function fetchAgentFoundrySkills(keyword: string, limit: number): Promise<MarketSkill[]> {
    try {
      const r = await fetchWithRetry(AGENT_FOUNDRY_CATALOG, 30000);
      if (!r.ok) return [];
      const data = (await r.json()) as { skills?: Array<Record<string, any>> };
      const arr = Array.isArray(data.skills) ? data.skills : [];
      let list = arr.map((it) => {
        const name = String(it.name || '');
        const publicPath = String(it.public_path || '');
        const category = String(it.category || 'market');
        const rawUrl = publicPath
          ? `https://raw.githubusercontent.com/hebertzhu/agent-foundry/main/${publicPath}`
          : `https://github.com/hebertzhu/agent-foundry`;
        return {
          id: `agent-foundry:${name}`,
          name,
          description: `Agent-Foundry 技能包 · 分类：${category}${publicPath ? ` · 源：${publicPath}` : ''}`,
          source: 'agent-foundry',
          author: 'hebertzhu',
          category,
          tags: Array.isArray(it.packs) ? it.packs : [category],
          downloads: 0,
          installHint: `npm i -g @agent-foundry/cli && agent-foundry install ${name}`,
          homepage: `https://github.com/hebertzhu/agent-foundry`,
          rawUrl,
        };
      });
      if (keyword) {
        const kw = keyword.toLowerCase();
        list = list.filter(
          (s) =>
            s.name.toLowerCase().includes(kw) ||
            s.description.toLowerCase().includes(kw) ||
            (s.tags || []).some((t) => t.toLowerCase().includes(kw)),
        );
      }
      return list.slice(0, limit);
    } catch (e) {
      console.error('[agent-foundry] fetch failed:', e);
      return [];
    }
  }

  app.get('/api/skills/market', async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const source = typeof req.query.source === 'string' ? req.query.source : 'all';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    let results: MarketSkill[] = [];
    if (source === 'clawhub' || source === 'all')
      results = results.concat(await fetchClawHubSkills(q, limit));
    if (source === 'agent-foundry' || source === 'all')
      results = results.concat(await fetchAgentFoundrySkills(q, limit));
    // 从节点同步的技能
    if (source === 'node' || source === 'all') {
      const nodeSkills = collectNodeSkills();
      results = results.concat(nodeSkills.map((s) => ({
        id: `node:${s.id}`,
        name: s.name,
        description: s.description,
        source: s.source,
        author: s.author,
        category: s.category,
        tags: s.tags,
        downloads: s.downloads,
        installHint: s.installHint,
        homepage: s.homepage,
        rawUrl: s.rawUrl,
      })));
    }
    // 从自定义来源拉取技能（HTTP URL 返回 JSON 数组）
    if (source === 'custom' || source === 'all') {
      for (const src of loadSources()) {
        if (!src.enabled || src.type !== 'skills') continue;
        try {
          const r = await fetchWithRetry(src.url, 25000, 0);
          if (r.ok) {
            const data = await r.json();
            const list = Array.isArray(data) ? data : (data.items || data.skills || []);
            results = results.concat(list.map((s: any) => ({
              id: `custom:${src.id}:${s.id || s.name}`,
              name: String(s.name || s.title || ''),
              description: String(s.description || s.desc || ''),
              source: src.name,
              author: s.author,
              category: String(s.category || 'custom'),
              tags: Array.isArray(s.tags) ? s.tags : [],
              downloads: Number(s.downloads || 0),
              installHint: String(s.installHint || ''),
              homepage: String(s.homepage || src.url),
              rawUrl: String(s.rawUrl || src.url),
            })));
          }
        } catch { /* skip failed sources */ }
      }
    }
    // 关键词过滤
    if (q) {
      const kw = q.toLowerCase();
      results = results.filter((s) =>
        s.name.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(kw))
      );
    }
    results.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    res.json({ ok: true, total: results.length, skills: results.slice(0, limit) });
  });

  // 已安装技能持久化
  const installedSkillsFile = join(homeDir, 'skills', 'installed.json');
  app.post('/api/skills/install', async (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    if (!body || !body.id || !body.name || !body.source) {
      res.status(400).json({ ok: false, error: '缺少 id / name / source 字段' });
      return;
    }
    try {
      const dir = join(homeDir, 'skills', body.id.replace(/[^a-zA-Z0-9_-]/g, '_'));
      mkdirSync(dir, { recursive: true });
      if (!saveJsonFile(join(dir, 'meta.json'), { ...body, installedAt: new Date().toISOString() })) {
        res.status(500).json({ ok: false, error: '技能元数据写入失败' });
        return;
      }
      const installed = loadJsonFile<Array<Record<string, any>>>(installedSkillsFile, []);
      if (!installed.find((s) => s.id === body.id)) {
        installed.push(body);
        if (!saveJsonFile(installedSkillsFile, installed)) {
          res.status(500).json({ ok: false, error: '已安装列表写入失败' });
          return;
        }
      }
      res.json({ ok: true, message: `技能「${body.name}」已记录为已安装` });
    } catch (e) {
      res.status(500).json({ ok: false, error: '安装失败: ' + (e as Error).message });
    }
  });
  app.get('/api/skills/installed', (_req: Request, res: Response) => {
    res.json({ ok: true, skills: loadJsonFile(installedSkillsFile, []) });
  });

  /* ========== 自动化：快捷指令集（一键发起任务） ========== */
  interface AutomationRule {
    id: string;
    name: string;
    goal: string;
    icon?: string;
    category?: string;
    modelId?: string;
    workspaceDir?: string;
    createdAt: string;
    runCount: number;
    lastRunAt?: string;
    builtin?: boolean;
  }
  // 预置常用快捷指令（用户可一键运行，也可保存为自己的指令后编辑）
  const BUILTIN_AUTOMATIONS: Omit<AutomationRule, 'createdAt' | 'runCount'>[] = [
    {
      id: 'builtin-code-review',
      name: '代码审查',
      icon: '🔍',
      category: '质量',
      goal: '请对当前工作区的代码做一次全面审查，重点检查：1) 潜在的 Bug 和逻辑漏洞；2) 代码规范和可读性问题；3) 安全风险；4) 性能瓶颈。按问题严重程度排序，给出具体的修改建议。',
      builtin: true,
    },
    {
      id: 'builtin-gen-test',
      name: '生成测试',
      icon: '🧪',
      category: '测试',
      goal: '请为当前项目生成单元测试，优先覆盖核心业务逻辑和边界条件。先分析项目结构和已有测试框架，然后为关键模块编写测试用例，确保测试可以直接运行。',
      builtin: true,
    },
    {
      id: 'builtin-build-check',
      name: '构建检查',
      icon: '🏗️',
      category: '工程',
      goal: '请运行项目的构建命令（如 npm run build / tsc），检查是否有编译错误或类型错误。如果有错误，逐一分析原因并给出修复方案，修复后重新验证构建是否通过。',
      builtin: true,
    },
    {
      id: 'builtin-dep-check',
      name: '依赖检查',
      icon: '📦',
      category: '工程',
      goal: '请检查当前项目的 package.json 依赖，分析：1) 是否有过时的依赖需要升级；2) 是否有已知安全漏洞的依赖；3) 是否有未使用的冗余依赖。给出升级建议和风险提示。',
      builtin: true,
    },
    {
      id: 'builtin-format',
      name: '代码格式化',
      icon: '✨',
      category: '工程',
      goal: '请对当前项目的代码进行全面格式化。先检查项目是否配置了 ESLint / Prettier 等工具，如果有就按配置格式化；如果没有，就按通用规范统一缩进、引号、分号等风格。格式化后验证构建是否正常。',
      builtin: true,
    },
    {
      id: 'builtin-gen-doc',
      name: '生成文档',
      icon: '📝',
      category: '文档',
      goal: '请为当前项目生成一份完整的 README 文档，包含：项目简介、功能特性、技术栈、安装步骤、使用方法、目录结构说明、开发指南。如果项目有 API，也一并生成 API 文档。',
      builtin: true,
    },
    {
      id: 'builtin-refactor',
      name: '重构优化',
      icon: '♻️',
      category: '质量',
      goal: '请对当前项目的代码进行重构优化，重点关注：1) 重复代码提取；2) 过长函数拆分；3) 命名规范统一；4) 复杂逻辑简化。重构过程中确保不改变外部行为，重构后验证构建和测试通过。',
      builtin: true,
    },
    {
      id: 'builtin-release',
      name: '版本发布准备',
      icon: '🚀',
      category: '工程',
      goal: '请为当前项目准备一次版本发布，包括：1) 检查 package.json 版本号并建议升级；2) 整理 CHANGELOG 变更日志；3) 运行构建和测试确保通过；4) 检查是否有未提交的代码。给出完整的发布检查清单。',
      builtin: true,
    },
    {
      id: 'builtin-security',
      name: '安全扫描',
      icon: '🛡️',
      category: '安全',
      goal: '请对当前项目的代码进行安全扫描，重点检查：1) SQL 注入、XSS、CSRF 等常见漏洞；2) 硬编码的密钥或敏感信息；3) 不安全的依赖；4) 权限校验缺失。按风险等级排序，给出修复建议。',
      builtin: true,
    },
    {
      id: 'builtin-perf',
      name: '性能分析',
      icon: '⚡',
      category: '质量',
      goal: '请分析当前项目的性能瓶颈，重点关注：1) 慢查询和低效算法；2) 不必要的重复计算；3) 内存泄漏风险；4) 异步操作阻塞。给出具体的优化方案和预期收益，优化后验证效果。',
      builtin: true,
    },
  ];
  const automationsFile = join(homeDir, 'automations.json');
  app.get('/api/automations', (_req: Request, res: Response) => {
    const user = loadJsonFile<AutomationRule[]>(automationsFile, []);
    res.json({ ok: true, builtin: BUILTIN_AUTOMATIONS, automations: user });
  });
  app.post('/api/automations', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    if (!name || !goal) {
      res.status(400).json({ ok: false, error: '缺少 name 或 goal 字段' });
      return;
    }
    const list = loadJsonFile<AutomationRule[]>(automationsFile, []);
    const rule: AutomationRule = {
      id: `auto_${Date.now()}_${randomUUID().slice(0, 4)}`,
      name,
      goal,
      modelId:
        typeof body.modelId === 'string' && body.modelId.trim() ? body.modelId.trim() : undefined,
      workspaceDir:
        typeof body.workspaceDir === 'string' && body.workspaceDir.trim()
          ? body.workspaceDir.trim()
          : undefined,
      createdAt: new Date().toISOString(),
      runCount: 0,
    };
    list.push(rule);
    if (!saveJsonFile(automationsFile, list)) {
      res.status(500).json({ ok: false, error: '指令保存失败（磁盘不可写）' });
      return;
    }
    res.status(201).json({ ok: true, automation: rule });
  });
  // 注：当前 @types/express 版本缺失 delete 方法类型声明，运行时 Express 完全支持，故局部断言
  (app.delete as (p: string, h: (req: Request, res: Response) => void) => void)(
    '/api/automations/:id',
    async (req: Request, res: Response) => {
      const list = loadJsonFile<AutomationRule[]>(automationsFile, []);
      const next = list.filter((a) => a.id !== req.params.id);
      if (next.length === list.length) {
        res.status(404).json({ ok: false, error: '指令不存在' });
        return;
      }
      if (!saveJsonFile(automationsFile, next)) {
        res.status(500).json({ ok: false, error: '指令删除失败（磁盘不可写）' });
        return;
      }
      res.json({ ok: true });
    },
  );
  app.post('/api/automations/:id/run', async (req: Request, res: Response) => {
    const list = loadJsonFile<AutomationRule[]>(automationsFile, []);
    // 先从用户自定义指令里找，找不到再从预置指令里找
    let rule = list.find((a) => a.id === req.params.id);
    let isBuiltin = false;
    if (!rule) {
      const builtin = BUILTIN_AUTOMATIONS.find((a) => a.id === req.params.id);
      if (builtin) {
        rule = builtin as AutomationRule;
        isBuiltin = true;
      }
    }
    if (!rule) {
      res.status(404).json({ ok: false, error: '指令不存在' });
      return;
    }
    const record = queue.submit(rule.goal, {
      modelId: rule.modelId,
      workspaceDir: rule.workspaceDir,
    });
    rule.runCount += 1;
    rule.lastRunAt = new Date().toISOString();
    // 预置指令的 runCount 不持久化（只在内存中统计），用户自定义指令才持久化
    let persistWarning = false;
    if (!isBuiltin) {
      persistWarning = !saveJsonFile(automationsFile, list);
    }
    res.status(201).json({
      ok: true,
      task: publicTask(record, true),
      runCount: rule.runCount,
      builtin: isBuiltin || undefined,
      persistWarning: persistWarning || undefined,
    });
  });

  /* ========== 模板库 ========== */
  interface UserTemplate {
    id: string;
    title: string;
    category: string;
    goal: string;
    icon: string;
    builtin: boolean;
  }
  const BUILTIN_TEMPLATES: Omit<UserTemplate, 'builtin'>[] = [
    {
      id: 'tpl-code-gen',
      title: '编写新功能',
      category: '代码',
      icon: '🧩',
      goal: '请用 production-ready 的代码实现以下功能：\n\n（请描述功能点、输入输出、边界条件）',
    },
    {
      id: 'tpl-debug',
      title: '调试 Bug',
      category: '调试',
      icon: '🐛',
      goal: '以下代码出现异常，请定位根因并修复，附回归验证：\n\n（粘贴错误日志或现象）',
    },
    {
      id: 'tpl-refactor',
      title: '重构优化',
      category: '代码',
      icon: '♻️',
      goal: '请在不改变外部行为的前提下重构以下模块，提升可读性与性能：\n\n（粘贴代码或文件路径）',
    },
    {
      id: 'tpl-test',
      title: '生成测试',
      category: '测试',
      icon: '🧪',
      goal: '请为以下代码生成单元测试与边界用例（覆盖率优先）：\n\n（粘贴代码或文件路径）',
    },
    {
      id: 'tpl-doc',
      title: '撰写文档',
      category: '文档',
      icon: '📝',
      goal: '请撰写一份技术/产品文档，包含背景、方案、步骤与注意事项：\n\n（说明文档主题）',
    },
    {
      id: 'tpl-review',
      title: '代码审查',
      category: '质量',
      icon: '🔍',
      goal: '请对以下代码做静态/设计审查，列出问题与改进建议：\n\n（粘贴代码或文件路径）',
    },
    {
      id: 'tpl-explain',
      title: '解释代码',
      category: '文档',
      icon: '💡',
      goal: '请用通俗语言解释以下代码的逻辑与关键点：\n\n（粘贴代码）',
    },
    {
      id: 'tpl-perf',
      title: '性能优化',
      category: '质量',
      icon: '⚡',
      goal: '请分析并优化以下代码的性能瓶颈，给出前后对比：\n\n（粘贴代码或描述场景）',
    },
  ];
  const templatesFile = join(homeDir, 'templates.json');
  app.get('/api/templates', async (_req: Request, res: Response) => {
    const user = loadJsonFile<UserTemplate[]>(templatesFile, []);
    // 从节点同步的模板
    const nodeTemplates = collectNodeTemplates().map((t) => ({
      id: `node:${t.id}`,
      title: t.title,
      category: t.category,
      goal: t.goal,
      icon: t.icon,
      builtin: false,
      source: t.source,
      nodeId: t.nodeId,
    }));
    // 从自定义来源拉取模板
    const customTemplates: any[] = [];
    for (const src of loadSources()) {
      if (!src.enabled || src.type !== 'templates') continue;
      try {
        const r = await fetchWithRetry(src.url, 25000, 0);
        if (r.ok) {
          const data = await r.json();
          const list = Array.isArray(data) ? data : (data.items || data.templates || []);
          customTemplates.push(...list.map((t: any) => ({
            id: `custom:${src.id}:${t.id || t.title}`,
            title: String(t.title || t.name || ''),
            category: String(t.category || src.name),
            goal: String(t.goal || t.prompt || ''),
            icon: String(t.icon || '📄'),
            builtin: false,
            source: src.name,
          })));
        }
      } catch { /* skip */ }
    }
    res.json({ ok: true, builtin: BUILTIN_TEMPLATES, user, node: nodeTemplates, custom: customTemplates });
  });
  app.post('/api/templates', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    if (!title || !goal) {
      res.status(400).json({ ok: false, error: '缺少 title 或 goal 字段' });
      return;
    }
    const list = loadJsonFile<UserTemplate[]>(templatesFile, []);
    const tpl: UserTemplate = {
      id: `tpl_${Date.now()}_${randomUUID().slice(0, 4)}`,
      title,
      category:
        typeof body.category === 'string' && body.category.trim() ? body.category.trim() : '自定义',
      goal,
      icon: typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : '📄',
      builtin: false,
    };
    list.push(tpl);
    if (!saveJsonFile(templatesFile, list)) {
      res.status(500).json({ ok: false, error: '模板保存失败（磁盘不可写）' });
      return;
    }
    res.status(201).json({ ok: true, template: tpl });
  });
  (app.delete as (p: string, h: (req: Request, res: Response) => void) => void)(
    '/api/templates/:id',
    async (req: Request, res: Response) => {
      const list = loadJsonFile<UserTemplate[]>(templatesFile, []);
      const next = list.filter((t) => t.id !== req.params.id);
      if (next.length === list.length) {
        res.status(404).json({ ok: false, error: '模板不存在或不可删除' });
        return;
      }
      if (!saveJsonFile(templatesFile, next)) {
        res.status(500).json({ ok: false, error: '模板删除失败（磁盘不可写）' });
        return;
      }
      res.json({ ok: true });
    },
  );

  /* ========== 办公助理：内置能力清单 + 节点能力 + 自定义来源 ========== */
  app.get('/api/office/capabilities', async (_req: Request, res: Response) => {
    const builtin = [
      {
        id: 'doc-summary',
        icon: '📄',
        title: '文档摘要',
        desc: '粘贴长文档，生成结构化摘要与要点',
        prompt: '请对以下文档做摘要，提取 3-5 个核心要点并列出待办：\n\n',
        source: '内置',
      },
      {
        id: 'doc-translate',
        icon: '🌐',
        title: '中英互译',
        desc: '技术文档/代码注释翻译',
        prompt: '请将以下内容准确翻译（保留代码与术语）：\n\n',
        source: '内置',
      },
      {
        id: 'doc-rewrite',
        icon: '✍️',
        title: '润色改写',
        desc: '把草稿改写为正式/简洁风格',
        prompt: '请润色以下文本，使其更专业简洁：\n\n',
        source: '内置',
      },
      {
        id: 'meeting-notes',
        icon: '📋',
        title: '会议纪要',
        desc: '从聊天/录音转写生成行动项',
        prompt: '请从以下记录中提取：决策、负责人、截止时间、待办：\n\n',
        source: '内置',
      },
      {
        id: 'email-draft',
        icon: '✉️',
        title: '邮件起草',
        desc: '按要点生成工作邮件',
        prompt: '请起草一封邮件，主题/背景/诉求如下：\n\n',
        source: '内置',
      },
      {
        id: 'excel-formula',
        icon: '📊',
        title: '表格公式',
        desc: '描述需求生成 Excel/Sheets 公式',
        prompt: '请写出实现以下需求的表格公式并解释：\n\n',
        source: '内置',
      },
    ];
    // 从节点同步的办公能力
    const nodeCaps = collectNodeOffice().map((c) => ({
      id: `node:${c.id}`,
      icon: c.icon,
      title: c.title,
      desc: c.desc,
      prompt: c.prompt,
      source: c.source,
      nodeId: c.nodeId,
    }));
    // 从自定义来源拉取办公能力
    const customCaps: any[] = [];
    for (const src of loadSources()) {
      if (!src.enabled || src.type !== 'office') continue;
      try {
        const r = await fetchWithRetry(src.url, 25000, 0);
        if (r.ok) {
          const data = await r.json();
          const list = Array.isArray(data) ? data : (data.items || data.capabilities || []);
          customCaps.push(...list.map((c: any) => ({
            id: `custom:${src.id}:${c.id || c.title}`,
            icon: String(c.icon || '🔧'),
            title: String(c.title || c.name || ''),
            desc: String(c.desc || c.description || ''),
            prompt: String(c.prompt || c.goal || ''),
            source: src.name,
          })));
        }
      } catch { /* skip */ }
    }
    res.json({
      ok: true,
      capabilities: [...builtin, ...nodeCaps, ...customCaps],
      builtin,
      node: nodeCaps,
      custom: customCaps,
    });
  });

}

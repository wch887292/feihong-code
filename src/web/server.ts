/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M5 Web 控制台：自包含 Express 服务骨架 + 多视图 API。
 *   - 任务队列（P4-1 / P5-2 / P6-4）
 *   - 技能市场（插件市场）：聚合 ClawHub + Agent-Foundry
 *   - 自动化：快捷指令集（一键发起任务）
 *   - 模板库：内置 + 用户自定义
 *   - 办公助理：文档处理能力清单
 * 鉴权：Bearer Token（fail-closed）。
 */
import express, { type Request, type Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { requireToken } from './auth';
import { TaskQueue, type TaskRecord } from './task-queue';
import { VERSION, PRODUCT, SIGNATURE } from '../cli/version';
import { t, getLang } from '../shared/i18n';
import { isEnterpriseEnabled } from '../enterprise';
import { resolveHomeDir } from '../shared/config';

export interface ServeOptions {
  port?: number;
  token?: string;
}

/**
 * 启动 Web 控制台。
 * - 端口：opts.port > FH_WEB_PORT > 8080
 * - 令牌：opts.token > FH_WEB_TOKEN > 自动生成（仅本次会话有效，fail-closed）
 */
export function startWebServer(opts: ServeOptions = {}): {
  port: number;
  token: string;
  url: string;
  close: () => void;
} {
  const port = opts.port ?? Number(process.env.FH_WEB_PORT ?? 8080);
  let token = opts.token ?? process.env.FH_WEB_TOKEN ?? '';
  if (!token) {
    token = randomBytes(24).toString('hex');
    console.log(t('serve.tokenAuto', { token }));
  }

  const app = express();
  // 限制请求体大小，防止超大 payload 触发内存耗尽（DoS 面）
  app.use(express.json({ limit: '1mb' }));
  // 静态仪表盘
  const publicDir = join(__dirname, 'public');
  app.use(express.static(publicDir));
  // 公开健康检查（仅暴露版本/状态等观测信息，无敏感数据）
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      product: PRODUCT,
      version: VERSION,
      signature: SIGNATURE,
      enterprise: isEnterpriseEnabled(),
      lang: getLang(),
      time: new Date().toISOString(),
    });
  });
  // 任务队列（进程内；服务端静默执行）
  const persistDir =
    process.env.FH_TASK_PERSIST_DIR?.trim() ||
    join(process.env.FH_HOME?.trim() || join(require('os').homedir(), '.feihong-code'), 'tasks');
  const queue = new TaskQueue({
    concurrency: Number(process.env.FH_TASK_CONCURRENCY ?? 2),
    webhookUrl: process.env.FH_TASK_WEBHOOK_URL,
    persistDir,
  });
  // 鉴权：其余 /api 需 Bearer token（静态资源除外）
  app.use('/api', requireToken(token));

  app.post('/api/tasks', (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal) {
      res.status(400).json({ ok: false, error: '缺少 goal 字段' });
      return;
    }
    const record = queue.submit(goal);
    res.status(201).json({ ok: true, task: publicTask(record) });
  });
  app.get('/api/tasks', (_req: Request, res: Response) => {
    res.json({ ok: true, tasks: queue.list().map(publicTask) });
  });
  app.get('/api/tasks/:id', (req: Request, res: Response) => {
    const record = queue.get(req.params.id);
    if (!record) {
      res.status(404).json({ ok: false, error: '任务不存在' });
      return;
    }
    res.json({ ok: true, task: publicTask(record) });
  });

  // P5-2：webhook 注册/查询
  app.post('/api/webhook', (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      res.status(400).json({ ok: false, error: '缺少 url 字段' });
      return;
    }
    queue.setWebhookUrl(url);
    res.json({ ok: true, webhookUrl: url });
  });
  app.get('/api/webhook', (_req: Request, res: Response) => {
    res.json({ ok: true, webhookUrl: queue.getWebhookUrl() || null });
  });

  /* ========== 持久化辅助 ========== */
  const homeDir = resolveHomeDir();
  function loadJsonFile<T>(file: string, fallback: T): T {
    try {
      if (!existsSync(file)) return fallback;
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }
  async function saveJsonFile(file: string, data: unknown): Promise<void> {
    try {
      mkdirSync(homeDir, { recursive: true });
    } catch {
      /* ignore */
    }
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    // 原子替换，避免并发读写损坏
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    try {
      require('fs').unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }

  /* ========== 技能市场（插件市场）：聚合 ClawHub + Agent-Foundry ========== */
  const CLAWHUB_API = 'https://clawhub.ai/api/v1/skills';
  const AGENT_FOUNDRY_CATALOG =
    'https://raw.githubusercontent.com/hebertzhu/agent-foundry/main/catalog/skills-catalog.json';

  async function fetchWithRetry(url: string, timeoutMs = 15000, retries = 1): Promise<any> {
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
      const r = await fetchWithRetry(AGENT_FOUNDRY_CATALOG);
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
      await saveJsonFile(join(dir, 'meta.json'), { ...body, installedAt: new Date().toISOString() });
      const installed = loadJsonFile<Array<Record<string, any>>>(installedSkillsFile, []);
      if (!installed.find((s) => s.id === body.id)) {
        installed.push(body);
        await saveJsonFile(installedSkillsFile, installed);
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
    modelId?: string;
    workspaceDir?: string;
    createdAt: string;
    runCount: number;
    lastRunAt?: string;
  }
  const automationsFile = join(homeDir, 'automations.json');
  app.get('/api/automations', (_req: Request, res: Response) => {
    res.json({ ok: true, automations: loadJsonFile<AutomationRule[]>(automationsFile, []) });
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
    await saveJsonFile(automationsFile, list);
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
      await saveJsonFile(automationsFile, next);
      res.json({ ok: true });
    },
  );
  app.post('/api/automations/:id/run', async (req: Request, res: Response) => {
    const list = loadJsonFile<AutomationRule[]>(automationsFile, []);
    const rule = list.find((a) => a.id === req.params.id);
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
    await saveJsonFile(automationsFile, list);
    res.status(201).json({ ok: true, task: publicTask(record), runCount: rule.runCount });
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
  app.get('/api/templates', (_req: Request, res: Response) => {
    const user = loadJsonFile<UserTemplate[]>(templatesFile, []);
    res.json({ ok: true, builtin: BUILTIN_TEMPLATES, user });
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
    await saveJsonFile(templatesFile, list);
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
      await saveJsonFile(templatesFile, next);
      res.json({ ok: true });
    },
  );

  /* ========== 办公助理：内置能力清单 ========== */
  app.get('/api/office/capabilities', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      capabilities: [
        {
          id: 'doc-summary',
          icon: '📄',
          title: '文档摘要',
          desc: '粘贴长文档，生成结构化摘要与要点',
          prompt: '请对以下文档做摘要，提取 3-5 个核心要点并列出待办：\n\n',
        },
        {
          id: 'doc-translate',
          icon: '🌐',
          title: '中英互译',
          desc: '技术文档/代码注释翻译',
          prompt: '请将以下内容准确翻译（保留代码与术语）：\n\n',
        },
        {
          id: 'doc-rewrite',
          icon: '✍️',
          title: '润色改写',
          desc: '把草稿改写为正式/简洁风格',
          prompt: '请润色以下文本，使其更专业简洁：\n\n',
        },
        {
          id: 'meeting-notes',
          icon: '📋',
          title: '会议纪要',
          desc: '从聊天/录音转写生成行动项',
          prompt: '请从以下记录中提取：决策、负责人、截止时间、待办：\n\n',
        },
        {
          id: 'email-draft',
          icon: '✉️',
          title: '邮件起草',
          desc: '按要点生成工作邮件',
          prompt: '请起草一封邮件，主题/背景/诉求如下：\n\n',
        },
        {
          id: 'excel-formula',
          icon: '📊',
          title: '表格公式',
          desc: '描述需求生成 Excel/Sheets 公式',
          prompt: '请写出实现以下需求的表格公式并解释：\n\n',
        },
      ],
    });
  });

  const server = app.listen(port, () => {
    console.log(t('serve.started', { port }));
  });
  return {
    port,
    token,
    url: `http://localhost:${port}`,
    close: () => server.close(),
  };
}

/** 对外暴露的任务视图（不含内部字段） */
function publicTask(r: TaskRecord): TaskRecord {
  return r;
}

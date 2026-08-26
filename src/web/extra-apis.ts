/**
 * 飞虹 Code v7.2.0 能力接线层（修复：死代码模块接入 Web API）
 * 将原"孤立代码"模块接入 server，使其从 404 变为可调用：
 *   voice / knowledge / figma / sso / collaboration / plugins / self-correction
 * 配置型模块（figma/sso/collaboration）未配置时返回明确状态，不静默失效。
 */
import express, { type Request, type Response } from 'express';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { createVoiceProgrammingManager } from '../voice/voice-programming';
import { createKnowledgeLibraryManager } from '../knowledge/library';
import { createFigmaIntegration } from '../integrations/figma';
import { createSSOManager } from '../integrations/sso';
import {
  createCollaborationManager,
  type FeishuConfig,
  type GitHubConfig,
} from '../integrations/collaboration';
import { createPluginManager } from '../plugins/manager';
import { createSelfCorrector } from '../agent/self-correction';
import { createLspService } from '../lsp/lsp-service';

type ExpressApp = ReturnType<typeof express>;

export interface ExtraApisOptions {
  /** 数据根目录（knowledge/plugins 存于其下） */
  dataDir: string;
}

function loadFeishuConfig(): FeishuConfig | undefined {
  const appId = process.env.FH_FEISHU_APP_ID;
  const appSecret = process.env.FH_FEISHU_APP_SECRET;
  if (!appId || !appSecret) return undefined;
  return { appId, appSecret, webhookUrl: process.env.FH_FEISHU_WEBHOOK };
}

function loadGithubConfig(): GitHubConfig | undefined {
  const token = process.env.FH_GITHUB_TOKEN;
  const owner = process.env.FH_GITHUB_OWNER;
  const repo = process.env.FH_GITHUB_REPO;
  if (!token || !owner || !repo) return undefined;
  return { token, owner, repo };
}

function bodyOf(req: Request): Record<string, any> {
  return (req.body ?? {}) as Record<string, any>;
}

export function registerExtraApis(app: ExpressApp, opts: ExtraApisOptions): void {
  const { dataDir } = opts;
  mkdirSync(join(dataDir, 'knowledge'), { recursive: true });
  mkdirSync(join(dataDir, 'plugins'), { recursive: true });

  const voice = createVoiceProgrammingManager();
  const knowledge = createKnowledgeLibraryManager(join(dataDir, 'knowledge'));
  const plugins = createPluginManager(join(dataDir, 'plugins'));
  const sso = createSSOManager();
  const figma = createFigmaIntegration({ accessToken: process.env.FH_FIGMA_TOKEN ?? '' });
  const collaboration = createCollaborationManager({
    feishu: loadFeishuConfig(),
    github: loadGithubConfig(),
  });
  const corrector = createSelfCorrector();
  const lsp = createLspService({ enableDiagnostics: true });

  /* ============ 语音编程（原 404） ============ */
  app.get('/api/voice/commands', (_req: Request, res: Response) => {
    res.json({ ok: true, commands: voice.getSupportedCommands() });
  });
  app.post('/api/voice/parse', (req: Request, res: Response) => {
    const body = bodyOf(req);
    const text = String(body.text ?? '');
    if (!text) { res.json({ ok: false, error: '缺少 text' }); return; }
    res.json({ ok: true, command: voice.parseCommand(text) });
  });
  app.post('/api/voice/to-code', async (req: Request, res: Response) => {
    const body = bodyOf(req);
    if (!body.description) { res.json({ ok: false, error: '缺少 description' }); return; }
    const result = await voice.voiceToCode(String(body.description), String(body.language ?? 'typescript'));
    res.json({ ok: true, result });
  });

  /* ============ AI 资料库（原 404） ============ */
  app.get('/api/knowledge/stats', (_req: Request, res: Response) => {
    res.json({ ok: true, stats: knowledge.getStats() });
  });
  app.get('/api/knowledge/documents', (req: Request, res: Response) => {
    const { category, type, sortBy, order, limit, offset } = req.query;
    res.json({
      ok: true,
      documents: knowledge.listDocuments({
        category: category ? String(category) : undefined,
        type: type ? String(type) as never : undefined,
        sortBy: sortBy ? String(sortBy) as never : undefined,
        order: order ? String(order) as never : undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    });
  });
  app.get('/api/knowledge/categories', (_req: Request, res: Response) => {
    res.json({ ok: true, categories: knowledge.getCategories() });
  });
  app.get('/api/knowledge/tags', (_req: Request, res: Response) => {
    res.json({ ok: true, tags: knowledge.getAllTags() });
  });
  app.get('/api/knowledge/document/:id', (req: Request, res: Response) => {
    const doc = knowledge.getDocument(String(req.params.id));
    if (!doc) { res.json({ ok: false, error: '文档不存在' }); return; }
    res.json({ ok: true, document: doc });
  });
  app.get('/api/knowledge/document/:id/content', (req: Request, res: Response) => {
    const content = knowledge.getDocumentContent(String(req.params.id));
    if (content === null) { res.json({ ok: false, error: '文档不存在' }); return; }
    res.json({ ok: true, content });
  });
  app.post('/api/knowledge/document', (req: Request, res: Response) => {
    const body = bodyOf(req);
    if (!body.title || !body.content) { res.json({ ok: false, error: '缺少 title 或 content' }); return; }
    try {
      const doc = knowledge.addDocument({
        title: String(body.title),
        content: String(body.content),
        type: (body.type as never) ?? 'text',
        category: body.category ? String(body.category) : undefined,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
      });
      res.json({ ok: true, document: doc });
    } catch (e) {
      res.json({ ok: false, error: String((e as Error)?.message ?? e) });
    }
  });
  app.put('/api/knowledge/document/:id', (req: Request, res: Response) => {
    const doc = knowledge.updateDocument(String(req.params.id), bodyOf(req));
    if (!doc) { res.json({ ok: false, error: '文档不存在' }); return; }
    res.json({ ok: true, document: doc });
  });
  app.delete('/api/knowledge/document/:id', (req: Request, res: Response) => {
    const ok = knowledge.deleteDocument(String(req.params.id));
    res.json({ ok, deleted: ok });
  });
  app.post('/api/knowledge/search', (req: Request, res: Response) => {
    const body = bodyOf(req);
    if (!body.query) { res.json({ ok: false, error: '缺少 query' }); return; }
    res.json({
      ok: true,
      results: knowledge.search(String(body.query), {
        category: body.category ? String(body.category) : undefined,
        type: body.type ? String(body.type) as never : undefined,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
        limit: body.limit ? Number(body.limit) : undefined,
      }),
    });
  });

  /* ============ SSO 单点登录（原 404） ============ */
  app.get('/api/sso/providers', (_req: Request, res: Response) => {
    res.json({ ok: true, providers: sso.getEnabledProviders() });
  });
  app.post('/api/sso/login-url', (req: Request, res: Response) => {
    const body = bodyOf(req);
    if (!body.providerId) { res.json({ ok: false, error: '缺少 providerId' }); return; }
    const url = sso.getLoginUrl(String(body.providerId), body.redirectUri ? String(body.redirectUri) : undefined);
    if (!url) { res.json({ ok: false, error: '提供方未配置或不存在' }); return; }
    res.json({ ok: true, url });
  });
  app.post('/api/sso/validate', (req: Request, res: Response) => {
    const body = bodyOf(req);
    if (!body.token) { res.json({ ok: false, error: '缺少 token' }); return; }
    const session = sso.validateSession(String(body.token));
    res.json({ ok: !!session, session });
  });

  /* ============ 协作集成（原 404） ============ */
  app.get('/api/collaboration/status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      feishu: !!collaboration.getFeishu(),
      github: !!collaboration.getGitHub(),
    });
  });
  app.post('/api/collaboration/notify', async (req: Request, res: Response) => {
    const body = bodyOf(req);
    if (!body.message) { res.json({ ok: false, error: '缺少 message' }); return; }
    const feishu = collaboration.getFeishu();
    if (!feishu) { res.json({ ok: false, error: '飞书未配置（需 FH_FEISHU_APP_ID/SECRET）' }); return; }
    const ok = await feishu.sendMessage(body.message as never);
    res.json({ ok, sent: ok });
  });

  /* ============ Figma 转代码（原 404） ============ */
  app.get('/api/figma/status', (_req: Request, res: Response) => {
    res.json({ ok: true, configured: !!process.env.FH_FIGMA_TOKEN });
  });
  app.post('/api/figma/convert', async (req: Request, res: Response) => {
    if (!process.env.FH_FIGMA_TOKEN) {
      res.json({ ok: false, error: 'Figma 未配置（需 FH_FIGMA_TOKEN）' });
      return;
    }
    const body = bodyOf(req);
    if (!body.fileKey) { res.json({ ok: false, error: '缺少 fileKey' }); return; }
    try {
      const result = await figma.generateCode(
        String(body.fileKey),
        body.nodeId ? String(body.nodeId) : undefined,
        (body.framework as 'html' | 'react' | 'vue' | 'tailwind') ?? 'tailwind',
      );
      res.json({ ok: true, result });
    } catch (e) {
      res.json({ ok: false, error: String((e as Error)?.message ?? e) });
    }
  });

  /* ============ 插件市场（原 404） ============ */
  app.get('/api/plugins', (req: Request, res: Response) => {
    const status = req.query.status ? String(req.query.status) as never : undefined;
    res.json({ ok: true, plugins: plugins.getInstalledPlugins(status) });
  });
  app.get('/api/plugins/market', (req: Request, res: Response) => {
    const { q, category } = req.query;
    res.json({
      ok: true,
      plugins: plugins.searchMarketPlugins(q ? String(q) : '', category ? String(category) : undefined),
    });
  });
  app.get('/api/plugins/categories', (_req: Request, res: Response) => {
    res.json({ ok: true, categories: plugins.getCategories() });
  });
  app.get('/api/plugins/stats', (_req: Request, res: Response) => {
    res.json({ ok: true, stats: plugins.getStats() });
  });
  app.post('/api/plugins/install', async (req: Request, res: Response) => {
    const body = bodyOf(req);
    if (!body.plugin) { res.json({ ok: false, error: '缺少 plugin' }); return; }
    try {
      const installed = await plugins.installPlugin(body.plugin);
      res.json({ ok: true, plugin: installed });
    } catch (e) {
      res.json({ ok: false, error: String((e as Error)?.message ?? e) });
    }
  });
  app.post('/api/plugins/:id/uninstall', (req: Request, res: Response) => {
    res.json({ ok: plugins.uninstallPlugin(String(req.params.id)) });
  });
  app.post('/api/plugins/:id/enable', (req: Request, res: Response) => {
    res.json({ ok: plugins.enablePlugin(String(req.params.id)) });
  });
  app.post('/api/plugins/:id/disable', (req: Request, res: Response) => {
    res.json({ ok: plugins.disablePlugin(String(req.params.id)) });
  });

  /* ============ 自我修正闭环（原 404） ============ */
  app.post('/api/agent/correct', async (req: Request, res: Response) => {
    const body = bodyOf(req);
    if (!body.filePath) { res.json({ ok: false, error: '缺少 filePath' }); return; }
    try {
      const result = await corrector.correctFile(String(body.filePath), async () => {
        throw new Error('需要配置模型修复函数（modelFix）');
      });
      res.json({ ok: true, result });
    } catch (e) {
      res.json({ ok: false, error: String((e as Error)?.message ?? e) });
    }
  });

  /* ============ LSP 语义服务（P0-2 修复：标准 LSP 风格接口） ============ */
  const lspCwd = (req: Request): string => {
    const q = req.query.cwd;
    return q ? String(q) : process.cwd();
  };
  app.get('/api/lsp/graph', (req: Request, res: Response) => {
    const cwd = lspCwd(req);
    try { res.json({ ok: true, summary: lsp.getGraphSummary(cwd) }); }
    catch (e) { res.json({ ok: false, error: String((e as Error)?.message ?? e) }); }
  });
  app.get('/api/lsp/symbols', (req: Request, res: Response) => {
    const file = req.query.file;
    if (!file) { res.json({ ok: false, error: '缺少 file' }); return; }
    try { res.json({ ok: true, symbols: lsp.getSymbols(lspCwd(req), String(file)) }); }
    catch (e) { res.json({ ok: false, error: String((e as Error)?.message ?? e) }); }
  });
  app.get('/api/lsp/search', (req: Request, res: Response) => {
    const q = req.query.q;
    if (!q) { res.json({ ok: false, error: '缺少 q' }); return; }
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    try { res.json({ ok: true, symbols: lsp.search(lspCwd(req), String(q), limit) }); }
    catch (e) { res.json({ ok: false, error: String((e as Error)?.message ?? e) }); }
  });
  app.get('/api/lsp/diagnostics', (req: Request, res: Response) => {
    const file = req.query.file;
    if (!file) { res.json({ ok: false, error: '缺少 file' }); return; }
    try { res.json({ ok: true, diagnostics: lsp.getDiagnostics(lspCwd(req), String(file)) }); }
    catch (e) { res.json({ ok: false, error: String((e as Error)?.message ?? e) }); }
  });
  app.get('/api/lsp/definition', (req: Request, res: Response) => {
    const file = req.query.file;
    const line = req.query.line ? Number(req.query.line) : NaN;
    if (!file || Number.isNaN(line)) { res.json({ ok: false, error: '缺少 file 或 line' }); return; }
    try {
      const def = lsp.getDefinition(lspCwd(req), String(file), line);
      res.json({ ok: true, definition: def });
    } catch (e) { res.json({ ok: false, error: String((e as Error)?.message ?? e) }); }
  });
  app.get('/api/lsp/hover', (req: Request, res: Response) => {
    const file = req.query.file;
    const line = req.query.line ? Number(req.query.line) : NaN;
    if (!file || Number.isNaN(line)) { res.json({ ok: false, error: '缺少 file 或 line' }); return; }
    try {
      const hover = lsp.getHover(lspCwd(req), String(file), line);
      res.json({ ok: true, hover });
    } catch (e) { res.json({ ok: false, error: String((e as Error)?.message ?? e) }); }
  });
}

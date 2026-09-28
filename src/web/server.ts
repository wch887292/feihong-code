/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M5 Web 控制台：自包含 Express 服务骨架 + 多视图 API。
 *   - 任务队列（P4-1 / P5-2 / P6-4）
 *   - 技能市场（插件市场）：聚合 ClawHub + Agent-Foundry
 *   - 自动化：快捷指令集（一键发起任务）
 *   - 模板库：内置 + 用户自定义
 *   - 办公助理：文档处理能力清单
 *   - 登录：手机号直登（无短信验证，本地会话令牌）
 *   - 文件/工作区：右侧任务详情可直接打开文件夹、浏览器、预览文件
 * 鉴权：Bearer Token（fail-closed），主令牌（FH_WEB_TOKEN）与会话令牌并行。
 * 安全：三层防护——传输层(HTTPS/TLS) + 应用层(请求签名/防重放/暴力破解锁定) + 数据层(AES-256-GCM 落盘加密)
 */
import express, { type Request, type Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { join, resolve, relative, isAbsolute, dirname } from 'path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  lstatSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { spawn, exec } from 'child_process';
import { securityHeaders, verifyRequestSignature, BruteForceGuard } from '../security';
import { licenseState, licenseText, activateLicense } from '../license';
import { requireToken, SessionStore, type Session, WELCOME_TASKS } from './auth';
import { registerExtraApis } from './extra-apis';
import { registerComputerRoutes, runPowerShell } from './routes/computer';
import { registerCapabilitySourceRoutes } from './routes/capability-source';
import {
  TaskQueue,
  publicTask,
  type AgentType,
  type TaskPermissions,
} from './task-queue';
import { VERSION, PRODUCT, SIGNATURE } from '../cli/version';
import { t, getLang } from '../shared/i18n';
import { isEnterpriseEnabled } from '../enterprise';
import { resolveHomeDir, loadConfig } from '../shared/config';
import { ModelRouter } from '../models/model-router';
import { OpenAICompatibleProvider } from '../models/providers/openai-compatible.provider';
import { createCompletionEngine, type CompletionEngine } from '../agent/completion-engine';
import { lintSnippet } from '../agent/lint';
import { buildCodeGraph } from '../agent/symbol-index';
import { ChangeManager } from '../agent/change-manager';
import { createDesignToCodeEngine, type DesignToCodeEngine } from '../agent/design-to-code';
import { createGitIntegration, type GitIntegration } from '../agent/git-integration';
import { createTeamCollaborationManager, type TeamCollaborationManager } from '../agent/team-collaboration';
import { SoloAgent, type SoloConfig, type SoloReport } from '../agent/solo-agent';
import { runMultiAgent, type MultiAgentConfig } from '../agent/multi-agent';
import { createEventDrivenAgentManager, type AgentEvent } from '../agent/event-driven-agent';
import { createCustomAgentManager } from '../agent/custom-agent';
import { connectMcp, type McpServerConfig } from '../tools/mcp/mcp-client';
import { isClineInstalled, runClineCli, detectRateLimit } from '../tools/cline/cline-exec.tool';
import {
  getMemoryConfig,
  readShortTerm,
  readLongTerm,
  getMemoryStats,
  appendShortTerm,
  writeLongTerm,
  appendLongTerm,
} from '../memory';
import {
  getSummaryHistory,
  summarizeMemory,
} from '../memory/auto-summarize';
import {
  encryptText,
  decryptText,
  isEncrypted,
  getMasterKey,
  getRsaKeys,
  rsaDecrypt,
} from '../shared/secure-store';
import { initWechatBridge, setWechatTaskQueue, handleWechatCallback, isWechatEnabled } from '../integrations/wechat-bridge';
import { initFeishuBridge, setFeishuBridgeDeps, handleFeishuCallback, isFeishuEnabled } from '../integrations/feishu-bridge';
import { initYuanbaoBridge, setYuanbaoTaskQueue, handleYuanbaoCallback, isYuanbaoEnabled } from '../integrations/yuanbao-bridge';
import { FeishuIntegration } from '../integrations/collaboration';
// v8.0：SQLite 数据存储 + Honcho 云端记忆（本地部署）
import { getStore } from '../shared/sqlite-store';
import { getHonchoStore } from '../memory/honcho-store';

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
  // Web 环境无法进行交互式审批，禁用审批检查
  if (process.env.FH_REQUIRE_APPROVAL === undefined) {
    process.env.FH_REQUIRE_APPROVAL = 'false';
  }

  const port = opts.port ?? Number(process.env.FH_WEB_PORT ?? 8080);
  let token = opts.token ?? process.env.FH_WEB_TOKEN ?? '';
  if (!token) {
    token = randomBytes(24).toString('hex');
    console.log(t('serve.tokenAuto', { token }));
  }

  const app = express();
  // CORS：允许跨域访问（接口已有 Bearer Token + HMAC 签名双重鉴权，放开 Origin 风险可控；
  // 手机 H5 / 浏览器直接访问云桥接接口必须放行，否则 file:// 与 WebView 跨域请求被拦截）
  app.use((req: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-fh-ts,x-fh-nonce,x-fh-sig');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });
  // 放宽请求体上限以支持截图/图片 base64 上传（8MB），仍可有效防御内存耗尽
  // verify 回调把原始 body 存入 req.rawBody，供请求签名校验使用
  app.use(express.json({ limit: '8mb', verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf.toString('utf-8'); } }));
  // 第一层(应用部分)·安全响应头
  app.use(securityHeaders);
  // 第二层·请求签名防重放（对 /api/ 写请求启用；登录/回调豁免）
  app.use(verifyRequestSignature(process.env.FH_SIGN_SECRET || token, { maxBodyBytes: 8 * 1024 * 1024 }));
  // 第二层·暴力破解防护（登录/激活）
  const bruteForce = new BruteForceGuard();
  setInterval(() => bruteForce.cleanup(), 60 * 1000).unref();
  // 微信回调使用 XML body，单独路由用 text 解析
  app.use('/api/wechat/callback', (express as any).text({ type: ['*/xml', 'text/xml', 'application/xml'], limit: '1mb' }));
  // 元宝回调需要原始 body 用于 HMAC 签名校验
  app.use('/api/yuanbao/callback', (express as any).raw({ type: 'application/json', limit: '1mb' }));
  // 静态仪表盘（开发时直接从 src 读取，避免 dist 被锁）
  const publicDir =
    process.env.FH_WEB_SRC_PUBLIC || join(__dirname, 'public');
  app.use(express.static(publicDir, { maxAge: '0' }));

  // 登录会话存储（进程内）
  const sessions = new SessionStore();
  // 当前 Web 控制台工作区，任务提交缺省时使用
  let serverWorkspaceDir = resolve(process.cwd());

  // P3: 多文件变更管理器（AI 生成的修改先暂存，用户审批后才写入磁盘）
  const changeManager = new ChangeManager({ cwd: serverWorkspaceDir });

  // P2-2: Git 集成管理器
  let gitIntegration: GitIntegration = createGitIntegration(serverWorkspaceDir);

  // P2-3: 团队协作管理器
  const teamManager: TeamCollaborationManager = createTeamCollaborationManager();

  // 阶段二-2: 事件驱动 Agent 管理器
  const eventDrivenManager = createEventDrivenAgentManager(serverWorkspaceDir, async (event: AgentEvent) => {
    console.log('[event-driven] processing:', { eventId: event.id, type: event.type });
    // 实际处理逻辑：根据事件类型触发对应的 Agent 任务
    // 这里简化处理，实际应集成到 orchestrator
  });

  // 阶段二-3: 自定义 Agent 管理器
  const customAgentManager = createCustomAgentManager(serverWorkspaceDir);

  // P3-2: SOLO 全自主编程任务存储
  const soloTasks = new Map<string, { agent: SoloAgent; report?: SoloReport; status: 'running' | 'completed' | 'failed' }>();

  // 任务队列（进程内；服务端静默执行）— 需在登录接口前初始化
  const persistDir =
    process.env.FH_TASK_PERSIST_DIR?.trim() ||
    join(process.env.FH_HOME?.trim() || join(require('os').homedir(), '.feihong-code'), 'tasks');
  const queue = new TaskQueue({
    concurrency: Number(process.env.FH_TASK_CONCURRENCY ?? 2),
    webhookUrl: process.env.FH_TASK_WEBHOOK_URL,
    persistDir,
    // P3-1: AI 生成的文件修改自动暂存到变更面板
    stageChange: (path, content) => {
      try { changeManager.stageChange(path, content); } catch (e) { /* 暂存失败不影响任务执行 */ }
    },
  });

  // 微信桥接：注入 TaskQueue 引用并初始化
  setWechatTaskQueue(queue);
  const wechatConfig = initWechatBridge();

  // 飞书桥接：注入 TaskQueue 和 FeishuIntegration，初始化
  const feishuConfig = initFeishuBridge();
  if (isFeishuEnabled(feishuConfig)) {
    const feishuIntegration = new FeishuIntegration({ appId: feishuConfig.appId, appSecret: feishuConfig.appSecret });
    setFeishuBridgeDeps(queue, feishuIntegration);
  }

  // 元宝/豆包桥接：注入 TaskQueue 引用并初始化
  setYuanbaoTaskQueue(queue);
  const yuanbaoConfig = initYuanbaoBridge();

  // 公开健康检查（仅暴露版本/状态等观测信息，无敏感数据）
  app.get('/api/health', (_req: Request, res: Response) => {
    let storage: { ok: boolean; backend: string; dbFile: string } | null = null;
    let honcho: { ok: boolean; backend: string } | null = null;
    try {
      storage = getStore().health();
    } catch (e) {
      storage = { ok: false, backend: 'error', dbFile: '' };
    }
    try {
      const h = getHonchoStore().health();
      honcho = { ok: h.ok, backend: h.backend };
    } catch {
      honcho = { ok: false, backend: 'unavailable' };
    }
    res.json({
      ok: true,
      product: PRODUCT,
      version: VERSION,
      signature: SIGNATURE,
      enterprise: isEnterpriseEnabled(),
      lang: getLang(),
      wechat: isWechatEnabled(wechatConfig) ? wechatConfig.mode : 'disabled',
      feishu: isFeishuEnabled(feishuConfig) ? 'enabled' : 'disabled',
      yuanbao: isYuanbaoEnabled(yuanbaoConfig) ? 'enabled' : 'disabled',
      // v8.0：SQLite 数据存储 + Honcho 云端记忆状态
      storage,
      honcho,
      time: new Date().toISOString(),
    });
  });

  // 微信桥接回调（GET=URL验证，POST=消息接收），无需 Bearer Token（微信服务器调用）
  app.get('/api/wechat/callback', async (req: Request, res: Response) => {
    const result = (await handleWechatCallback(wechatConfig, req.query as Record<string, string>, '')) as { status: number; body: string; contentType: string };
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.send(result.body);
  });
  app.post('/api/wechat/callback', async (req: Request, res: Response) => {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
    const result = (await handleWechatCallback(wechatConfig, req.query as Record<string, string>, body)) as { status: number; body: string; contentType: string };
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.send(result.body);
  });

  // 飞书桥接回调（事件订阅，无需 Bearer Token）
  app.post('/api/feishu/callback', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const result = (await handleFeishuCallback(feishuConfig, body)) as { status: number; body: unknown; contentType: string };
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.send(result.body);
  });

  // 元宝/豆包桥接回调（webhook，无需 Bearer Token，原始 body 用于签名校验）
  app.post('/api/yuanbao/callback', async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || ''));
    const headers = req.headers as Record<string, string | undefined>;
    const result = (await handleYuanbaoCallback(yuanbaoConfig, rawBody, headers)) as { status: number; body: unknown; contentType: string };
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.send(result.body);
  });

  // 手机号直登：无短信验证，生成本地会话令牌
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    if (!phone) {
      res.status(400).json({ ok: false, error: '请输入手机号码' });
      return;
    }
    // 使用新的登录方法，支持首次登录检测
    const result = sessions.login(phone);
    const session = sessions.get(result.token);
    
    // 首次登录：返回引导任务定义（不自动提交执行，由用户在前端点「运行」时再真正发起）
    let welcomeTasks: any[] = [];
    if (result.isFirstLogin) {
      // 标记会话为首次登录（用于后续接口识别）
      if (session) {
        session.isFirstLogin = true;
      }
      // 只返回任务定义，taskId 留空，前端点运行时才提交到任务队列
      for (const task of WELCOME_TASKS) {
        welcomeTasks.push({
          ...task,
          taskId: '',
          status: 'pending',
        });
      }
    }
    
    res.json({ 
      ok: true, 
      token: result.token,
      signSecret: process.env.FH_SIGN_SECRET || token, 
      phone,
      isFirstLogin: result.isFirstLogin,
      welcomeTasks,
    });
  });
  // 鉴权：其余 /api 需 Bearer token（静态资源与 login/health 除外）
  // 公开 API（无需认证）
  app.get('/api/drives', (_req: Request, res: Response) => {
    res.json({ ok: true, drives: getAvailableDrives() });
  });

  // 记忆管理 API（公开访问，无敏感信息）
  const memoryConfig = getMemoryConfig();
  app.get('/api/memory/short', (_req: Request, res: Response) => {
    const date = typeof _req.query.date === 'string' ? _req.query.date : undefined;
    const content = readShortTerm(memoryConfig, date ? new Date(date) : undefined);
    res.json({ ok: true, content, date: date || new Date().toISOString().split('T')[0] });
  });
  // 手动添加一条短期记忆
  app.post('/api/memory/short', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const type = (['task', 'fix', 'feature', 'error', 'note'] as const).find((t) => t === body.type) || 'note';
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '';
    const content = typeof body.content === 'string' && body.content.trim() ? body.content.trim() : '';
    if (!title || !content) {
      res.status(400).json({ ok: false, error: '缺少 title 或 content 字段' });
      return;
    }
    try {
      const path = appendShortTerm(memoryConfig, { type, title, content });
      res.json({ ok: true, path, message: '已添加到短期记忆' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: '添加失败: ' + e.message });
    }
  });
  app.get('/api/memory/long', (_req: Request, res: Response) => {
    const content = readLongTerm(memoryConfig);
    res.json({ ok: true, content });
  });
  // 写入/编辑长期记忆（用户自定义需要记忆的内容）
  app.post('/api/memory/long', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const content = typeof body.content === 'string' ? body.content : '';
    try {
      writeLongTerm(memoryConfig, content);
      res.json({ ok: true, message: '长期记忆已保存' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: '保存失败: ' + e.message });
    }
  });
  // 追加一条长期记忆
  app.post('/api/memory/long/append', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : '自定义';
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '';
    const content = typeof body.content === 'string' && body.content.trim() ? body.content.trim() : '';
    if (!title || !content) {
      res.status(400).json({ ok: false, error: '缺少 title 或 content 字段' });
      return;
    }
    try {
      const id = appendLongTerm(memoryConfig, { category, title, content, summarizedFrom: '手动添加' });
      res.json({ ok: true, id, message: '已追加到长期记忆' });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: '追加失败: ' + e.message });
    }
  });
  app.get('/api/memory/stats', (_req: Request, res: Response) => {
    const stats = getMemoryStats(memoryConfig);
    res.json({ ok: true, ...stats });
  });
  app.post('/api/memory/summarize', async (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    const forceDate = typeof body?.date === 'string' ? body.date : undefined;
    try {
      const result = await summarizeMemory(memoryConfig, forceDate);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  app.get('/api/memory/history', (_req: Request, res: Response) => {
    const limit = typeof _req.query.limit === 'string' ? parseInt(_req.query.limit) || 30 : 30;
    const history = getSummaryHistory(memoryConfig, limit);
    res.json({ ok: true, history });
  });

  // ===== v8.0：SQLite 数据存储 + Honcho 云端记忆 API =====
  app.get('/api/storage/stats', (_req: Request, res: Response) => {
    try {
      const stats = getStore().stats();
      res.json({ ok: true, ...stats });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  app.get('/api/honcho/context', (_req: Request, res: Response) => {
    try {
      const honcho = getHonchoStore();
      res.json({
        ok: true,
        profile: honcho.getUserProfile(),
        memories: honcho.listMemories(10),
        contextPrompt: honcho.buildContextPrompt(),
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  app.post('/api/honcho/remember', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { content?: string; importance?: number };
      if (!body.content) {
        res.status(400).json({ ok: false, error: 'content required' });
        return;
      }
      getHonchoStore().rememberFact(body.content, body.importance);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  app.get('/api/honcho/recall', (req: Request, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit) || 5 : 5;
      const result = getHonchoStore().recall(q, limit);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/auth/clear-first-login', (req: Request, res: Response) => {
    const header = req.header('authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    const token = m[1];
    const ok = sessions.clearFirstLogin(token);
    res.json({ ok, cleared: ok });
  });

  app.use('/api', requireToken(token, sessions, ['/api/security/public-key']));

  // ===== v7.2.0 能力接线层：voice / knowledge / figma / sso / collaboration / plugins / self-correction =====
  // 将原"孤立代码"模块接入 Web API（修复：从 404 变为可调用）
  registerExtraApis(app, { dataDir: join(resolveHomeDir(), '.feihong-code') });

  app.get('/api/auth/me', (req: Request, res: Response) => {
    const session = (req as Request & { user?: Session }).user;
    res.json({ 
      ok: true, 
      phone: session?.phone ?? null,
      isFirstLogin: session?.isFirstLogin ?? false,
    });
  });

  app.post('/api/tasks', (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal) {
      res.status(400).json({ ok: false, error: '缺少 goal 字段' });
      return;
    }
    const agentType: AgentType | undefined =
      typeof body?.agentType === 'string' ? (body.agentType as AgentType) : undefined;
    const permissions: TaskPermissions | undefined =
      typeof body?.permissions === 'object' && body?.permissions !== null
        ? (body.permissions as TaskPermissions)
        : undefined;
    const workspaceDir =
      typeof body?.workspaceDir === 'string' && body.workspaceDir.trim()
        ? body.workspaceDir.trim()
        : serverWorkspaceDir;
    const modelId =
      typeof body?.modelId === 'string' && body.modelId.trim() ? body.modelId.trim() : undefined;
    // 附件：前端暂存区统一上传后的文件路径列表
    const attachments: string[] = Array.isArray(body?.attachments)
      ? (body.attachments as unknown[]).filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim())
      : [];
    const record = queue.submit(goal, { modelId, workspaceDir, agentType, permissions, attachments });
    res.status(201).json({ ok: true, task: publicTask(record, true) });
  });
  app.get('/api/tasks', (_req: Request, res: Response) => {
    res.json({ ok: true, tasks: queue.list().map((t) => publicTask(t, false)) });
  });
  app.get('/api/tasks/:id', (req: Request, res: Response) => {
    const record = queue.get(req.params.id);
    if (!record) {
      res.status(404).json({ ok: false, error: '任务不存在' });
      return;
    }
    res.json({ ok: true, task: publicTask(record, true) });
  });
  // 多轮续接：向当前任务追加一条用户消息，所有对话归属同一任务生命周期
  app.post('/api/tasks/:id/messages', (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.status(400).json({ ok: false, error: '缺少 message 字段' });
      return;
    }
    // 附件：前端暂存区统一上传后的文件路径列表
    const attachments: string[] = Array.isArray(body?.attachments)
      ? (body.attachments as unknown[]).filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim())
      : [];
    const record = queue.continueTask(req.params.id, message, attachments);
    if (!record) {
      res.status(409).json({ ok: false, error: '任务不存在或正在执行中，请等待完成后再继续对话' });
      return;
    }
    res.status(201).json({ ok: true, task: publicTask(record, true) });
  });
  app.delete('/api/tasks/:id', (req: Request, res: Response) => {
    const success = queue.delete(req.params.id);
    if (!success) {
      res.status(400).json({ ok: false, error: '无法删除运行中的任务' });
      return;
    }
    res.json({ ok: true });
  });
  // P9：停止单个指定任务（精准中止，不影响其他运行中的任务）
  app.post('/api/tasks/:id/stop', (req: Request, res: Response) => {
    const ok = queue.cancelTask(req.params.id);
    if (!ok) {
      res.status(409).json({ ok: false, error: '任务不存在或已结束，无法停止' });
      return;
    }
    res.json({ ok: true, taskId: req.params.id, status: 'failed' });
  });
  // P9：停止所有任务（中断运行 + 清空队列，后续可继续提交新任务）
  app.post('/api/tasks/stop', (_req: Request, res: Response) => {
    queue.cancel();
    res.json({ ok: true });
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
  // 三重加密密钥体系：主密钥（AES 存储加密）+ RSA 密钥对（通信加密）
  const masterKey = getMasterKey(homeDir);
  const rsaKeys = getRsaKeys(homeDir);
  function loadJsonFile<T>(file: string, fallback: T): T {
    try {
      if (!existsSync(file)) return fallback;
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }
  /** 同步睡眠（避免引入异步复杂度；用 Atomics.wait 兼容 Node 12+） */
  function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }

  /**
   * 原子写入 JSON 文件（tmp → renameSync）。
   * - 真原子替换：rename 成功即生效，tmp 不会残留（区别于旧的"写 tmp 再写 file 再删 tmp"，
   *   旧方案在 Windows 下高频写会偶发 EPERM：Defender/句柄锁住 .tmp 文件导致 open 失败，
   *   且崩溃时 tmp 残留，下次 open 又被锁 → 连锁失败）。
   * - EPERM 瞬时锁：重试 3 次（50ms/100ms/150ms 退避）。
   * - 绝不向上抛：失败返回 false，由调用方决定降级策略（内存态 / 500 响应）。
   */
  function saveJsonFile(file: string, data: unknown): boolean {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      /* ignore */
    }
    // tmp 文件名带 PID：进程唯一，避免与历史残留（如被外部句柄锁住的 .tmp）或并发进程冲突
    const tmp = file + '.' + process.pid + '.tmp';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        renameSync(tmp, file);
        return true;
      } catch (e) {
        // 清理残留 tmp（unlink 也可能 EPERM，忽略）
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        if (attempt === 2) {
          console.warn('[fhcode] 配置文件写入失败（已重试 3 次，保持内存态）', file, (e as Error)?.message);
          return false;
        }
        sleepSync(50 * (attempt + 1));
      }
    }
    return false;
  }

  /* ========== 路径安全 ========== */
  // 获取系统所有可用的 Windows 驱动器列表（同步，使用 fs.existsSync 检测）
  function getAvailableDrives(): string[] {
    if (process.platform !== 'win32') return ['/'];
    const drives: string[] = [];
    for (let code = 65; code <= 90; code++) {
      const drive = String.fromCharCode(code) + ':\\';
      if (existsSync(drive)) drives.push(drive);
    }
    return drives.length > 0 ? drives : [];
  }

  // 驱动器根目录只在启动时探测一次并缓存。
  // 历史缺陷：此处曾对每次路径校验 spawn 一个 `cmd /c wmic logicaldisk`，
  // 而 wmic 的 close 回调在函数 return 之后才触发（结果根本用不上），
  // 等于每次浏览目录都白起一个进程；Win11 已移除 wmic，spawn 失败还会拖慢/打断请求。
  // 现改为同步 existsSync 探测 + 进程级缓存，零子进程。
  const driveRootsCache: string[] = getAvailableDrives();

  const allowedRoots = (): string[] => [
    resolve(serverWorkspaceDir),
    resolve(homeDir),
    resolve(process.cwd()),
    ...driveRootsCache,
  ];

  function isPathAllowed(target: string): boolean {
    const resolved = resolve(target);
    for (const root of allowedRoots()) {
      const rel = relative(root, resolved);
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
        return existsSync(resolved);
      }
    }
    return false;
  }

  function assertPathAllowed(target: string, res: Response): boolean {
    if (!isPathAllowed(target)) {
      res.status(403).json({ ok: false, error: '路径不在允许范围内或不存在' });
      return false;
    }
    return true;
  }

  /* ========== 工作区与文件浏览 ========== */
  app.get('/api/workspace', (_req: Request, res: Response) => {
    res.json({ ok: true, cwd: serverWorkspaceDir });
  });
  app.post('/api/workspace', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const cwd = typeof body?.cwd === 'string' ? body.cwd.trim() : '';
    if (!cwd) {
      res.status(400).json({ ok: false, error: '缺少 cwd 字段' });
      return;
    }
    const resolved = resolve(cwd);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      res.status(400).json({ ok: false, error: '目录不存在' });
      return;
    }
    serverWorkspaceDir = resolved;
    res.json({ ok: true, cwd: serverWorkspaceDir });
  });

  app.get('/api/workspace/list', (req: Request, res: Response) => {
    const raw = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    // path 为空 / '.' 时回落到服务端工作区，避免 resolve('.') 指向进程 cwd 造成困惑
    const rawPath = !raw || raw === '.' ? serverWorkspaceDir : raw;
    const dir = resolve(rawPath);
    if (!assertPathAllowed(dir, res)) return;
    try {
      // withFileTypes 失败时（部分网络盘/权限目录）退回普通 readdir
      const names = readdirSync(dir);
      const entries = names
        .map((name) => {
          const full = join(dir, name);
          try {
            const st = lstatSync(full);
            return {
              name,
              path: full,
              type: st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other',
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      res.json({ ok: true, cwd: dir, entries });
    } catch (e) {
      res.status(500).json({ ok: false, error: '读取目录失败: ' + (e as Error).message });
    }
  });

  // 新建文件夹
  app.post('/api/workspace/mkdir', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const parent = typeof body?.parent === 'string' ? body.parent.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!parent || !name) {
      res.status(400).json({ ok: false, error: '缺少 parent 或 name 字段' });
      return;
    }
    // 文件夹名安全校验：禁止路径分隔符和特殊字符
    if (/[\\/:*?"<>|]/.test(name)) {
      res.status(400).json({ ok: false, error: '文件夹名包含非法字符' });
      return;
    }
    const parentDir = resolve(parent);
    if (!assertPathAllowed(parentDir, res)) return;
    const newDir = join(parentDir, name);
    try {
      if (existsSync(newDir)) {
        res.status(409).json({ ok: false, error: '文件夹已存在' });
        return;
      }
      mkdirSync(newDir, { recursive: true });
      res.json({ ok: true, path: newDir });
    } catch (e) {
      res.status(500).json({ ok: false, error: '创建文件夹失败: ' + (e as Error).message });
    }
  });

  // 重命名文件夹
  app.post('/api/workspace/rename', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const newName = typeof body?.newName === 'string' ? body.newName.trim() : '';
    if (!path || !newName) {
      res.status(400).json({ ok: false, error: '缺少 path 或 newName 字段' });
      return;
    }
    if (/[\\/:*?"<>|]/.test(newName)) {
      res.status(400).json({ ok: false, error: '文件夹名包含非法字符' });
      return;
    }
    const oldPath = resolve(path);
    if (!assertPathAllowed(oldPath, res)) return;
    if (!existsSync(oldPath) || !statSync(oldPath).isDirectory()) {
      res.status(400).json({ ok: false, error: '目标不是文件夹或不存在' });
      return;
    }
    const parentDir = dirname(oldPath);
    const newPath = join(parentDir, newName);
    try {
      if (existsSync(newPath)) {
        res.status(409).json({ ok: false, error: '同名文件夹已存在' });
        return;
      }
      renameSync(oldPath, newPath);
      res.json({ ok: true, path: newPath });
    } catch (e) {
      res.status(500).json({ ok: false, error: '重命名失败: ' + (e as Error).message });
    }
  });

  /* ========== 三端同步状态（手机 / Web / 桌面共享：执行端 + 当前项目） ========== */
  const syncStateFile = join(resolveHomeDir(), '.feihong-code', 'sync-state.json');
  const readSyncState = (): Record<string, any> => {
    try { return JSON.parse(readFileSync(syncStateFile, 'utf-8')); } catch { return {}; }
  };
  const writeSyncState = (patch: Record<string, any>): void => {
    try {
      mkdirSync(dirname(syncStateFile), { recursive: true });
      const next = { ...readSyncState(), ...patch, updatedAt: new Date().toISOString() };
      writeFileSync(syncStateFile, JSON.stringify(next, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[sync] 保存三端同步状态失败: ' + (e as Error).message);
    }
  };
  app.get('/api/sync', (_req: Request, res: Response) => {
    res.json({ ok: true, ...readSyncState() });
  });
  app.post('/api/sync', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const clean: Record<string, any> = {};
    if (typeof body?.execEnd === 'string' && ['phone', 'direct', 'cloud'].includes(body.execEnd)) clean.execEnd = body.execEnd;
    if (typeof body?.project === 'string') clean.project = body.project.slice(0, 2000);
    if (typeof body?.deviceId === 'string') clean.deviceId = body.deviceId.slice(0, 200);
    if (Object.keys(clean).length) writeSyncState(clean);
    res.json({ ok: true, ...readSyncState() });
  });

  app.post('/api/files/read', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const file = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!file || !assertPathAllowed(file, res)) return;
    try {
      const st = statSync(file);
      if (!st.isFile()) {
        res.status(400).json({ ok: false, error: '不是文件' });
        return;
      }
      if (st.size > 2 * 1024 * 1024) {
        res.status(400).json({ ok: false, error: '文件超过 2MB，建议用本地编辑器打开' });
        return;
      }
      const content = readFileSync(file, 'utf8');
      res.json({ ok: true, path: file, content });
    } catch (e) {
      res.status(500).json({ ok: false, error: '读取失败: ' + (e as Error).message });
    }
  });

  /* ========== P3: 多文件变更管理（暂存/审批/原子提交） ========== */

  // 暂存变更（AI 生成的文件内容先暂存，不直接写入）
  app.post('/api/changes/stage', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const content = typeof body?.content === 'string' ? body.content : '';
    if (!path) { res.status(400).json({ ok: false, error: '缺少 path 字段' }); return; }
    const change = changeManager.stageChange(path, content);
    if (!change) { res.status(400).json({ ok: false, error: '内容未变化或暂存区已满' }); return; }
    res.json({ ok: true, change: { path: change.path, type: change.type, additions: change.additions, deletions: change.deletions, status: change.status, hunks: change.hunks } });
  });

  // 获取所有暂存变更（变更面板数据）
  app.get('/api/changes', (_req: Request, res: Response) => {
    res.json({ ok: true, ...changeManager.toPanelData() });
  });

  // 接受整个文件的变更
  app.post('/api/changes/accept', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!path) { res.status(400).json({ ok: false, error: '缺少 path 字段' }); return; }
    const ok = changeManager.acceptFile(path);
    res.json({ ok, ...(ok ? {} : { error: '文件不存在' }) });
  });

  // 拒绝整个文件的变更
  app.post('/api/changes/reject', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!path) { res.status(400).json({ ok: false, error: '缺少 path 字段' }); return; }
    const ok = changeManager.rejectFile(path);
    res.json({ ok, ...(ok ? {} : { error: '文件不存在' }) });
  });

  // 接受单个 Hunk
  app.post('/api/changes/hunk/accept', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const hunkIndex = typeof body?.hunkIndex === 'number' ? body.hunkIndex : -1;
    if (!path || hunkIndex < 0) { res.status(400).json({ ok: false, error: '缺少 path 或 hunkIndex' }); return; }
    const ok = changeManager.acceptHunk(path, hunkIndex);
    res.json({ ok, ...(ok ? {} : { error: '文件或 Hunk 不存在' }) });
  });

  // 拒绝单个 Hunk
  app.post('/api/changes/hunk/reject', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const hunkIndex = typeof body?.hunkIndex === 'number' ? body.hunkIndex : -1;
    if (!path || hunkIndex < 0) { res.status(400).json({ ok: false, error: '缺少 path 或 hunkIndex' }); return; }
    const ok = changeManager.rejectHunk(path, hunkIndex);
    res.json({ ok, ...(ok ? {} : { error: '文件或 Hunk 不存在' }) });
  });

  // 原子化提交（写入所有已接受的变更，失败自动回滚）
  app.post('/api/changes/commit', (_req: Request, res: Response) => {
    const result = changeManager.commit();
    res.json({ ok: result.success, ...result });
  });

  // 丢弃所有暂存变更
  app.post('/api/changes/discard', (_req: Request, res: Response) => {
    changeManager.discardAll();
    res.json({ ok: true });
  });

  // 检测冲突
  app.post('/api/changes/detect-conflicts', (_req: Request, res: Response) => {
    const conflicts = changeManager.detectConflicts();
    res.json({ ok: true, conflicts });
  });

  /* ========== P1-2: MCP 协议管理 API ========== */
  // 获取当前 MCP 服务器配置
  app.get('/api/mcp/config', (_req: Request, res: Response) => {
    try {
      const cfg = loadConfig();
      const servers = (cfg.mcp?.servers ?? []).map((s: McpServerConfig) => ({
        name: s.name,
        command: s.command,
        args: s.args ?? [],
        env: s.env ? Object.keys(s.env) : [], // 只暴露环境变量名，不暴露值
      }));
      res.json({ ok: true, servers, count: servers.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: `读取配置失败: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  // 测试指定 MCP 服务器连接（临时连接，列出工具后关闭）
  app.post('/api/mcp/test', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) { res.status(400).json({ ok: false, error: '缺少 name 字段' }); return; }

    try {
      const cfg = loadConfig();
      const serverCfg = (cfg.mcp?.servers ?? []).find((s: McpServerConfig) => s.name === name);
      if (!serverCfg) {
        res.status(404).json({ ok: false, error: `未找到 MCP 服务器: ${name}` });
        return;
      }

      const startTime = Date.now();
      const client = await connectMcp(serverCfg);
      const tools = await client.listTools();
      const latencyMs = Date.now() - startTime;
      await client.close().catch(() => undefined);

      res.json({
        ok: true,
        name,
        connected: true,
        latencyMs,
        toolCount: tools.length,
        tools: tools.map((t: { name: string; description?: string }) => ({
          name: t.name,
          description: (t.description || '').slice(0, 100),
        })),
      });
    } catch (e) {
      res.json({
        ok: false,
        name,
        connected: false,
        error: `连接失败: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  });

  // 列出所有 MCP 服务器的工具（逐个连接测试，返回汇总）
  app.get('/api/mcp/tools', async (_req: Request, res: Response) => {
    try {
      const cfg = loadConfig();
      const servers = cfg.mcp?.servers ?? [];
      const results: Array<{ name: string; ok: boolean; toolCount: number; error?: string }> = [];

      for (const s of servers) {
        try {
          const client = await connectMcp(s);
          const tools = await client.listTools();
          await client.close().catch(() => undefined);
          results.push({ name: s.name, ok: true, toolCount: tools.length });
        } catch (e) {
          results.push({ name: s.name, ok: false, toolCount: 0, error: e instanceof Error ? e.message : String(e) });
        }
      }

      res.json({ ok: true, servers: results, totalServers: servers.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: `获取 MCP 工具失败: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  /* ========== P2: 代码补全 API（真实接入 CompletionEngine） ========== */
  app.post('/api/completion', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const fileContent = typeof body?.fileContent === 'string' ? body.fileContent : '';
    const cursorOffset = typeof body?.cursorOffset === 'number' ? body.cursorOffset : fileContent.length;
    const mode = body?.mode === 'full' ? 'full' : 'quick';
    const language = typeof body?.language === 'string' ? body.language : undefined;
    const crossFileContext = typeof body?.crossFileContext === 'string' ? body.crossFileContext : undefined;
    if (!filePath || !fileContent) {
      res.status(400).json({ ok: false, error: '缺少 filePath 或 fileContent' });
      return;
    }
    if (!completionEngine) {
      res.json({ ok: true, suggestions: [], latencyMs: 0, model: '', cached: false, note: '未配置模型，补全不可用' });
      return;
    }
    try {
      const result = await completionEngine.complete({
        filePath,
        fileContent,
        cursorOffset,
        mode,
        language,
        crossFileContext,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: '补全失败: ' + (e as Error).message, suggestions: [] });
    }
  });

  app.post('/api/lint', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const code = typeof body?.code === 'string' ? body.code : '';
    const language = typeof body?.language === 'string' ? body.language : undefined;
    if (!code) {
      res.status(400).json({ ok: false, error: '缺少 code' });
      return;
    }
    const errors = lintSnippet(code, language);
    res.json({ ok: true, errors, clean: errors.length === 0 });
  });

  /* ========== 阶段一-2：补全 Pro API ========== */
  // 记录用户接受的补全（用于连续推荐）
  app.post('/api/completion/accept', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const cursorOffset = typeof body?.cursorOffset === 'number' ? body.cursorOffset : 0;
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!filePath || !text) { res.status(400).json({ ok: false, error: '缺少 filePath 或 text' }); return; }
    if (!completionEngine) { res.json({ ok: false, error: '补全引擎未初始化' }); return; }
    try {
      completionEngine.recordAcceptance(filePath, cursorOffset, text);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 推荐下一个改动点（补全 Pro 连续推荐）
  app.post('/api/completion/suggest-next', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const fileContent = typeof body?.fileContent === 'string' ? body.fileContent : '';
    const cursorOffset = typeof body?.cursorOffset === 'number' ? body.cursorOffset : fileContent.length;
    if (!filePath || !fileContent) { res.status(400).json({ ok: false, error: '缺少 filePath 或 fileContent' }); return; }
    if (!completionEngine) { res.json({ ok: true, suggested: false }); return; }
    try {
      const suggestion = completionEngine.suggestNext(filePath, fileContent, cursorOffset);
      res.json({ ok: true, ...suggestion });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  /* ========== P2-1: 设计稿转代码 API（多模态，图片→代码） ========== */
  // P1-3: 设计稿转代码引擎状态查询
  app.get('/api/design-to-code', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      configured: !!designToCodeEngine,
      framework: designToCodeEngine ? 'html' : null,
      note: designToCodeEngine ? '已配置多模态模型' : '未配置多模态模型（POST /api/design-to-code 需 vision 模型）',
    });
  });
  app.post('/api/design-to-code', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const image = typeof body?.image === 'string' ? body.image.trim() : '';
    const framework = body?.framework || 'html';
    const instructions = typeof body?.instructions === 'string' ? body.instructions : undefined;
    const previousCode = typeof body?.previousCode === 'string' ? body.previousCode : undefined;
    const feedback = typeof body?.feedback === 'string' ? body.feedback : undefined;

    if (!image) {
      res.status(400).json({ ok: false, error: '缺少 image 字段（base64 或 URL）' });
      return;
    }
    if (!designToCodeEngine) {
      res.status(503).json({ ok: false, error: '未配置多模态模型。请在模型设置中添加支持 vision 能力的模型（如 GPT-4V、Claude 3、通义千问 VL 等）。' });
      return;
    }

    try {
      const result = await designToCodeEngine.generate({
        image,
        framework,
        instructions,
        previousCode,
        feedback,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /* ========== P2-2: Git 集成 API ========== */
  // 获取 Git 状态
  app.get('/api/git/status', async (_req: Request, res: Response) => {
    try {
      const status = await gitIntegration.status();
      res.json({ ok: true, ...status });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 获取文件 diff
  app.post('/api/git/diff', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path : undefined;
    const staged = body?.staged === true;
    try {
      const diffs = await gitIntegration.diff(path, staged);
      res.json({ ok: true, diffs });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 暂存文件
  app.post('/api/git/add', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const paths = Array.isArray(body?.paths) ? body.paths.filter((p: unknown) => typeof p === 'string') : [];
    if (!paths.length) { res.status(400).json({ ok: false, error: '缺少 paths 字段' }); return; }
    try {
      const result = await gitIntegration.add(paths);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 取消暂存
  app.post('/api/git/reset', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const paths = Array.isArray(body?.paths) ? body.paths.filter((p: unknown) => typeof p === 'string') : [];
    if (!paths.length) { res.status(400).json({ ok: false, error: '缺少 paths 字段' }); return; }
    try {
      const result = await gitIntegration.reset(paths);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 提交
  app.post('/api/git/commit', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const paths = Array.isArray(body?.paths) ? body.paths.filter((p: unknown) => typeof p === 'string') : undefined;
    if (!message) { res.status(400).json({ ok: false, error: '提交信息不能为空' }); return; }
    try {
      const result = await gitIntegration.commit(message, paths);
      res.json({ ok: result.success, hash: result.hash, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 获取分支列表
  app.get('/api/git/branches', async (_req: Request, res: Response) => {
    try {
      const branches = await gitIntegration.branches();
      res.json({ ok: true, branches });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 切换分支
  app.post('/api/git/checkout', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const branch = typeof body?.branch === 'string' ? body.branch.trim() : '';
    const createNew = body?.createNew === true;
    if (!branch) { res.status(400).json({ ok: false, error: '缺少 branch 字段' }); return; }
    try {
      const result = await gitIntegration.checkout(branch, createNew);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 获取提交历史
  app.get('/api/git/log', async (req: Request, res: Response) => {
    const count = typeof req.query?.count === 'string' ? parseInt(req.query.count) : 20;
    try {
      const commits = await gitIntegration.log(Math.min(Math.max(count, 1), 100));
      res.json({ ok: true, commits });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 推送
  app.post('/api/git/push', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const remote = typeof body?.remote === 'string' ? body.remote : 'origin';
    const branch = typeof body?.branch === 'string' ? body.branch : undefined;
    const force = body?.force === true;
    try {
      const result = await gitIntegration.push(remote, branch, force);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 拉取
  app.post('/api/git/pull', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const remote = typeof body?.remote === 'string' ? body.remote : 'origin';
    const branch = typeof body?.branch === 'string' ? body.branch : undefined;
    try {
      const result = await gitIntegration.pull(remote, branch);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 初始化仓库
  app.post('/api/git/init', async (_req: Request, res: Response) => {
    try {
      const result = await gitIntegration.init();
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /* ========== P2-3: 团队协作 API ========== */
  app.get('/api/team', (_req: Request, res: Response) => {
    try {
      const team = teamManager.getTeam();
      const stats = teamManager.getStats();
      res.json({ ok: true, team, stats });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.put('/api/team/config', (req: Request, res: Response) => {
    try {
      const config = teamManager.updateConfig(req.body || {});
      res.json({ ok: true, config });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.get('/api/team/members', (_req: Request, res: Response) => {
    try { res.json({ ok: true, members: teamManager.getMembers() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.post('/api/team/members/invite', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const role = body?.role || 'developer';
    if (!name || !email) { res.status(400).json({ ok: false, error: '缺少 name 或 email' }); return; }
    try {
      const member = teamManager.inviteMember(name, email, role);
      res.json({ ok: true, member });
    } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.put('/api/team/members/:id/role', (req: Request, res: Response) => {
    try {
      const role = ((req.body ?? {}) as Record<string, any>).role;
      const member = teamManager.updateMemberRole(req.params.id, role);
      res.json({ ok: true, member });
    } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.delete('/api/team/members/:id', (req: Request, res: Response) => {
    try { teamManager.removeMember(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.get('/api/team/tasks', (req: Request, res: Response) => {
    try {
      const status = typeof req.query?.status === 'string' ? req.query.status as any : undefined;
      res.json({ ok: true, tasks: teamManager.getTasks(status) });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.post('/api/team/tasks', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) { res.status(400).json({ ok: false, error: '缺少 title' }); return; }
    try {
      const task = teamManager.createTask(title, body.createdBy || 'system', body);
      res.json({ ok: true, task });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.put('/api/team/tasks/:id', (req: Request, res: Response) => {
    try { res.json({ ok: true, task: teamManager.updateTask(req.params.id, req.body || {}) }); }
    catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.delete('/api/team/tasks/:id', (req: Request, res: Response) => {
    try { teamManager.deleteTask(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.post('/api/team/tasks/:id/comments', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) { res.status(400).json({ ok: false, error: '缺少 content' }); return; }
    try {
      const task = teamManager.addComment(req.params.id, body.author || 'anonymous', content);
      res.json({ ok: true, task });
    } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.get('/api/team/stats', (_req: Request, res: Response) => {
    try { res.json({ ok: true, stats: teamManager.getStats() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  /* ========== P3-2: SOLO 全自主编程 API ========== */
  // 启动 SOLO 任务
  app.post('/api/solo/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal) { res.status(400).json({ ok: false, error: '缺少 goal' }); return; }

    const taskId = `solo-${Date.now()}`;
    const config: SoloConfig = {
      cwd: serverWorkspaceDir,
      goal,
      maxTasks: body.maxTasks || 8,
      maxRetries: body.maxRetries || 3,
      parallel: body.parallel || false,
      maxParallel: body.maxParallel || 2,
      planOnly: body.planOnly || false,
      verifyOnly: body.verifyOnly || false,
      autoCorrect: body.autoCorrect !== false,
    };

    // 创建子任务执行器（简化版，实际应委托给 orchestrator）
    const executor = async (focusedGoal: string) => {
      try {
        // 简化执行：返回成功，实际应调用 orchestrator
        return { ok: true, output: `已执行: ${focusedGoal}`, touchedFiles: [], iterations: 1 };
      } catch (e) {
        return { ok: false, output: (e as Error).message, touchedFiles: [], iterations: 0 };
      }
    };

    const agent = new SoloAgent(config, executor);
    soloTasks.set(taskId, { agent, status: 'running' });

    // 异步执行
    (async () => {
      try {
        const report = await agent.run();
        const task = soloTasks.get(taskId);
        if (task) {
          task.report = report;
          task.status = report.overall === 'failed' ? 'failed' : 'completed';
        }
      } catch (e) {
        const task = soloTasks.get(taskId);
        if (task) {
          task.status = 'failed';
          task.report = {
            goal, cwd: serverWorkspaceDir, overall: 'failed', phase: 'failed',
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
            totalTasks: 0, completedTasks: 0, failedTasks: 0, skippedTasks: 0,
            tasks: [], summary: `执行失败: ${(e as Error).message}`, events: [],
          };
        }
      }
    })();

    res.json({ ok: true, taskId, message: 'SOLO 任务已启动' });
  });

  // 获取 SOLO 任务状态
  app.get('/api/solo/status/:id', (req: Request, res: Response) => {
    const task = soloTasks.get(req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '任务不存在' }); return; }
    const status = task.agent.getStatus();
    res.json({ ok: true, taskId: req.params.id, status: task.status, ...status });
  });

  // 获取 SOLO 任务报告
  app.get('/api/solo/report/:id', (req: Request, res: Response) => {
    const task = soloTasks.get(req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '任务不存在' }); return; }
    if (!task.report) { res.status(202).json({ ok: false, error: '任务尚未完成', status: task.status }); return; }
    res.json({ ok: true, report: task.report });
  });

  // 取消 SOLO 任务
  app.post('/api/solo/cancel/:id', (req: Request, res: Response) => {
    const task = soloTasks.get(req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '任务不存在' }); return; }
    if (task.status === 'running') {
      task.status = 'failed';
      res.json({ ok: true, message: '任务已取消' });
    } else {
      res.json({ ok: false, error: '任务已结束，无法取消' });
    }
  });

  // 列出所有 SOLO 任务
  app.get('/api/solo/list', (_req: Request, res: Response) => {
    const tasks = Array.from(soloTasks.entries()).map(([id, task]) => ({
      id,
      status: task.status,
      goal: task.report?.goal || '',
      startedAt: task.report?.startedAt,
      completedAt: task.report?.completedAt,
    }));
    res.json({ ok: true, tasks });
  });

  /* ========== 阶段二-1：多智能体协同 API ========== */
  // 运行多智能体协同（架构师/开发/测试/评审）
  app.post('/api/multi-agent/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal) { res.status(400).json({ ok: false, error: '缺少 goal' }); return; }
    if (!sharedModelRouter) { res.status(500).json({ ok: false, error: '模型未配置' }); return; }

    const config: MultiAgentConfig = {
      roles: body.roles || ['architect', 'developer', 'tester', 'reviewer'],
      maxRounds: body.maxRounds || 3,
      enableReviewLoop: body.enableReviewLoop !== false,
    };

    try {
      const result = await runMultiAgent(sharedModelRouter, goal, config, body.context);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: '多智能体协同失败: ' + (e as Error).message });
    }
  });

  // 获取角色配置
  app.get('/api/multi-agent/roles', (_req: Request, res: Response) => {
    try {
      import('../agent/multi-agent').then(({ AGENT_ROLES }) => {
        const roles = Object.values(AGENT_ROLES).map((r) => ({
          role: r.role,
          name: r.name,
          description: r.description,
          capabilities: r.capabilities,
        }));
        res.json({ ok: true, roles });
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /* ========== 阶段二-2：事件驱动 Agent API ========== */
  // 获取事件驱动配置
  app.get('/api/event-driven/config', (_req: Request, res: Response) => {
    try { res.json({ ok: true, config: eventDrivenManager.getConfig() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 获取事件历史
  app.get('/api/event-driven/events', (req: Request, res: Response) => {
    try {
      const limit = typeof req.query?.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
      res.json({ ok: true, events: eventDrivenManager.getEvents(limit) });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 手动触发事件
  app.post('/api/event-driven/trigger', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    if (!body.type || !body.title) { res.status(400).json({ ok: false, error: '缺少 type 或 title' }); return; }
    eventDrivenManager.triggerEvent({
      type: body.type,
      severity: body.severity || 'info',
      title: body.title,
      description: body.description || '',
      source: body.source || 'manual',
      payload: body.payload,
    }).then((event) => res.json({ ok: true, event }))
      .catch((e) => res.status(500).json({ ok: false, error: (e as Error).message }));
  });

  // Cron 任务 CRUD
  app.get('/api/event-driven/cron', (_req: Request, res: Response) => {
    try {
      const cfg = eventDrivenManager.getConfig() as { cronTasks?: unknown[] };
      res.json({ ok: true, cronTasks: cfg.cronTasks ?? [] });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });
  app.post('/api/event-driven/cron', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    if (!body.name || !body.cron || !body.task) { res.status(400).json({ ok: false, error: '缺少 name/cron/task' }); return; }
    try {
      const task = eventDrivenManager.addCronTask({
        name: body.name,
        cron: body.cron,
        task: body.task,
        enabled: body.enabled !== false,
        debounceMs: body.debounceMs || 0,
      } as any);
      res.json({ ok: true, task });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.put('/api/event-driven/cron/:id', (req: Request, res: Response) => {
    try {
      const task = eventDrivenManager.updateCronTask(req.params.id, (req.body ?? {}) as any);
      if (!task) { res.status(404).json({ ok: false, error: '任务不存在' }); return; }
      res.json({ ok: true, task });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.delete('/api/event-driven/cron/:id', (req: Request, res: Response) => {
    try {
      const ok = eventDrivenManager.removeCronTask(req.params.id);
      res.json({ ok, message: ok ? '已删除' : '任务不存在' });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // Webhook 接收
  app.post('/api/event-driven/webhook/:path', (req: Request, res: Response) => {
    const path = `/webhook/${req.params.path}`;
    eventDrivenManager.handleWebhook(path, (req.body || {}) as Record<string, unknown>, req.headers as Record<string, string>)
      .then((result) => res.json(result))
      .catch((e) => res.status(500).json({ ok: false, error: (e as Error).message }));
  });

  /* ========== 阶段二-3：自定义 Agent API ========== */
  // 获取所有自定义 Agent
  app.get('/api/custom-agents', (req: Request, res: Response) => {
    try {
      const category = typeof req.query?.category === 'string' ? req.query.category : undefined;
      res.json({ ok: true, agents: customAgentManager.getAllAgents(category) });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 获取 Agent 分类
  app.get('/api/custom-agents/categories', (_req: Request, res: Response) => {
    try { res.json({ ok: true, categories: customAgentManager.getCategories() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 匹配推荐 Agent
  app.post('/api/custom-agents/match', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const input = typeof body?.input === 'string' ? body.input : '';
    if (!input) { res.status(400).json({ ok: false, error: '缺少 input' }); return; }
    try {
      const limit = typeof body?.limit === 'number' ? body.limit : 3;
      res.json({ ok: true, agents: customAgentManager.matchAgents(input, limit) });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 获取单个 Agent
  app.get('/api/custom-agents/:id', (req: Request, res: Response) => {
    try {
      const agent = customAgentManager.getAgent(req.params.id);
      if (!agent) { res.status(404).json({ ok: false, error: 'Agent 不存在' }); return; }
      res.json({ ok: true, agent });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 创建自定义 Agent
  app.post('/api/custom-agents', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    if (!body.name || !body.systemPrompt) { res.status(400).json({ ok: false, error: '缺少 name 或 systemPrompt' }); return; }
    try {
      const agent = customAgentManager.createAgent({
        name: body.name,
        description: body.description || '',
        systemPrompt: body.systemPrompt,
        tools: body.tools || [],
        modelConfig: body.modelConfig || { temperature: 0.3, maxTokens: 2000, timeoutMs: 30000 },
        triggers: body.triggers || [],
        icon: body.icon || '🤖',
        category: body.category || 'custom',
        enabled: body.enabled !== false,
        author: body.author,
        version: body.version || '1.0.0',
      });
      res.json({ ok: true, agent });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 更新自定义 Agent
  app.put('/api/custom-agents/:id', (req: Request, res: Response) => {
    try {
      const agent = customAgentManager.updateAgent(req.params.id, (req.body ?? {}) as any);
      if (!agent) { res.status(404).json({ ok: false, error: 'Agent 不存在' }); return; }
      res.json({ ok: true, agent });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 删除自定义 Agent
  app.delete('/api/custom-agents/:id', (req: Request, res: Response) => {
    try {
      const ok = customAgentManager.deleteAgent(req.params.id);
      res.json({ ok, message: ok ? '已删除' : 'Agent 不存在或为内置 Agent' });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 执行自定义 Agent
  app.post('/api/custom-agents/:id/execute', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const input = typeof body?.input === 'string' ? body.input : '';
    if (!input) { res.status(400).json({ ok: false, error: '缺少 input' }); return; }
    if (!sharedModelRouter) { res.status(500).json({ ok: false, error: '模型未配置' }); return; }
    try {
      const result = await customAgentManager.executeAgent(req.params.id, input, sharedModelRouter, body?.context);
      res.json({ ok: result.success, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  /* ========== 打开本地文件夹/浏览器 ========== */
  app.post('/api/open/folder', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const dir = typeof body?.path === 'string' ? body.path.trim() : serverWorkspaceDir;
    if (!dir || !assertPathAllowed(dir, res)) return;
    try {
      openFolder(dir);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: '打开失败: ' + (e as Error).message });
    }
  });

  app.post('/api/open/browser', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      res.status(400).json({ ok: false, error: '缺少 url 字段' });
      return;
    }
    try {
      openBrowser(url);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: '打开失败: ' + (e as Error).message });
    }
  });

  /* ========== 上传文件/图片 ========== */
  const uploadsDir = () => join(homeDir, 'uploads');
  app.post('/api/upload', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const mime = typeof body?.mime === 'string' ? body.mime.trim() : 'application/octet-stream';
    const data = typeof body?.dataBase64 === 'string' ? body.dataBase64.trim() : '';
    if (!name || !data) {
      res.status(400).json({ ok: false, error: '缺少 name 或 dataBase64 字段' });
      return;
    }
    try {
      mkdirSync(uploadsDir(), { recursive: true });
      const safeName = name.replace(/[^a-zA-Z0-9_.\-]/g, '_');
      const dest = join(uploadsDir(), `${Date.now()}_${safeName}`);
      writeFileSync(dest, Buffer.from(data, 'base64'));
      res.json({ ok: true, path: dest, name, mime });
    } catch (e) {
      res.status(500).json({ ok: false, error: '上传失败: ' + (e as Error).message });
    }
  });

  /* ========== 系统截图（调用 Windows 截图工具，不弹浏览器分享框） ========== */
  app.post('/api/screenshot', (_req: Request, res: Response) => {
    try {
      // Windows 10/11 内置截图工具（和 Win+Shift+S 效果一样）
      // 调用后直接进入截图模式，用户截图后图片保存到剪贴板
      if (process.platform === 'win32') {
        exec('explorer.exe ms-screenclip:', (err: Error | null) => {
          if (err) {
            res.status(500).json({ ok: false, error: '启动截图工具失败: ' + err.message });
          } else {
            res.json({ ok: true, message: '截图工具已启动，截图后按 Ctrl+V 粘贴到输入框' });
          }
        });
      } else {
        res.status(400).json({ ok: false, error: '仅支持 Windows 系统' });
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: '启动截图工具失败: ' + (e as Error).message });
    }
  });

  // 电脑操作（鼠标/键盘/截图/打开应用）：B2 拆分至 web/routes/computer.ts
  registerComputerRoutes(app);

  // ========== 自然语言指令直达（手机对话发指令 → 电脑端执行） ==========
  // 解析规则：打开/启动/运行 X → app/open；截图/截屏 → screenshot；
  // 输入 X → keyboard/type；按 X/按键 X → keyboard/press；点击/单击 → mouse/click；其余尝试作为命令执行
  function parseNaturalCommand(text: string): { action: string; params: Record<string, any> } | null {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const lower = t.toLowerCase();
    // 打开类
    const openMatch = /^(打开|启动|运行|开启|帮我打开|帮我启动|帮我运行|open|launch|start|run)\s*[:：]?\s*(.+)$/.exec(t);
    if (openMatch) {
      return { action: 'app/open', params: { app: openMatch[2].trim() } };
    }
    // 截图类
    if (/^(截图|截屏|屏幕截图|screenshot|screen\s*shot|capture)\s*$/.test(lower)) {
      return { action: 'screenshot', params: {} };
    }
    // 输入类
    const typeMatch = /^(输入|键入|打上|type)\s*[:：]?\s*(.+)$/.exec(t);
    if (typeMatch) {
      return { action: 'keyboard/type', params: { text: typeMatch[2].trim() } };
    }
    // 按键类
    const keyMatch = /^(按下|按|按键|press)\s*[:：]?\s*(.+)$/.exec(t);
    if (keyMatch) {
      return { action: 'keyboard/press', params: { key: keyMatch[2].trim() } };
    }
    // 点击类（含坐标）
    const clickMatch = /^(点击|单击|点一下|click)\s*[:：]?\s*(?:\((\d+)[,，\s]+(\d+)\))?\s*$/i.exec(t);
    if (clickMatch) {
      const params: Record<string, any> = {};
      if (clickMatch[2] && clickMatch[3]) {
        params.x = parseInt(clickMatch[2], 10);
        params.y = parseInt(clickMatch[3], 10);
      }
      return { action: 'mouse/click', params };
    }
    // 兜底：视为要执行的命令/打开项（如 "chrome"、"D:\x\a.exe"）
    return { action: 'app/open', params: { app: t } };
  }
  // 自然语言指令直达：POST /api/computer/nl  body: { text: '打开微信' }
  app.post('/api/computer/nl', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const text = String(body?.text ?? '').trim();
      if (!text) {
        res.status(400).json({ ok: false, error: '缺少 text 字段（自然语言指令，如：打开微信）' });
        return;
      }
      const parsed = parseNaturalCommand(text);
      if (!parsed) {
        res.status(400).json({ ok: false, error: '无法解析指令，请换一种说法（如：打开微信 / 截图 / 输入你好）' });
        return;
      }
      // 根据解析结果分发到对应 computer API 执行
      let result: Record<string, any>;
      switch (parsed.action) {
        case 'app/open': {
          const script = `
            $t = '${String(parsed.params.app ?? '').replace(/'/g, "''")}'
            if ($t -match '^https?://' -or $t -match '^shell:') { Start-Process $t }
            elseif (Test-Path $t) { Start-Process $t }
            else {
              try { Start-Process $t -ErrorAction Stop } catch {
                $found = (where.exe $t 2>$null | Select-Object -First 1)
                if ($found) { Start-Process $found } else { throw "应用未找到: $t" }
              }
            }
            Write-Output "ok:$t"
          `;
          const out = await runPowerShell(script);
          result = { ok: true, action: 'app/open', app: parsed.params.app, message: out || `已执行：${text}` };
          break;
        }
        case 'screenshot': {
          const script = `
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen
            $bounds = $screen.Bounds
            $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            $ms = New-Object System.IO.MemoryStream
            $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $bytes = $ms.ToArray()
            [Convert]::ToBase64String($bytes)
          `;
          const base64 = await runPowerShell(script);
          result = { ok: true, action: 'screenshot', image: 'data:image/png;base64,' + base64, width: 1920, height: 1080 };
          break;
        }
        case 'keyboard/type': {
          const textToType = String(parsed.params.text ?? '');
          const escaped = textToType.replace(/([+^%~(){}])/g, '{$1}');
          const script = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
            Write-Output "ok"
          `;
          await runPowerShell(script);
          result = { ok: true, action: 'keyboard/type', text: textToType };
          break;
        }
        case 'keyboard/press': {
          const key = String(parsed.params.key ?? '');
          const script = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('${key.replace(/'/g, "''")}')
            Write-Output "ok"
          `;
          await runPowerShell(script);
          result = { ok: true, action: 'keyboard/press', key };
          break;
        }
        case 'mouse/click': {
          const x = parsed.params.x;
          const y = parsed.params.y;
          const movePart = (x !== undefined && y !== undefined) ? `[MouseHelper]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -Milliseconds 100;` : '';
          const script = `
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class MouseHelper {
                [DllImport("user32.dll")]
                public static extern bool SetCursorPos(int X, int Y);
                [DllImport("user32.dll")]
                public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
            }
"@
            ${movePart}
            [MouseHelper]::mouse_event(0x0002, 0, 0, 0, 0)
            [MouseHelper]::mouse_event(0x0004, 0, 0, 0, 0)
            Write-Output "ok"
          `;
          await runPowerShell(script);
          result = { ok: true, action: 'mouse/click', x: x ?? null, y: y ?? null };
          break;
        }
        default:
          result = { ok: false, error: '未知动作' };
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: '指令执行失败: ' + (e as Error).message });
    }
  });

  /* ========== 能力来源域（节点系统/技能市场/自动化/模板库/办公助理）→ routes/capability-source.ts ========== */
  registerCapabilitySourceRoutes(app, { homeDir, queue, loadJsonFile, saveJsonFile });
  /* ========== 大模型配置（三重加密：apiKey AES-256-GCM 落盘加密 + RSA 加密传输） ========== */
  const modelsFile = join(homeDir, 'models.json');
  interface ModelConfig {
    id: string;
    name: string;
    apiBase: string;
    apiKey: string; // 存储层为 AES-256-GCM 密文（v1:...），对外永不明文返回
    reasoning?: string;
    default?: boolean;
  }
  function loadModels(): ModelConfig[] {
    const list = loadJsonFile<ModelConfig[]>(modelsFile, []);
    return Array.isArray(list) ? list : [];
  }
  /** 解析真实（解密）apiKey，供任务执行器使用 */
  function resolveApiKey(m: ModelConfig): string {
    if (!m.apiKey) return '';
    return isEncrypted(m.apiKey) ? decryptText(m.apiKey, masterKey) : m.apiKey;
  }
  /** 对外脱敏视图：任何接口都不返回密钥（明文或密文） */
  function publicModel(m: ModelConfig): ModelConfig {
    return { ...m, apiKey: '' };
  }
  function saveModels(list: ModelConfig[]): boolean {
    // 明文 key 加密后再落盘（已加密的跳过，避免二次加密）
    const encList = list.map((m) =>
      m.apiKey && !isEncrypted(m.apiKey) ? { ...m, apiKey: encryptText(m.apiKey, masterKey) } : m,
    );
    const ok = saveJsonFile(modelsFile, encList);
    // 同步更新任务队列的模型配置，使用解密后的真实 key（即使落盘失败也更新内存态）
    queue.setModelProviders(encList.map((m) => ({
      id: m.id,
      type: 'openai-compatible' as const,
      baseURL: m.apiBase,
      apiKey: resolveApiKey(m),
      model: m.name,
    })));
    // P2: 同步更新补全引擎
    rebuildCompletionEngine(encList);
    return ok;
  }
  // 初始化模型提供列表，并注册到任务队列
  const initialModels = loadModels();
  queue.setModelProviders(initialModels.map((m) => ({
    id: m.id,
    type: 'openai-compatible' as const,
    baseURL: m.apiBase,
    apiKey: resolveApiKey(m),
    model: m.name,
  })));

  /* ========== P2: 共享 ModelRouter + CompletionEngine（供 /api/completion 使用） ========== */
  let sharedModelRouter: ModelRouter | null = null;
  let completionEngine: CompletionEngine | null = null;
  // P2-1: 设计稿转代码引擎（多模态）
  let designToCodeEngine: DesignToCodeEngine | null = null;

  function rebuildCompletionEngine(models: ModelConfig[]): void {
    try {
      const providers = models
        .filter((m) => m.apiBase && m.name)
        .map((m) => new OpenAICompatibleProvider({
          id: m.id,
          type: 'openai-compatible',
          baseURL: m.apiBase,
          apiKey: resolveApiKey(m),
          model: m.name,
          tags: ['code-gen', 'cheap'],
        }));
      if (!providers.length) {
        sharedModelRouter = null;
        completionEngine = null;
        designToCodeEngine = null;
        return;
      }
      sharedModelRouter = new ModelRouter(providers, 'capability', 1.0);
      // 阶段一-1：构建代码图谱，用于跨文件上下文注入
      const codeGraph = buildCodeGraph(serverWorkspaceDir, { maxFiles: 500 });
      completionEngine = createCompletionEngine(sharedModelRouter, {
        maxPrefixChars: 1500,
        maxSuffixChars: 500,
        quickMaxTokens: 64,
        fullMaxTokens: 256,
        cacheTtlMs: 10000,
        enableSyntaxCheck: true,
      }, codeGraph);
      // P2-1: 更新设计稿转代码引擎的模型提供者
      designToCodeEngine = createDesignToCodeEngine(providers);
    } catch (e) {
      console.error('[completion] rebuild failed:', e);
      sharedModelRouter = null;
      completionEngine = null;
      designToCodeEngine = null;
    }
  }

  // 初始化时构建
  rebuildCompletionEngine(initialModels);
  // 第二重（通信层）：向客户端下发 RSA 公钥，用于加密敏感参数（如模型 API Key）传输
  app.get('/api/security/public-key', (_req: Request, res: Response) => {
    res.json({ ok: true, publicKey: rsaKeys.publicKey, algorithm: 'RSA-OAEP-2048-SHA256' });
  });
  app.get('/api/models', (_req: Request, res: Response) => {
    const list = loadModels().map(publicModel);
    res.json({ ok: true, models: list, defaultId: (list.find((m) => m.default) || {}).id || null });
  });
  // P1-3: 模型提供商聚合视图（按 apiBase 分组）
  app.get('/api/models/providers', (_req: Request, res: Response) => {
    const list = loadModels().map(publicModel);
    const byKey = new Map<string, { providerId: string; apiBase: string; models: ModelConfig[]; count: number }>();
    for (const m of list) {
      const key = m.apiBase || 'custom';
      let entry = byKey.get(key);
      if (!entry) {
        entry = { providerId: key, apiBase: key, models: [], count: 0 };
        byKey.set(key, entry);
      }
      entry.models.push(m);
      entry.count++;
    }
    res.json({ ok: true, providers: Array.from(byKey.values()), total: list.length });
  });
  app.post('/api/models', (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const apiBase = typeof body?.apiBase === 'string' ? body.apiBase.trim() : '';
    let apiKey = typeof body?.apiKey === 'string' ? body.apiKey : '';
    // 支持 RSA 公钥加密传输的密钥（App 端使用，防窃听/防中间人截取明文 Key）
    if (typeof body?.apiKeyEnc === 'string' && body.apiKeyEnc) {
      const dec = rsaDecrypt(body.apiKeyEnc, rsaKeys.privateKey);
      if (dec) apiKey = dec;
    }
    const reasoning = typeof body?.reasoning === 'string' ? body.reasoning : '';
    if (!name) {
      res.status(400).json({ ok: false, error: '请填写模型名称' });
      return;
    }
    const list = loadModels();
    const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();
    const idx = list.findIndex((m) => m.id === id);
    let saved: ModelConfig;
    if (idx >= 0) {
      // 编辑场景：未提供新 key 则保留原密钥（前端不再回填明文）
      const cfg: ModelConfig = {
        id, name, apiBase,
        apiKey: apiKey || list[idx].apiKey,
        reasoning,
      };
      list[idx] = { ...list[idx], ...cfg };
      saved = list[idx];
    } else {
      saved = { id, name, apiBase, apiKey, reasoning };
      list.push(saved);
    }
    if (!saveModels(list)) {
      res.status(500).json({ ok: false, error: '模型配置保存失败（磁盘不可写，已保留内存态）' });
      return;
    }
    res.json({ ok: true, model: publicModel(saved) });
  });
  app.delete('/api/models/:id', (req: Request, res: Response) => {
    let list = loadModels();
    const target = list.find((m) => m.id === req.params.id);
    list = list.filter((m) => m.id !== req.params.id);
    // 若删除的是默认，且没有其它默认，则把第一个设为默认
    if (target?.default && !list.some((m) => m.default) && list.length) list[0].default = true;
    if (!saveModels(list)) {
      res.status(500).json({ ok: false, error: '模型配置保存失败（磁盘不可写，已保留内存态）' });
      return;
    }
    res.json({ ok: true });
  });
  app.post('/api/models/:id/default', (req: Request, res: Response) => {
    const list = loadModels();
    const target = list.find((m) => m.id === req.params.id);
    if (!target) {
      res.status(404).json({ ok: false, error: '模型不存在' });
      return;
    }
    list.forEach((m) => (m.default = m.id === req.params.id));
    if (!saveModels(list)) {
      res.status(500).json({ ok: false, error: '模型配置保存失败（磁盘不可写，已保留内存态）' });
      return;
    }
    res.json({ ok: true, defaultId: target.id });

  });

  /* ========== Cline 进程级嫁接：fhcode 调度 → Cline CLI 免费模型执行 ========== */
  app.get('/api/cline/status', (_req: Request, res: Response) => {
    try {
      const available = isClineInstalled();
      let version = '';
      try {
        const cp = require('child_process');
        version = cp.execSync('cline --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0] || '';
      } catch { /* 忽略 */ }
      res.json({ ok: true, available, version });
    } catch (e: any) {
      res.json({ ok: true, available: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/cline/run', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const task = String(body?.task ?? '').trim();
      if (!task) { res.status(400).json({ ok: false, error: '缺少任务内容' }); return; }
      const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
      const timeoutMs = Number(body?.timeoutMs) > 0 ? Number(body.timeoutMs) : 180000;
      const args: string[] = ['--json', '-t', '90'];
      if (model) args.push('-m', model);
      args.push(' ' + task + ' '); // 首尾空格：Windows spawn 自动加引号，Cline 才能识别为 prompt
      const t0 = Date.now();
      const r = await runClineCli(args, { cwd: homeDir, timeoutMs });
      const combined = `${r.stdout}${r.stderr}`;
      const rateLimited = detectRateLimit(combined);
      const elapsedMs = Date.now() - t0;
      // 解析 NDJSON 中的最终文本
      let text = '';
      for (const line of combined.split('\n')) {
        if (!line.trim() || !line.startsWith('{')) continue;
        try {
          const ev = JSON.parse(line);
          const e = ev?.event;
          if (e && (e.type === 'done' || e.type === 'message') && typeof e.text === 'string') text = e.text;
          if (ev?.type === 'message' && typeof ev?.message?.content === 'string') text = ev.message.content;
        } catch { /* 忽略非JSON行 */ }
      }
      res.json({
        ok: r.code === 0,
        rateLimited,
        elapsedMs,
        code: r.code,
        text: text || combined.slice(0, 2000),
        raw: combined.slice(0, 8000),
        error: rateLimited ? 'CLINE_RATE_LIMIT: 免费额度受限，请退回主模型' : (r.code !== 0 ? combined.slice(0, 1200) : ''),
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  /* ========== 云桥接（Cloud Bridge）：手机发指令 → 云端队列 → 电脑端执行 → 结果回传 ========== */
  // 数据模型：devices（电脑设备注册）+ commands（待执行指令队列）
  // 电脑端在内网无公网入口，由电脑端桥接代理主动长轮询拉取指令执行；
  // 手机端把指令 POST 到云端队列，再轮询结果。全部落盘 FH_HOME 下，重启不丢。
  interface BridgeDevice {
    deviceId: string;
    name: string;
    lastSeenAt: string;
    status: 'online' | 'offline';
    createdAt: string;
  }
  interface BridgeCommand {
    cmdId: string;
    deviceId: string;
    text: string;
    status: 'queued' | 'running' | 'done' | 'failed' | 'refused' | 'paused';
    result?: Record<string, any>;
    error?: string;
    createdAt: string;
    executedAt?: string;
  }
  const bridgeFile = join(homeDir, 'bridge-devices.json');
  const bridgeCmdsFile = join(homeDir, 'bridge-commands.json');
  function loadBridgeDevices(): BridgeDevice[] { return loadJsonFile<BridgeDevice[]>(bridgeFile, []); }
  function saveBridgeDevices(list: BridgeDevice[]): boolean { return saveJsonFile(bridgeFile, list); }
  function loadBridgeCommands(): BridgeCommand[] { return loadJsonFile<BridgeCommand[]>(bridgeCmdsFile, []); }
  function saveBridgeCommands(list: BridgeCommand[]): boolean { return saveJsonFile(bridgeCmdsFile, list); }

  // 设备注册 / 心跳：电脑端桥接代理每次轮询前调用，标记在线
  app.post('/api/bridge/register', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const deviceId = String(body?.deviceId ?? '').trim();
    const name = String(body?.name ?? '').trim() || '未命名电脑';
    if (!deviceId) { res.status(400).json({ ok: false, error: '缺少 deviceId' }); return; }
    const list = loadBridgeDevices();
    const now = new Date().toISOString();
    const found = list.find((d) => d.deviceId === deviceId);
    if (found) { found.lastSeenAt = now; found.status = 'online'; found.name = name; }
    else { list.push({ deviceId, name, lastSeenAt: now, status: 'online', createdAt: now }); }
    saveBridgeDevices(list);
    res.json({ ok: true, deviceId, status: 'online' });
  });

  // 手机端：发送指令到指定电脑（入队）
  app.post('/api/bridge/command', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const deviceId = String(body?.deviceId ?? '').trim();
    const text = String(body?.text ?? '').trim();
    if (!deviceId) { res.status(400).json({ ok: false, error: '缺少 deviceId（目标电脑）' }); return; }
    if (!text) { res.status(400).json({ ok: false, error: '缺少 text（指令内容）' }); return; }
    const devices = loadBridgeDevices();
    if (!devices.some((d) => d.deviceId === deviceId)) {
      res.status(404).json({ ok: false, error: '目标电脑未注册，请先在该电脑启动 fhcode bridge' });
      return;
    }
    const cmd: BridgeCommand = {
      cmdId: randomUUID(),
      deviceId,
      text,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    const list = loadBridgeCommands();
    list.unshift(cmd);
    // 只保留每设备最近 200 条，防止无限增长
    saveBridgeCommands(list.slice(0, 200));
    res.json({ ok: true, cmdId: cmd.cmdId, status: 'queued' });
  });

  // 电脑端桥接代理：拉取待执行指令（长轮询，一次取一条，取后标记 running）
  app.get('/api/bridge/pending', (req: Request, res: Response) => {
    const deviceId = String(req.query.deviceId ?? '').trim();
    if (!deviceId) { res.status(400).json({ ok: false, error: '缺少 deviceId' }); return; }
    // 心跳：更新在线状态
    const devices = loadBridgeDevices();
    const dev = devices.find((d) => d.deviceId === deviceId);
    if (dev) { dev.lastSeenAt = new Date().toISOString(); dev.status = 'online'; saveBridgeDevices(devices); }
    const list = loadBridgeCommands();
    const idx = list.findIndex((c) => c.deviceId === deviceId && c.status === 'queued');
    if (idx < 0) { res.json({ ok: true, command: null }); return; }
    const cmd = list[idx];
    cmd.status = 'running';
    cmd.executedAt = new Date().toISOString();
    saveBridgeCommands(list);
    res.json({ ok: true, command: { cmdId: cmd.cmdId, text: cmd.text } });
  });

  // 电脑端桥接代理：回传执行结果
  app.post('/api/bridge/result', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const cmdId = String(body?.cmdId ?? '').trim();
    const deviceId = String(body?.deviceId ?? '').trim();
    const okFlag = body?.ok === true;
    const result = body?.result;
    const error = String(body?.error ?? '');
    if (!cmdId || !deviceId) { res.status(400).json({ ok: false, error: '缺少 cmdId 或 deviceId' }); return; }
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId && c.deviceId === deviceId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    cmd.status = okFlag ? 'done' : 'failed';
    if (okFlag) cmd.result = result ?? {};
    else cmd.error = error || '执行失败';
    saveBridgeCommands(list);
    res.json({ ok: true, status: cmd.status });
  });

  // 手机端：查询指令执行结果
  app.get('/api/bridge/command/:cmdId', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const cmd = loadBridgeCommands().find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    res.json({ ok: true, command: cmd });
  });

  // 手机端：列出已注册电脑设备
  app.get('/api/bridge/devices', (_req: Request, res: Response) => {
    res.json({ ok: true, devices: loadBridgeDevices() });
  });

  // 授权状态查询（Web/手机端展示）
  app.get('/api/license', (_req: Request, res: Response) => {
    const state = licenseState();
    res.json({ ok: true, license: state, text: licenseText(state) });
  });

  // 激活（手机端/Web 输入激活码）
  app.post('/api/license/activate', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const key = String(body.text ?? body.key ?? '').trim();
    if (!key) { res.status(400).json({ ok: false, error: '缺少激活码' }); return; }
    // 暴力破解防护：IP 维度
    const ip = (req as any).ip || (req.socket as any)?.remoteAddress || 'unknown';
    const guardKey = `license:${ip}`;
    if (bruteForce.isLocked(guardKey)) {
      res.status(429).json({ ok: false, error: '激活尝试过于频繁，请 15 分钟后再试' });
      return;
    }
    const result = activateLicense(key);
    if (!result.ok) {
      bruteForce.recordFailure(guardKey);
      res.status(400).json({ ok: false, error: result.error || '激活失败' });
      return;
    }
    bruteForce.clear(guardKey);
    res.json({ ok: true, license: result.state, text: licenseText(result.state!) });
  });

  // 电脑端：列出本设备的全部指令（含状态/结果，供管理面板查看）
  app.get('/api/bridge/commands', (req: Request, res: Response) => {
    const deviceId = String(req.query.deviceId ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    let list = loadBridgeCommands();
    if (deviceId) list = list.filter((c) => c.deviceId === deviceId);
    if (status) list = list.filter((c) => c.status === status);
    res.json({ ok: true, commands: list.slice(0, 200) });
  });

  // 电脑端：修改指令内容（仅未执行的指令可改；已 running/done/failed 的不允许改）
  app.post('/api/bridge/command/:cmdId/edit', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const body = (req.body ?? {}) as Record<string, any>;
    const newText = String(body?.text ?? '').trim();
    if (!newText) { res.status(400).json({ ok: false, error: '缺少新的指令内容 text' }); return; }
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    if (cmd.status === 'running' || cmd.status === 'done') {
      res.status(409).json({ ok: false, error: '指令已在执行或已完成，无法修改' });
      return;
    }
    cmd.text = newText;
    cmd.status = 'queued';
    cmd.error = undefined;
    cmd.result = undefined;
    saveBridgeCommands(list);
    res.json({ ok: true, command: cmd });
  });

  // 电脑端：批准执行（把 queued/paused 指令设为待执行；与「重发」等效）
  app.post('/api/bridge/command/:cmdId/approve', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    if (cmd.status === 'running') { res.status(409).json({ ok: false, error: '指令正在执行中' }); return; }
    cmd.status = 'queued';
    cmd.error = undefined;
    cmd.result = undefined;
    saveBridgeCommands(list);
    res.json({ ok: true, command: cmd });
  });

  // 电脑端：拒绝/撤销指令（标记 refused，电脑端不执行）
  app.post('/api/bridge/command/:cmdId/refuse', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    if (cmd.status === 'running') { res.status(409).json({ ok: false, error: '指令正在执行中，无法拒绝' }); return; }
    cmd.status = 'refused';
    saveBridgeCommands(list);
    res.json({ ok: true, command: cmd });
  });

  // 电脑端：删除指令
  app.delete('/api/bridge/command/:cmdId', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const list = loadBridgeCommands();
    const next = list.filter((c) => c.cmdId !== cmdId);
    if (next.length === list.length) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    saveBridgeCommands(next);
    res.json({ ok: true });
  });

  // 电脑端：标记暂停（电脑端审批后才执行——审批流控制）
  app.post('/api/bridge/command/:cmdId/pause', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    if (cmd.status === 'running') { res.status(409).json({ ok: false, error: '指令正在执行中' }); return; }
    cmd.status = 'paused';
    saveBridgeCommands(list);
    res.json({ ok: true, command: cmd });
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

/** 使用系统默认程序打开本地文件夹 */
function openFolder(dir: string): void {
  if (process.platform === 'win32') {
    spawn('explorer', [dir], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** 使用系统默认浏览器打开 URL */
function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

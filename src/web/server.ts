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
import { randomBytes } from 'crypto';
import { join, resolve, relative, isAbsolute, dirname } from 'path';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { securityHeaders, verifyRequestSignature, BruteForceGuard } from '../security';
import { requireToken, SessionStore, type Session, WELCOME_TASKS } from './auth';
import { registerExtraApis } from './extra-apis';
import { registerComputerRoutes } from './routes/computer';
import { registerCapabilitySourceRoutes } from './routes/capability-source';
import { registerManagerRoutes } from './routes/managers';
import { registerModelDomainRoutes, getSharedModelRouter } from './routes/model-domain';
import { registerFilesystemRoutes } from './routes/filesystem';
import { registerClineRoutes } from './routes/cline';
import { registerCloudBridgeRoutes } from './routes/cloud-bridge';
import { registerShopRoutes } from './routes/shop';
import {
  TaskQueue,
  publicTask,
  type AgentType,
  type TaskPermissions,
} from './task-queue';
import { VERSION, PRODUCT, SIGNATURE } from '../cli/version';
import { t, getLang } from '../shared/i18n';
import { isEnterpriseEnabled } from '../enterprise';
import { resolveHomeDir } from '../shared/config';
import { ChangeManager } from '../agent/change-manager';
import { createGitIntegration, type GitIntegration } from '../agent/git-integration';
import { createTeamCollaborationManager, type TeamCollaborationManager } from '../agent/team-collaboration';
import { SoloAgent, type SoloReport } from '../agent/solo-agent';
import { createEventDrivenAgentManager, type AgentEvent } from '../agent/event-driven-agent';
import { createCustomAgentManager } from '../agent/custom-agent';
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
  getMasterKey,
  getRsaKeys,
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

// 登录频率限制（F2）：来源 IP → 计数与时间窗，60 秒窗口内超限即 429
const loginAttempts = new Map<string, { count: number; ts: number }>();

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
  // F2 修复：签名密钥优先从请求 Bearer 令牌派生（客户端用自身会话令牌签名，服务端同源校验），
  // 不再回显任何全局签名密钥；FH_SIGN_SECRET / token 仅作为服务端向后兼容的后备校验密钥（不对外下发）。
  app.use(verifyRequestSignature((req: any) => {
    const auth = (req.headers && req.headers.authorization) || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    const bearer = m ? m[1] : '';
    return bearer || (process.env.FH_SIGN_SECRET || token);
  }, { maxBodyBytes: 8 * 1024 * 1024 }));
  // 第二层·暴力破解防护（登录/激活）
  setInterval(() => bruteForce.cleanup(), 60 * 1000).unref();
  const bruteForce = new BruteForceGuard();
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
  // 安全约束（F2）：响应绝不回显签名密钥；登录加基础格式校验与频率限制，防暴力与密钥泄露。
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    if (!/^\+?[0-9]{6,20}$/.test(phone)) {
      res.status(400).json({ ok: false, error: '请输入有效的手机号码（6-20 位数字）' });
      return;
    }
    // 频率限制：同一来源 60 秒内最多 10 次登录尝试
    const loginLimit = (() => {
      const key = (req.ip ?? 'unknown').toString();
      const now = Date.now();
      const rec = loginAttempts.get(key) || { count: 0, ts: now };
      if (now - rec.ts > 60_000) { rec.count = 0; rec.ts = now; }
      rec.count += 1;
      loginAttempts.set(key, rec);
      return rec.count <= 10;
    })();
    if (!loginLimit) {
      res.status(429).json({ ok: false, error: '登录尝试过于频繁，请稍后再试' });
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
      phone,
      isFirstLogin: result.isFirstLogin,
      welcomeTasks,
    });
  });
  // F7 加固（2026-09-30 安全审计 P1）：记忆/存储/honcho 属敏感数据，统一要求登录后才可读写
  app.use('/api/memory', requireToken(token, sessions));
  app.use('/api/storage', requireToken(token, sessions));
  app.use('/api/honcho', requireToken(token, sessions));

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
    // F10 加固（2026-09-30 安全审计 P1）：任务工作区必须落在允许根内，防路径穿越
    if (workspaceDir && !assertPathAllowed(workspaceDir, res)) return;
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
  // F8 加固（2026-09-30 安全审计 P1）：仅允许公网 http(s) 地址，禁内网/回环/云元数据，防 SSRF 与数据外泄
  function assertPublicHttpUrl(rawUrl: string): string | null {
    let u: URL;
    try { u = new URL(rawUrl); } catch { return 'URL 格式不合法'; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '仅允许 http/https 协议';
    const host = (u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return '缺少主机名';
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return '禁止本地/内网域名';
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$)/.test(host)) return '禁止内网/回环地址';
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return '禁止内网地址';
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return '禁止本地/内网 IPv6';
    if (host.endsWith('.metadata.google.internal') || host === 'metadata.tencentyun.com' || host === '100.100.100.200') return '禁止云元数据地址';
    return null;
  }
  app.post('/api/webhook', (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      res.status(400).json({ ok: false, error: '缺少 url 字段' });
      return;
    }
    const urlError = assertPublicHttpUrl(url);
    if (urlError) {
      res.status(400).json({ ok: false, error: 'webhook 地址被拒绝：' + urlError });
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

  /* ========== 文件与本地操作域（工作区/打开/上传/截图/自然语言）→ routes/filesystem.ts ========== */
  registerFilesystemRoutes(app, {
    homeDir,
    getServerWorkspaceDir: () => serverWorkspaceDir,
    setServerWorkspaceDir: (dir: string) => { serverWorkspaceDir = dir; },
    assertPathAllowed,
  });
  /* ========== 管理器路由域（三端同步/变更管理/MCP/Git/团队/SOLO/多智能体/事件驱动/自定义Agent）→ routes/managers.ts ========== */
  registerManagerRoutes(app, {
    changeManager,
    gitIntegration,
    teamManager,
    eventDrivenManager,
    customAgentManager,
    soloTasks,
    getServerWorkspaceDir: () => serverWorkspaceDir,
    assertPathAllowed,
    getSharedModelRouter: () => getSharedModelRouter(),
  });
  /* ========== 模型/补全域（代码补全/补全Pro/设计稿转代码/大模型配置/共享ModelRouter）→ routes/model-domain.ts ========== */
  registerModelDomainRoutes(app, {
    homeDir,
    masterKey,
    rsaKeys,
    queue,
    loadJsonFile,
    saveJsonFile,
    getServerWorkspaceDir: () => serverWorkspaceDir,
  });
  // 电脑操作（鼠标/键盘/截图/打开应用）：B2 拆分至 web/routes/computer.ts
  registerComputerRoutes(app);

  /* ========== 能力来源域（节点系统/技能市场/自动化/模板库/办公助理）→ routes/capability-source.ts ========== */
  registerCapabilitySourceRoutes(app, { homeDir, queue, loadJsonFile, saveJsonFile });
  /* ========== Cline 进程级嫁接 → routes/cline.ts ========== */
  registerClineRoutes(app, { homeDir });
  /* ========== 云桥接（手机指令→电脑执行）+ 授权 → routes/cloud-bridge.ts ========== */
  registerCloudBridgeRoutes(app, { homeDir, loadJsonFile, saveJsonFile, bruteForce });
  /* ========== P-7 自建商城（支付 + 自动发码闭环）→ routes/shop.ts ========== */
  registerShopRoutes(app, { token, sessions });
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



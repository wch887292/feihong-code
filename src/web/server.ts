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
import express, { type Request, type Response, type Handler } from 'express';
import { randomBytes, createHmac } from 'crypto';
import { exec } from 'child_process';
import type { AddressInfo } from 'net';
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
import {
  requestIdMiddleware,
  notFoundHandler,
  globalErrorHandler,
  validateBody,
} from './http-guards';
import {
  taskBodySchema,
  taskMessageBodySchema,
  webhookBodySchema,
  memoryShortBodySchema,
  memoryAppendBodySchema,
  honchoRememberBodySchema,
} from './schemas';
import { requireToken, SessionStore, type Session, WELCOME_TASKS } from './auth';
import { timingSafeEqual } from 'crypto';
import { loginAccount, resolveAccountHome } from '../security/account';
import { registerExtraApis } from './extra-apis';
import { registerComputerRoutes } from './routes/computer';
import { registerCapabilitySourceRoutes } from './routes/capability-source';
import { registerRoutineRoutes } from './routes/routines';
import { registerMemoryRoutes } from './routes/memory';
import { registerManagerRoutes } from './routes/managers';
import { registerModelDomainRoutes, getSharedModelRouter } from './routes/model-domain';
import { registerFilesystemRoutes } from './routes/filesystem';
import { registerClineRoutes } from './routes/cline';
import { registerCodexRoutes } from './routes/codex';
import { registerCloudBridgeRoutes } from './routes/cloud-bridge';
import { registerShopRoutes } from './routes/shop';
import {
  TaskQueue,
  publicTask,
  type AgentType,
  type TaskPermissions,
} from './task-queue';
import { VERSION, PRODUCT, SIGNATURE } from '../cli/version';
import { onlineEnabled, heartbeatDue, heartbeatOnline } from '../license';
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
// P1 完整性溯源 + 崩溃恢复（对标 Today CN DesktopStartupRecovery / checksums.json）
import { findRecoverable } from '../runtime/recovery';
import { verifyCheckpointManifest } from '../runtime/provenance';
import { listCheckpoints, loadCheckpoint } from '../runtime/session-persist';
import { getSessionHome, isOfflineByDefault } from '../core/task-executor';

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
  // M1 加固（2026-10-20 P0）：主令牌轮换状态——弱令牌告警 + 旧令牌宽限期（轮换后端点见 /api/auth/rotate-token）
  const MASTER_TOKEN_FILE = join(process.env.FH_HOME?.trim() || join(require('os').homedir(), '.feihong-code'), 'web-token.json');
  const ROTATE_GRACE_MS = 24 * 60 * 60 * 1000; // 旧主令牌宽限期 24h
  let oldTokens: Array<{ value: string; expiresAt: number }> = [];
  const isWeakMasterToken = (tk: string): boolean => /^fhcode-2026-fixed-token-/i.test(tk) || tk.length < 24;
  if (token && isWeakMasterToken(token)) {
    console.warn('\n' +
      '[fhcode-security] ⚠️  检测到弱 FH_WEB_TOKEN（fhcode-2026-fixed-token-* 为示例固定值或长度 <24）。\n' +
      '   任何拿到 .env 备份/日志的人即可访问 Web 控制台全部接口（含键鼠操作/文件读写）。\n' +
      '   请改用强随机令牌：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"，\n' +
      '   写入 .env 的 FH_WEB_TOKEN 并重启；已上线环境建议经 POST /api/auth/rotate-token 平滑轮换（旧令牌 24h 宽限）。\n');
  }
  if (!token) {
    // 令牌持久化：自动生成后落盘 ~/.feihong-code/web-token.json，重启复用，
    // 避免每次重启换 token 导致手机端预置令牌失配（v8.8.3）
    try {
      const tokenFile = join(process.env.FH_HOME?.trim() || join(require('os').homedir(), '.feihong-code'), 'web-token.json');
      if (existsSync(tokenFile)) {
        const saved = JSON.parse(readFileSync(tokenFile, 'utf-8')) as { token?: string };
        if (saved.token && typeof saved.token === 'string') {
          token = saved.token;
          console.log(t('serve.tokenReused', { token: token.slice(0, 8) + '…' }));
        }
      }
      if (!token) {
        token = randomBytes(24).toString('hex');
        mkdirSync(dirname(tokenFile), { recursive: true });
        writeFileSync(tokenFile, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), 'utf-8');
        console.log(t('serve.tokenAuto', { token }));
      }
    } catch {
      token = randomBytes(24).toString('hex');
      console.log(t('serve.tokenAuto', { token }));
    }
  }

  const app = express();
  // 全栈铁律7：请求 ID 透传（每个请求生成/沿用 X-Request-Id，随结构化日志自动传播）
  app.use(requestIdMiddleware);
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
  // 在线授权心跳守护（仅在配置了 FH_LICENSE_SERVER 时启用；离线模式完全不上网）
  // 目的：常驻服务场景下自动维持心跳，使发行方后台能看到真实在线状态并能远程吊销。
  if (onlineEnabled()) {
    const tick = () => {
      if (!heartbeatDue()) return;
      void heartbeatOnline().catch(() => undefined);
    };
    setInterval(tick, 60 * 1000).unref();   // 每分钟检查一次，到期才发
    setTimeout(tick, 10_000).unref();     // 启动 10 秒后补一次首检
  }
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
  // 账号隔离：任务持久化按激活账号落进 <FH_HOME>/accounts/<phone>/tasks
  const persistDir =
    process.env.FH_TASK_PERSIST_DIR?.trim() ||
    join(resolveAccountHome(), 'tasks');
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

  // 手机号 + 密码登录（v8.11 账号升级）：无短信验证，生成本地会话令牌
  // 首次登录自动注册（默认密码=手机号后 4 位）；已有账号须密码匹配
  // 安全约束（F2）：响应绝不回显签名密钥；登录加基础格式校验与频率限制，防暴力与密钥泄露。
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!/^\+?[0-9]{6,20}$/.test(phone)) {
      res.status(400).json({ ok: false, error: '请输入有效的手机号码（6-20 位数字）' });
      return;
    }
    if (!password) {
      res.status(400).json({ ok: false, error: '请输入登录密码（首次登录默认=手机号后 4 位）' });
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
    // 账号校验：未注册自动注册（默认密码=后 4 位）；已注册校验密码
    let isFirstLogin: boolean;
    try {
      const r = loginAccount(phone, password);
      isFirstLogin = r.isFirstLogin;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '登录失败';
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: unknown }).code) : '';
      res.status(code === 'ACCOUNT_PASSWORD_MISMATCH' ? 401 : 400).json({ ok: false, error: msg });
      return;
    }
    // 使用新的登录方法，支持首次登录检测
    const result = sessions.login(phone);
    const session = sessions.get(result.token);
    
    // 首次登录：返回引导任务定义（不自动提交执行，由用户在前端点「运行」时再真正发起）
    let welcomeTasks: any[] = [];
    if (isFirstLogin) {
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
      isFirstLogin,
      welcomeTasks,
    });
  });
  // F7 加固（2026-09-30 安全审计 P1）：记忆/存储/honcho 属敏感数据，统一要求登录后才可读写
  // M1 加固（2026-10-20 P0）：令牌轮换宽限期内旧主令牌仍放行（oldTokens 动态，超期自动失效）
  app.use('/api/memory', (req, res, next) => { requireToken(token, sessions, [], oldTokens)(req, res, next); });
  app.use('/api/storage', (req, res, next) => { requireToken(token, sessions, [], oldTokens)(req, res, next); });
  app.use('/api/honcho', (req, res, next) => { requireToken(token, sessions, [], oldTokens)(req, res, next); });

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
  app.post('/api/memory/short', validateBody(memoryShortBodySchema), (req: Request, res: Response) => {
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
  app.post('/api/memory/long/append', validateBody(memoryAppendBodySchema), (req: Request, res: Response) => {
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
  app.post('/api/honcho/remember', validateBody(honchoRememberBodySchema), (req: Request, res: Response) => {
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

  // M1 修复（2026-10-20 P0）：主令牌平滑轮换。
  // 持当前主令牌（或宽限期旧令牌）POST 生成新令牌；旧令牌进宽限期（默认 24h）后失效；
  // 新令牌落盘 web-token.json（若来源是持久化文件则同步更新），重启不漂移。
  // body: { confirm?: string } —— 需回显 tokenPreview（前 8 位）防误操作。
  app.post('/api/auth/rotate-token', (req: Request, res: Response) => {
    const header = req.header('authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    const presented = m[1];
    const pb = Buffer.from(presented);
    const curB = Buffer.from(token);
    const isCurrent = pb.length === curB.length && timingSafeEqual(pb, curB);
    const inGrace = oldTokens.some((ot) => {
      if (Date.now() >= ot.expiresAt) return false;
      const ob = Buffer.from(ot.value);
      return pb.length === ob.length && timingSafeEqual(pb, ob);
    });
    if (!isCurrent && !inGrace) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    // 防误操作：回显前 8 位
    const confirm = String(((req.body ?? {}) as Record<string, unknown>)?.confirm ?? '');
    const preview = token.slice(0, 8);
    if (confirm !== preview) {
      res.status(400).json({ ok: false, error: `请回显当前令牌前缀（${preview}…）以确认轮换`, tokenPreview: preview });
      return;
    }
    const newToken = randomBytes(32).toString('hex');
    // 旧主令牌进宽限期（含已轮换过的旧令牌顺延）
    const now = Date.now();
    oldTokens = [...oldTokens.filter((ot) => ot.expiresAt > now), { value: token, expiresAt: now + ROTATE_GRACE_MS }];
    token = newToken;
    // 同步落盘（与启动时读取的 MASTER_TOKEN_FILE 一致），重启复用新令牌
    try {
      mkdirSync(dirname(MASTER_TOKEN_FILE), { recursive: true });
      writeFileSync(MASTER_TOKEN_FILE, JSON.stringify({ token: newToken, rotatedAt: new Date().toISOString() }, null, 2), 'utf-8');
    } catch { /* 落盘失败不影响本次轮换，进程内已生效 */ }
    console.log('[fhcode-security] 主令牌已轮换，旧令牌宽限期 24h（新令牌前缀 ' + newToken.slice(0, 8) + '…）');
    res.json({ ok: true, token: newToken, tokenPreview: newToken.slice(0, 8), graceMs: ROTATE_GRACE_MS, persisted: true });
  });

  app.use('/api', (req, res, next) => { requireToken(token, sessions, ['/api/security/public-key'], oldTokens)(req, res, next); });

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

  app.post('/api/tasks', validateBody(taskBodySchema), (req: Request, res: Response) => {
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
    // 开发模式：interactive（默认）/ autonomous
    const mode = body?.mode === 'autonomous' ? 'autonomous' : 'interactive';
    const record = queue.submit(goal, { modelId, workspaceDir, agentType, permissions, attachments, mode });
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
  app.post('/api/tasks/:id/messages', validateBody(taskMessageBodySchema), (req: Request, res: Response) => {
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
      res.status(404).json({ ok: false, error: '任务不存在' });
      return;
    }
    // 执行中/排队中发送的消息进入待发队列（本轮结束后自动续跑），messageQueued=true 供前端提示
    const messageQueued = record.status === 'queued' || record.status === 'running';
    res.status(201).json({ ok: true, messageQueued, task: publicTask(record, true) });
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

  /* ========== P1 崩溃恢复 + 完整性溯源（对标 Today CN DesktopStartupRecovery / checksums.json）========== */
  // GET /api/recover：扫描未正常收尾（crashed/running）的中断会话，列出可恢复项（纯读取，不改状态）
  app.get('/api/recover', async (_req: Request, res: Response) => {
    try {
      const home = getSessionHome(isOfflineByDefault());
      const cps = await listCheckpoints(home);
      const recoverable = await findRecoverable(cps, {
        verifyOne: async (c) => {
          try {
            const r = await verifyCheckpointManifest(home, c.runId, c.cwd);
            return r.ok || r.total === 0; // 无清单（旧会话）视为可续跑
          } catch {
            return true;
          }
        },
      });
      res.json({ ok: true, home, mode: isOfflineByDefault() ? 'offline' : 'live', recoverable });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: '崩溃恢复扫描失败: ' + e.message });
    }
  });
  // GET /api/manifest?runId=<id>：校验会话检查点的内容指纹清单（缺省取最近一个）
  app.get('/api/manifest', async (req: Request, res: Response) => {
    try {
      const home = getSessionHome(isOfflineByDefault());
      let runId = typeof req.query.runId === 'string' && req.query.runId ? req.query.runId : '';
      if (!runId) {
        const cps = await listCheckpoints(home);
        if (cps.length === 0) { res.json({ ok: false, error: '无会话可校验' }); return; }
        runId = cps[0].runId;
      } else {
        const cp = await loadCheckpoint(home, runId);
        if (cp) runId = cp.runId;
        else {
          const all = await listCheckpoints(home);
          const m = all.filter((c) => c.runId.startsWith(runId));
          if (m.length === 1) runId = m[0].runId;
          else { res.status(404).json({ ok: false, error: `未找到会话检查点: ${runId}` }); return; }
        }
      }
      const cwd = (await loadCheckpoint(home, runId))?.cwd;
      const result = await verifyCheckpointManifest(home, runId, cwd);
      res.json({ runId, ...result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: '清单校验失败: ' + e.message });
    }
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
  app.post('/api/webhook', validateBody(webhookBodySchema), (req: Request, res: Response) => {
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
  /* ========== ③ 自动化任务（云端 7x24 真实执行 + 三级规则引擎门控）→ routes/routines.ts ========== */
  registerRoutineRoutes(app, { homeDir });
  registerMemoryRoutes(app, { homeDir });
  /* ========== Cline 进程级嫁接 → routes/cline.ts ========== */
  registerClineRoutes(app, { homeDir });
  /* ========== Codex 进程级嫁接 → routes/codex.ts ========== */
  registerCodexRoutes(app, { homeDir });
  /* ========== 云桥接（手机指令→电脑执行）+ 授权 → routes/cloud-bridge.ts ========== */
  registerCloudBridgeRoutes(app, { homeDir, loadJsonFile, saveJsonFile, bruteForce, queue });
  /* ========== v8.9.1 单端口：MCP 端点（顶层 /mcp，绕过 /api 签名/令牌中间件，仅回环 WeKnora 调用） ==========
     替代独立 python fhcode-mcp(8083)：把 fhcode_run/local_exec 等工具直接挂载到 8082，实现单端口。
     协议：stateless streamable HTTP（与 python 版一致），响应 SSE 格式 event: message\ndata: ... */
  const mcpPending = new Map<string, { desc: string; command: string; timeout: number; ts: number; status: string }>();
  function mcpSign(bodyStr: string) {
    const ts = String(Date.now());
    const nonce = randomBytes(12).toString('hex');
    const sig = createHmac('sha256', token).update(ts + '|' + nonce + '|' + bodyStr).digest('hex');
    return { ts, nonce, sig };
  }
  async function mcpSelfPost(path: string, payload: any) {
    const bodyStr = JSON.stringify(payload);
    const s = mcpSign(bodyStr);
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'x-fh-ts': s.ts, 'x-fh-nonce': s.nonce, 'x-fh-sig': s.sig };
    return await fetch('http://127.0.0.1:' + port + path, { method: 'POST', headers, body: bodyStr });
  }
  async function mcpSelfGet(path: string) {
    return await fetch('http://127.0.0.1:' + port + path, { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
  }
  const AGENT_TYPE_MAP: Record<string, string> = { 'write-code': 'solo', 'fix-code': 'solo', 'exec-command': 'solo', 'code-review': 'solo', 'general': 'solo', 'swe': 'swe', 'planner': 'planner', 'team': 'team', 'event-driven': 'event-driven', 'custom': 'custom', 'solo': 'solo' };
  function mapAgentType(a: any): string { return AGENT_TYPE_MAP[String(a || '').toLowerCase()] || 'solo'; }
  async function mcpSubmitTask(goal: string, agentType: string, modelId: string, workspaceDir: string, timeout: number) {
    const payload: any = { goal };
    const at = mapAgentType(agentType);
    if (at) payload.agentType = at;
    if (modelId) payload.modelId = modelId;
    if (workspaceDir) payload.workspaceDir = workspaceDir;
    const r = await mcpSelfPost('/api/tasks', payload);
    if (r.status === 401 || r.status === 403) throw new Error('fhcode 鉴权失败 HTTP ' + r.status);
    if (r.status !== 201) throw new Error('fhcode 任务提交失败 HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const task = (await r.json()).task || {};
    const taskId = task.id;
    if (!taskId) throw new Error('fhcode 未返回任务 ID');
    const deadline = Date.now() + (Number(timeout) || 300) * 1000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 2000));
      const g = await mcpSelfGet('/api/tasks/' + encodeURIComponent(taskId));
      if (g.status !== 200) continue;
      const t = (await g.json()).task || {};
      if (t.status === 'done') {
        const ans = (t.result && (t.result.finalAnswer || '')) || '';
        if (ans) return ans;
        const msgs = t.conversation || [];
        for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant' && msgs[i].content) return msgs[i].content;
        return 'fhcode 任务已完成（' + taskId + '），但未返回文本结果。';
      }
      if (t.status === 'failed') throw new Error('fhcode 任务执行失败：' + (t.error || '未知错误'));
    }
    throw new Error('fhcode 任务 ' + taskId + ' 等待超时');
  }
  function mcpLocalExec(command: any, timeout: any) {
    return new Promise<string>((resolve) => {
      let cmd = String(command || '').replace(/~\/|%USERPROFILE%/g, 'C:\\Users\\Administrator\\');
      // 归一化路径斜杠：把"非空格引导"的正斜杠转反斜杠（空格引导的 /b 这类才是命令开关，须保留），
      // 避免 cmd.exe 的 mkdir/cd 等把 /Users、/Admin 当成开关参数而报"命令语法不正确"
      cmd = cmd.replace(/(^|\S)\//g, '$1\\');
      if (!cmd.trim()) { resolve('exec fail: 空命令'); return; }
      try {
        exec(cmd, { timeout: (Number(timeout) || 120) * 1000, cwd: 'C:\\Users\\Administrator', windowsHide: true } as any, (err: any, stdout: string, stderr: string) => {
          if (err && err.code === 'ENOENT') { resolve('exec fail: 命令不存在'); return; }
          resolve('exit=' + (err ? (err.signal ? 'killed' : 1) : 0) + '\n' + (stdout || '') + (stderr || ''));
        });
      } catch (e: any) { resolve('exec fail: ' + e.message); }
    });
  }
  const MCP_TOOLS = [
    { name: 'fhcode_health', description: '检查底层 fhcode 编程引擎服务是否在线、返回版本信息。无需参数。', inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'fhcode_list_models', description: '列出 fhcode 当前配置的可用大模型与默认模型。无需参数。', inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'fhcode_run', description: '调用 fhcode 在真实沙箱中执行工程级编程任务（写/改/重构代码、跑测试、执行命令、修 bug、审查）。参数：goal(必填), agent_type(write-code/fix-code/exec-command/code-review/general), workspace_dir, model_id, timeout。', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, agent_type: { type: 'string' }, workspace_dir: { type: 'string' }, model_id: { type: 'string' }, timeout: { type: 'number' } }, required: ['goal'] } },
    { name: 'fhcode_local_exec', description: '在本地 Windows 电脑直接执行一条 shell 命令并返回输出（不经审批，即时生效）。参数：command(必填), timeout。用绝对路径 C:\\Users\\Administrator\\...。', inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } },
    { name: 'fhcode_run_with_approval', description: '申请一次需手机审批的本地电脑操作，进入待审批队列，返回 approval_id；用户在飞虹智语音App审批通过后由 fhcode_approve 执行。参数：command(必填), timeout, reason。', inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' }, reason: { type: 'string' } }, required: ['command'] } },
    { name: 'fhcode_approve', description: '对 fhcode_run_with_approval 产生的待审批操作决定并落地：approve=true 执行，approve=false 取消。参数：approval_id(必填), approve(必填), timeout。', inputSchema: { type: 'object', properties: { approval_id: { type: 'string' }, approve: { type: 'boolean' }, timeout: { type: 'number' } }, required: ['approval_id', 'approve'] } },
    { name: 'fhcode_list_pending', description: '列出所有待手机审批的操作（pending 状态），返回 JSON 数组。无需参数。', inputSchema: { type: 'object', properties: {}, required: [] } },
  ];
  function mcpSse(res: any, payload: any) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.write('event: message\ndata: ' + JSON.stringify(payload) + '\n\n');
    res.end();
  }
  async function mcpHandleTool(name: any, args: any) {
    try {
      if (name === 'fhcode_health') {
        const r = await mcpSelfGet('/api/health');
        if (r.status === 200) { const d = await r.json(); return 'fhcode 在线：' + (d.product || '?') + ' v' + (d.version || '?') + '（ok=' + d.ok + '）'; }
        return 'fhcode 健康检查异常 HTTP ' + r.status;
      }
      if (name === 'fhcode_list_models') {
        const r = await mcpSelfGet('/api/models');
        if (r.status !== 200) return '获取模型失败 HTTP ' + r.status;
        const d = await r.json(); const def = d.defaultId || '';
        return '可用模型：\n' + (d.models || []).map((m: any) => '- ' + (m.name || m.id) + ((m.default || m.id === def) ? '（默认）' : '')).join('\n');
      }
      if (name === 'fhcode_run') return await mcpSubmitTask(args.goal, args.agent_type || 'write-code', args.model_id || '', args.workspace_dir || '', args.timeout || 300);
      if (name === 'fhcode_local_exec') return await mcpLocalExec(args.command, args.timeout || 120);
      if (name === 'fhcode_run_with_approval') {
        const cmd = String(args.command || '').trim().replace(/~\/|%USERPROFILE%/g, 'C:\\Users\\Administrator\\');
        if (!cmd) return 'exec fail: 空命令';
        const aid = randomBytes(6).toString('hex');
        mcpPending.set(aid, { desc: (args.reason || cmd).slice(0, 200), command: cmd, timeout: (Number(args.timeout) || 120), ts: Date.now(), status: 'pending' });
        return JSON.stringify({ approval_id: aid, desc: (args.reason || cmd).slice(0, 200), status: 'pending', tip: '操作已暂停，请在飞虹智语音App审批通过后执行' }, null, 2);
      }
      if (name === 'fhcode_approve') {
        const item = mcpPending.get(String(args.approval_id || ''));
        if (!item) return 'exec fail: 审批id不存在或已处理';
        mcpPending.delete(String(args.approval_id || ''));
        if (!args.approve) return '已拒绝执行：' + item.desc;
        return await mcpLocalExec(item.command, item.timeout);
      }
      if (name === 'fhcode_list_pending') {
        const items: any[] = [];
        for (const [aid, info] of mcpPending) if (info.status === 'pending') items.push({ approval_id: aid, desc: info.desc, status: 'pending', ts: info.ts });
        return JSON.stringify(items, null, 2);
      }
      return '未知工具：' + name;
    } catch (e: any) { return '工具执行失败：' + (e && e.message ? e.message : String(e)); }
  }
  app.post('/mcp', async (req: any, res: any) => {
    const body = req.body;
    const id = body && body.id;
    try {
      if (!body || !body.method) { mcpSse(res, { jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid Request' } }); return; }
      const method = body.method;
      if (method === 'initialize') { mcpSse(res, { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fhcode-engine', version: '1.0.0' } } }); return; }
      if (method === 'notifications/initialized' || method === 'ping' || !id) { res.status(202).end(); return; }
      if (method === 'tools/list') { mcpSse(res, { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }); return; }
      if (method === 'tools/call') {
        const name = body.params && body.params.name;
        const args = (body.params && body.params.arguments) || {};
        const text = await mcpHandleTool(name, args);
        mcpSse(res, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } });
        return;
      }
      mcpSse(res, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
    } catch (e: any) {
      mcpSse(res, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'error: ' + (e && e.message ? e.message : String(e)) }], isError: true } });
    }
  });
  /* ========== P-7 自建商城（支付 + 自动发码闭环）→ routes/shop.ts ========== */
  registerShopRoutes(app, { token, sessions });

  /* ========== 全栈铁律5：边界 404 兜底 + 全局 typed 错误处理器（置于所有路由之后）========== */
  // 全栈铁律5：/api 未知路径统一 404；AppError 结构化返回，未知错误记日志 + 通用 500，绝不外泄堆栈
  app.use('/api', notFoundHandler);
  // globalErrorHandler 为 Express 错误中间件（4 参），shim 的 use 只声明 3 参 Handler，故经 unknown 断言过编译
  app.use(globalErrorHandler as unknown as Handler);

  const server = app.listen(port, () => {
    const actualPort = (server.address() as AddressInfo).port;
    console.log(t('serve.started', { port: actualPort }));
    /* 云中转保活（显式开关 FH_CLOUD_KEEPALIVE=1 启用；独立常驻用 node dist/web/cloud-keepalive.js） */
    if (process.env.FH_CLOUD_KEEPALIVE === '1') {
      import('./cloud-keepalive').then((m) => m.startCloudKeepalive()).catch(() => { /* ignore */ });
    }
  });
  return {
    port: (server.address() as AddressInfo).port,
    token,
    url: `http://localhost:${(server.address() as AddressInfo).port}`,
    close: () => server.close(),
  };
}

/** 使用系统默认程序打开本地文件夹 */



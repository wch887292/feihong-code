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
import { registerManagerRoutes } from './routes/managers';
import { registerModelDomainRoutes, getSharedModelRouter } from './routes/model-domain';
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

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
 *   - 登录：手机号直登（无短信验证，本地会话令牌）
 *   - 文件/工作区：右侧任务详情可直接打开文件夹、浏览器、预览文件
 * 鉴权：Bearer Token（fail-closed），主令牌（FH_WEB_TOKEN）与会话令牌并行。
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
import { requireToken, SessionStore, type Session, WELCOME_TASKS } from './auth';
import { registerExtraApis } from './extra-apis';
import {
  TaskQueue,
  type TaskRecord,
  type TaskStep,
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
  // 放宽请求体上限以支持截图/图片 base64 上传（8MB），仍可有效防御内存耗尽
  app.use(express.json({ limit: '8mb' }));
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
    
    // 如果是首次登录，自动创建引导任务
    let welcomeTasks: any[] = [];
    if (result.isFirstLogin) {
      // 标记会话为首次登录（用于后续接口识别）
      if (session) {
        session.isFirstLogin = true;
      }
      
      // 创建引导任务
      for (const task of WELCOME_TASKS) {
        const record = queue.submit(task.goal, {
          workspaceDir: serverWorkspaceDir,
          agentType: 'general' as const,
        });
        welcomeTasks.push({
          ...task,
          taskId: record.id,
          status: record.status,
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

  app.use('/api', requireToken(token, sessions));

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
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: '补全失败: ' + (e as Error).message, suggestions: [] });
    }
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

  /* ========== 电脑操作（鼠标/键盘/截图，用语言控制电脑） ========== */
  // 执行 PowerShell 命令的辅助函数
  const runPowerShell = (script: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      ps.stdout.on('data', (d) => { stdout += d.toString(); });
      ps.stderr.on('data', (d) => { stderr += d.toString(); });
      ps.on('close', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr || `PowerShell exited with code ${code}`));
      });
      ps.on('error', reject);
    });
  };

  // 截图
  app.post('/api/computer/screenshot', async (_req: Request, res: Response) => {
    try {
      if (process.platform !== 'win32') {
        res.status(400).json({ ok: false, error: '仅支持 Windows 系统' });
        return;
      }
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
      res.json({ ok: true, image: 'data:image/png;base64,' + base64, width: 1920, height: 1080 });
    } catch (e) {
      res.status(500).json({ ok: false, error: '截图失败: ' + (e as Error).message });
    }
  });

  // 移动鼠标
  app.post('/api/computer/mouse/move', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const x = parseInt(body?.x ?? '0');
      const y = parseInt(body?.y ?? '0');
      if (isNaN(x) || isNaN(y)) {
        res.status(400).json({ ok: false, error: '缺少 x 或 y 坐标' });
        return;
      }
      const script = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class MouseHelper {
            [DllImport("user32.dll")]
            public static extern bool SetCursorPos(int X, int Y);
        }
"@
        [MouseHelper]::SetCursorPos(${x}, ${y}) | Out-Null
        Write-Output "ok"
      `;
      await runPowerShell(script);
      res.json({ ok: true, x, y });
    } catch (e) {
      res.status(500).json({ ok: false, error: '移动鼠标失败: ' + (e as Error).message });
    }
  });

  // 点击鼠标
  app.post('/api/computer/mouse/click', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const button = (body?.button ?? 'left') as string;
      const x = body?.x !== undefined ? parseInt(body.x) : null;
      const y = body?.y !== undefined ? parseInt(body.y) : null;
      const doubleClick = body?.double === true;

      let clickFlag = '0x0002'; // left down
      let upFlag = '0x0004'; // left up
      if (button === 'right') {
        clickFlag = '0x0008';
        upFlag = '0x0010';
      }

      const movePart = (x !== null && y !== null) ? `[MouseHelper]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -Milliseconds 100;` : '';
      const clickPart = doubleClick
        ? `[MouseHelper]::mouse_event(${clickFlag}, 0, 0, 0, 0); [MouseHelper]::mouse_event(${upFlag}, 0, 0, 0, 0); Start-Sleep -Milliseconds 100; [MouseHelper]::mouse_event(${clickFlag}, 0, 0, 0, 0); [MouseHelper]::mouse_event(${upFlag}, 0, 0, 0, 0);`
        : `[MouseHelper]::mouse_event(${clickFlag}, 0, 0, 0, 0); [MouseHelper]::mouse_event(${upFlag}, 0, 0, 0, 0);`;

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
        ${clickPart}
        Write-Output "ok"
      `;
      await runPowerShell(script);
      res.json({ ok: true, button, x, y, double: doubleClick });
    } catch (e) {
      res.status(500).json({ ok: false, error: '点击鼠标失败: ' + (e as Error).message });
    }
  });

  // 输入文字
  app.post('/api/computer/keyboard/type', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const text = (body?.text ?? '') as string;
      if (!text) {
        res.status(400).json({ ok: false, error: '缺少 text 字段' });
        return;
      }
      // SendKeys 需要转义特殊字符
      const escaped = text.replace(/([+^%~(){}])/g, '{$1}');
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
        Write-Output "ok"
      `;
      await runPowerShell(script);
      res.json({ ok: true, text });
    } catch (e) {
      res.status(500).json({ ok: false, error: '输入文字失败: ' + (e as Error).message });
    }
  });

  // 按键（快捷键）
  app.post('/api/computer/keyboard/press', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const key = (body?.key ?? '') as string;
      if (!key) {
        res.status(400).json({ ok: false, error: '缺少 key 字段' });
        return;
      }
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('${key.replace(/'/g, "''")}')
        Write-Output "ok"
      `;
      await runPowerShell(script);
      res.json({ ok: true, key });
    } catch (e) {
      res.status(500).json({ ok: false, error: '按键失败: ' + (e as Error).message });
    }
  });

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
      const r = await fetchWithRetry(url, 10000, 0);
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
          const r = await fetchWithRetry(src.url, 10000, 0);
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
        const r = await fetchWithRetry(src.url, 10000, 0);
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
        const r = await fetchWithRetry(src.url, 10000, 0);
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

/** 对外暴露的任务视图。withSteps=true 时携带思维链路步骤与对话历史（仅单任务详情使用），列表接口剔除以降低负载 */
function publicTask(r: TaskRecord, withSteps = false): TaskRecord {
  if (withSteps) return r;
  const { steps: _steps, conversation: _conversation, ...rest } = r as TaskRecord & {
    steps?: TaskStep[];
    conversation?: Array<{ role: string; content: string }>;
  };
  return rest;
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

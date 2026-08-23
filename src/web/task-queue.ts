/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P4-1/P6-4 云执行任务队列：
 *  - submit(goal)     入队并异步执行（executeTask 复用 CLI 装配，服务端静默）
 *  - list() / get(id) 查询状态与结果
 *  - 任务状态机：queued → running → done | failed
 *  - 并发上限（默认 2），超出排队等待，避免服务端资源失控
 * P6-4 跨进程/重启恢复：
 *  - 可选 persistDir：每任务落盘 <dir>/<id>.json（原子写 tmp+rename）
 *  - 构造时扫描恢复：queued 重新入队、running 标记 failed（避免僵尸任务）
 *  - 每任务独立文件天然支持多实例并发写；同任务竞争由 executeTask 幂等兜底
 */
import { randomUUID } from 'crypto';
import { executeTask } from '../cli/run';
import { logger } from '../shared/logger';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'fs';
import { join } from 'path';
import type { MessageChannels } from './channels';
import type { ChatMessage } from '../models/model.interface';

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed';

/**
 * 任务思维链路步骤：编排器实时事件 + 时间戳 + 序号。
 * 用于前端按单一任务生命周期，可视化追踪「创建 → 逐步推理 → 工具验证 → 闭环」。
 */
export interface TaskStep {
  seq: number;
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

export interface TaskPermissions {
  readScope: 'workspace' | 'specified' | 'all';
  readPath?: string;
  allowRead: boolean;
  allowWrite: boolean;
  allowShell: boolean;
  allowNetwork: boolean;
  allowBrowser: boolean;
}

export type AgentType = 'general' | 'fix-code' | 'write-code' | 'exec-command';

export interface TaskRecord {
  id: string;
  goal: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  workspaceDir?: string;
  modelId?: string;
  agentType?: AgentType;
  permissions?: TaskPermissions;
  result?: {
    ok: boolean;
    finalAnswer: string;
    iterations: number;
    costUsd: number;
    logFile: string;
    selfHealed?: boolean;
  };
  error?: string;
  /** 思维链路步骤（编排器实时事件），按任务生命周期可视化追踪 */
  steps?: TaskStep[];
  /** 多轮对话历史（M3 resume 上下文），使「新建任务 → 对话栏所有消息归属同一任务」成为可能 */
  conversation?: ChatMessage[];
  /** 附件路径列表（用户在前端暂存区暂存、点发送时统一上传后的文件绝对路径），供执行层读取 */
  attachments?: string[];
}

/**
 * 根据智能体类型给原始目标加上前缀提示。
 * 保持 record.goal 为用户原始输入，仅在实际执行时转换。
 */
export function buildAgentGoal(goal: string, agentType?: AgentType): string {
  switch (agentType) {
    case 'fix-code':
      return '[修复代码] 请定位并修复以下问题，最后给出验证步骤：\n' + goal;
    case 'write-code':
      return '[编写代码] 请用 production-ready 代码实现以下需求，附必要测试与说明：\n' + goal;
    case 'exec-command':
      return '[执行命令] 请在安全前提下执行以下操作并返回结果：\n' + goal;
    default:
      return goal;
  }
}

/**
 * 将权限约束追加到目标中，让离线/真实执行层感知当前会话的可操作边界。
 */
export function buildPermissionPrefix(permissions?: TaskPermissions): string {
  if (!permissions) return '';
  const lines = ['[权限边界]'];
  lines.push(`可读范围: ${permissions.readScope === 'workspace' ? '仅当前工作区' : permissions.readScope === 'specified' ? '指定目录: ' + (permissions.readPath || '') : '全部文件'}`);
  lines.push(`允许操作: 读${permissions.allowRead ? '✓' : '✗'} 写${permissions.allowWrite ? '✓' : '✗'} 命令${permissions.allowShell ? '✓' : '✗'} 网络${permissions.allowNetwork ? '✓' : '✗'} 浏览器${permissions.allowBrowser ? '✓' : '✗'}`);
  return lines.join('\n') + '\n\n';
}

/**
 * 从任务权限构建安全设置（沙箱模式/审批/命令白名单）。
 * 未配置权限时默认工作区可写、无需审批（向后兼容旧任务）。
 */
function buildSecurityFromPermissions(permissions?: TaskPermissions): {
  requireApproval: boolean;
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access' | 'container';
  shellAllowlist: string[];
} {
  if (!permissions) {
    return { requireApproval: false, sandboxMode: 'workspace-write', shellAllowlist: [] };
  }
  // 禁止写 → read-only 沙箱；允许写 → workspace-write
  const sandboxMode = permissions.allowWrite ? 'workspace-write' : 'read-only';
  // 禁止 shell → 需要审批（所有命令都需用户确认）
  const requireApproval = !permissions.allowShell;
  // 禁止 shell 时仅允许只读命令作为白名单
  const shellAllowlist = permissions.allowShell ? [] : ['echo', 'ls', 'cat', 'pwd', 'dir', 'type'];
  return { requireApproval, sandboxMode, shellAllowlist };
}

export interface TaskQueueOptions {
  /** 并发执行上限（默认 2） */
  concurrency?: number;
  /** P5-2：任务状态变化时回调的 webhook URL（状态机每个节点触发一次） */
  webhookUrl?: string;
  /** P5-6：消息渠道（Telegram/企业微信），任务状态变化时推送 */
  channels?: MessageChannels;
  /** P6-4：任务持久化目录（跨进程/重启恢复；不配置则纯内存） */
  persistDir?: string;
  /** Web 控制台模型配置列表（models.json），供 executeTask 使用真实模型 */
  modelProviders?: Array<{ id: string; type: 'openai-compatible' | 'ollama'; baseURL: string; apiKey?: string; model?: string }>;
  /** 离线模式：使用内置 mock 模型（无需任何 API key），用于 Web 控制台演示与单元测试 */
  offline?: boolean;
}

export class TaskQueue {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly queue: string[] = [];
  private running = 0;
  private readonly concurrency: number;
  private webhookUrl: string;
  private readonly channels?: MessageChannels;
  private readonly persistDir?: string;
  /** Web 控制台配置的模型列表 */
  private modelProviders?: Array<{ id: string; type: 'openai-compatible' | 'ollama'; baseURL: string; apiKey?: string }>;
  /** 离线模式标志（内置 mock 模型，无需 API key） */
  private readonly offline: boolean;
  /** 运行中任务的 AbortController 表：cancelTask 时精准中止对应任务（含进行中的模型请求） */
  private readonly controllers = new Map<string, AbortController>();
  /** 全局停止标志：cancel() 后清空队列并阻止新任务启动；标记的任务在 run() 入口即失败 */
  private stopAll = false;

  constructor(opts: TaskQueueOptions = {}) {
    // 并发默认 2：executeTask 已移除 process.chdir，所有工具通过 ctx.cwd 传参，
    // 并发任务不会互相覆盖工作目录。如需更高并发可通过 opts.concurrency 覆盖。
    this.concurrency = opts.concurrency ?? 2;
    this.webhookUrl = opts.webhookUrl ?? '';
    this.channels = opts.channels;
    this.persistDir = opts.persistDir;
    this.offline = opts.offline ?? false;
    if (this.persistDir) this.recover();
  }

  /** 在模型配置初始化后可更新（如 Web 控制台动态加载后） */
  setModelProviders(providers: TaskQueueOptions['modelProviders']): void {
    this.modelProviders = providers;
  }

  /** P6-4：启动恢复——queued 重新入队、running 标记 failed（僵尸任务）、终态直接载入 */
  private recover(): void {
    if (!this.persistDir || !existsSync(this.persistDir)) return;
    let restored = 0;
    for (const f of readdirSync(this.persistDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const record = JSON.parse(readFileSync(join(this.persistDir, f), 'utf8')) as TaskRecord;
        if (!record?.id) continue;
        if (record.status === 'running') {
          // 上次进程崩溃遗留的 running 任务无法续跑 → 标记 failed（防僵尸）
          record.status = 'failed';
          record.error = '进程重启，运行中任务被终止';
          record.updatedAt = new Date().toISOString();
          this.persist(record);
        }
        this.tasks.set(record.id, record);
        if (record.status === 'queued') {
          this.queue.push(record.id);
          void this.fireWebhook(record.id, 'queued');
          void this.channels?.notify(record, 'queued');
        }
        restored++;
      } catch {
        /* 损坏记录跳过 */
      }
    }
    if (restored > 0) {
      logger.info('task queue recovered', { persistDir: this.persistDir, restored });
      this.pump();
    }
  }

  /** P6-4：原子落盘（tmp + rename，避免半写文件被其他进程读到） */
  private persist(record: TaskRecord): void {
    if (!this.persistDir) return;
    try {
      mkdirSync(this.persistDir, { recursive: true });
      const file = join(this.persistDir, `${record.id}.json`);
      // tmp 名带 PID：规避 Windows 下历史残留 .tmp 被外部句柄锁住导致的 EPERM
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(record), 'utf8');
      renameSync(tmp, file);
    } catch (e) {
      logger.warn('task persist failed', {
        taskId: record.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** P6-4：删除任务文件（终态清理，可关闭） */
  clearPersisted(id: string): void {
    if (!this.persistDir) return;
    try {
      rmSync(join(this.persistDir, `${id}.json`), { force: true });
      rmSync(join(this.persistDir, `${id}.json.${process.pid}.tmp`), { force: true });
    } catch {
      /* 忽略清理失败 */
    }
  }

  /** P5-2：动态设置/更新 webhook（供 API 注册） */
  setWebhookUrl(url: string): void {
    this.webhookUrl = url.trim();
  }

  getWebhookUrl(): string {
    return this.webhookUrl;
  }

  /** 提交任务，立即返回任务 id（后台异步执行）；opts 可覆盖本次任务的 modelId / workspaceDir / agentType / permissions / attachments */
  submit(
    goal: string,
    opts: { modelId?: string; workspaceDir?: string; agentType?: AgentType; permissions?: TaskPermissions; attachments?: string[] } = {},
  ): TaskRecord {
    const now = new Date().toISOString();
    const record: TaskRecord = {
      id: randomUUID(),
      goal,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      workspaceDir: opts.workspaceDir,
      modelId: opts.modelId,
      agentType: opts.agentType,
      permissions: opts.permissions,
      attachments: opts.attachments && opts.attachments.length ? opts.attachments : undefined,
    };
    this.tasks.set(record.id, record);
    this.persist(record); // P6-4 落盘
    this.queue.push(record.id);
    this.pump();
    void this.fireWebhook(record.id, 'queued'); // queued 节点回调（状态快照）
    void this.channels?.notify(record, 'queued'); // P5-6 消息渠道推送
    return record;
  }

  /**
   * 多轮续接：向已完成/失败的任务追加一条用户消息并重新入队执行。
   * 仅终态任务（done/failed）可续接；运行中的任务返回 null（由调用方提示）。
   * 返回更新后的记录（已改为 queued）。
   * attachments 为本轮新增的附件路径列表（与上一轮合并去重）。
   */
  continueTask(id: string, message: string, attachments: string[] = []): TaskRecord | null {
    const record = this.tasks.get(id);
    if (!record) return null;
    if (record.status === 'queued' || record.status === 'running') return null;
    const text = message.trim();
    if (!text) return null;
    // 追加用户消息到对话历史（M3 resume 上下文）
    if (!record.conversation) record.conversation = [];
    record.conversation.push({ role: 'user', content: text });
    // 合并附件（去重）：新附件追加到已有附件列表，保留顺序
    if (attachments.length) {
      const set = new Set(record.attachments || []);
      for (const a of attachments) if (a && !set.has(a)) { set.add(a); record.attachments?.push(a) || (record.attachments = [a]); }
    }
    record.status = 'queued';
    record.updatedAt = new Date().toISOString();
    // 保留上一轮 result（供 resume 累计迭代数/成本），终态由 run() 覆盖
    record.error = undefined;
    this.persist(record); // P6-4 落盘 queued
    this.queue.push(id);
    this.pump();
    void this.fireWebhook(id, 'queued');
    void this.channels?.notify(record, 'queued');
    return record;
  }

  /** P6-4：任务状态变化回调（queued→running→done|failed 每个节点触发）。
   * 异步 fire-and-forget：webhook 失败不阻断任务执行，仅记录告警。
   * 注意：回调携带 status 快照而非读取当前状态——submit() 后 pump 会同步
   * 把状态改为 running，若读取当前值，queued 节点永远发不出去。
   */
  private async fireWebhook(id: string, status: TaskStatus): Promise<void> {
    if (!this.webhookUrl) return;
    const record = this.tasks.get(id);
    if (!record) return;
    const payload = {
      event: 'task.status',
      task: { ...publicRecord(record), status },
      ts: new Date().toISOString(),
    };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (e) {
      logger.warn('task webhook delivery failed', {
        taskId: id,
        url: this.webhookUrl,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** 按提交时间倒序列出全部任务（最新在前） */
  list(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  /** 删除任务（仅删除终态任务，运行中的任务不允许删除） */
  delete(id: string): boolean {
    const record = this.tasks.get(id);
    if (!record) return false;
    // 只允许删除终态任务（完成或失败）
    if (record.status !== 'done' && record.status !== 'failed') return false;
    this.tasks.delete(id);
    this.clearPersisted(id);
    return true;
  }

  /** 追加思维链路步骤（编排器事件），节流落盘，供前端按单一任务生命周期可视化追踪 */
  appendStep(id: string, ev: { type: string; [k: string]: unknown }): void {
    const record = this.tasks.get(id);
    if (!record) return;
    if (!record.steps) record.steps = [];
    // 上限保护，避免超长任务撑爆存储
    if (record.steps.length >= 400) record.steps.shift();
    record.steps.push({ seq: record.steps.length, ts: new Date().toISOString(), type: ev.type, data: ev });
    // 节流落盘：首步与每 10 步持久化一次（终态时 run() 会再落盘一次完整记录）
    if (record.steps.length === 1 || record.steps.length % 10 === 0) this.persist(record);
  }

  get count(): number {
    return this.tasks.size;
  }

  /** P9：停止所有任务——中断运行中的执行、清空等待队列、重置停止标志（后续可继续提交新任务） */
  cancel(): void {
    this.stopAll = true;
    // 中断所有运行中的任务（AbortController 触发 fetch 与编排循环即时中止）
    for (const [id, controller] of this.controllers) {
      controller.abort();
      const record = this.tasks.get(id);
      if (record && record.status === 'running') {
        record.status = 'failed';
        record.error = '用户主动停止任务';
        record.updatedAt = new Date().toISOString();
        this.persist(record);
        void this.fireWebhook(id, 'failed');
        void this.channels?.notify(record, 'failed');
      }
    }
    this.controllers.clear();
    // 队列中尚未启动的任务也标记为失败（避免永久停留在 queued）
    for (const id of this.queue) {
      const record = this.tasks.get(id);
      if (record && record.status === 'queued') {
        record.status = 'failed';
        record.error = '用户主动停止任务';
        record.updatedAt = new Date().toISOString();
        this.persist(record);
        void this.fireWebhook(id, 'failed');
        void this.channels?.notify(record, 'failed');
      }
    }
    this.queue.length = 0; // 清空等待队列
    this.stopAll = false; // 重置：允许后续提交新任务
    logger.info('task queue stopped by user');
  }

  /** P9：停止单个指定任务（精准中止，不影响其他运行中的任务） */
  cancelTask(id: string): boolean {
    const record = this.tasks.get(id);
    if (!record) return false;
    if (record.status !== 'running' && record.status !== 'queued') return false;
    // 中断进行中的执行（若在运行）
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
      this.controllers.delete(id);
    }
    // 从等待队列移除（若仍在排队）
    const qi = this.queue.indexOf(id);
    if (qi >= 0) this.queue.splice(qi, 1);
    record.status = 'failed';
    record.error = '用户主动停止任务';
    record.updatedAt = new Date().toISOString();
    this.persist(record);
    void this.fireWebhook(id, 'failed');
    void this.channels?.notify(record, 'failed');
    return true;
  }

  /** 消费队列：并发未满时启动下一个任务 */
  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const record = this.tasks.get(id);
      if (!record) continue;
      // 检查是否全局停止
      if (this.stopAll) {
        record.status = 'failed';
        record.error = '任务队列已停止';
        record.updatedAt = new Date().toISOString();
        this.persist(record);
        void this.fireWebhook(id, 'failed');
        continue;
      }
      void this.run(id, record);
    }
  }

  private async run(id: string, record: TaskRecord): Promise<void> {
    // 全局停止：直接标记失败，不启动执行
    if (this.stopAll) {
      record.status = 'failed';
      record.error = '任务队列已停止';
      record.updatedAt = new Date().toISOString();
      this.persist(record);
      void this.fireWebhook(id, 'failed');
      return;
    }
    // 为当前任务创建 AbortController，供 cancelTask 精准中止进行中的执行（含模型请求）
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.running++;
    record.status = 'running';
    record.updatedAt = new Date().toISOString();
    this.persist(record); // P6-4 落盘 running
    logger.info('task started', { taskId: id });
    void this.fireWebhook(id, 'running'); // running 节点回调
    void this.channels?.notify(record, 'running'); // P5-6 消息渠道推送
    try {
      const taskGoal = buildPermissionPrefix(record.permissions) + buildAgentGoal(record.goal, record.agentType);

      // 根据模型 ID 查找配置，传递给 executeTask 使用真实模型
      const modelId = record.modelId;
      // 多轮续接：若已有对话历史，构造 M3 resume 上下文（同一任务内继续对话）
      const history = record.conversation && record.conversation.length > 0 ? record.conversation : undefined;
      const resume = history
        ? {
            messages: history,
            iterations: record.result?.iterations ?? 0,
            costUsd: record.result?.costUsd ?? 0,
            touchedFiles: [],
          }
        : undefined;
      const result = await executeTask(taskGoal, {
        offline: this.offline,
        // 实时捕获编排器事件，写入该任务的思维链路步骤
        renderer: (ev) => this.appendStep(id, ev),
        modelProviders: modelId && this.modelProviders
          ? this.modelProviders.filter(m => m.id === modelId)
          : undefined,
        // 从任务权限映射安全设置，不再硬编码全权限
        security: buildSecurityFromPermissions(record.permissions),
        // 修复：必须把用户选择的工作区传给执行器，否则 executeTask 会落到进程 cwd（服务启动目录）
        workspaceDir: record.workspaceDir || undefined,
        resume,
        signal: controller.signal, // P9：中断信号——停止按钮触发时中止模型请求与编排循环
        attachments: record.attachments, // 用户本轮上传的附件（截图/文件/图片），执行层可读取
      });
      // 多轮续接：持久化本轮完整消息历史（含上一轮），供下一轮 resume 与前端对话流展示
      if (Array.isArray(result.messages) && result.messages.length > 0) {
        record.conversation = result.messages.slice(-80); // 上限保护，保留最近 80 条
      }
      record.status = result.ok ? 'done' : 'failed';
      record.result = {
        ok: result.ok,
        finalAnswer: result.finalAnswer,
        iterations: result.iterations,
        costUsd: result.costUsd,
        logFile: result.logFile,
        selfHealed: result.selfHealed,
      };
      logger.info('task finished', { taskId: id, status: record.status, iterations: result.iterations });
    } catch (e) {
      record.status = 'failed';
      record.error = e instanceof Error ? e.message : String(e);
      logger.error('task failed', { taskId: id, error: record.error });
    } finally {
      this.controllers.delete(id); // 清理中断控制器
      record.updatedAt = new Date().toISOString();
      this.persist(record); // P6-4 落盘终态
      void this.fireWebhook(id, record.status); // done|failed 节点回调
      void this.channels?.notify(record, record.status); // P5-6 消息渠道推送
      this.running--;
      this.pump();
    }
  }
}

/** 对外任务视图（含结果字段，供 webhook 与 API 复用） */
export function publicRecord(r: TaskRecord): TaskRecord {
  return r;
}

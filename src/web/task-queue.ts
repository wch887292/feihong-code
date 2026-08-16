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

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface TaskRecord {
  id: string;
  goal: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  result?: {
    ok: boolean;
    finalAnswer: string;
    iterations: number;
    costUsd: number;
    logFile: string;
    selfHealed?: boolean;
  };
  error?: string;
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
}

export class TaskQueue {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly queue: string[] = [];
  private running = 0;
  private readonly concurrency: number;
  private webhookUrl: string;
  private readonly channels?: MessageChannels;
  private readonly persistDir?: string;

  constructor(opts: TaskQueueOptions = {}) {
    this.concurrency = opts.concurrency ?? 2;
    this.webhookUrl = opts.webhookUrl ?? '';
    this.channels = opts.channels;
    this.persistDir = opts.persistDir;
    if (this.persistDir) this.recover();
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
      const tmp = file + '.tmp';
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
      rmSync(join(this.persistDir, `${id}.json.tmp`), { force: true });
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

  /** 提交任务，立即返回任务 id（后台异步执行） */
  submit(goal: string): TaskRecord {
    const now = new Date().toISOString();
    const record: TaskRecord = {
      id: randomUUID(),
      goal,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
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
   * P5-2：任务状态变化回调（queued→running→done|failed 每个节点触发）。
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

  get count(): number {
    return this.tasks.size;
  }

  /** 消费队列：并发未满时启动下一个任务 */
  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const record = this.tasks.get(id);
      if (!record) continue;
      void this.run(id, record);
    }
  }

  private async run(id: string, record: TaskRecord): Promise<void> {
    this.running++;
    record.status = 'running';
    record.updatedAt = new Date().toISOString();
    this.persist(record); // P6-4 落盘 running
    logger.info('task started', { taskId: id });
    void this.fireWebhook(id, 'running'); // running 节点回调
    void this.channels?.notify(record, 'running'); // P5-6 消息渠道推送
    try {
      const result = await executeTask(record.goal, { offline: true });
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

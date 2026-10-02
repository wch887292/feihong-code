/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Routines 调度引擎（v8.6.0 P3 · T3.2-T3.6）：
 * - 触发源：cron 定时（T3.1 引擎）+ 事件（notifyEvent，event-log 桥接由上层 hooks 接入）
 * - 持久化：RoutineStore（重启恢复 nextRunAt / 补偿标记 / 退避状态）
 * - 补偿（catch-up）：启动时发现 nextRunAt 已过期 → 补跑一次且推进到未来，不重复
 * - 互斥：同一 routine 运行中不重入；全局并发上限 maxConcurrent
 * - 退避：失败按 base * 2^(n-1) 延迟重试，超过 maxRetries 停止等待人工/事件介入
 * - 安全：P3 默认 runner 为 noop（成功），真实命令执行在 P4 经三级规则引擎+审批后接入
 */
import { nextCronRun } from './cron';
import { RoutineStore, type RoutineDef, type RoutineState } from './store';

export type TriggerKind = 'cron' | 'catchup' | 'event' | 'retry';

export interface RoutineRunResult {
  routineId: string;
  trigger: TriggerKind;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  output?: string;
  error?: string;
}

export type RoutineRunner = (
  def: RoutineDef,
  trigger: TriggerKind,
) => Promise<boolean | { ok: boolean; output?: string; error?: string }>;

export interface SchedulerOptions {
  /** 持久化目录 */
  dir: string;
  /** 全局并发上限（默认 3） */
  maxConcurrent?: number;
  /** 执行器（默认 noop 成功） */
  runner?: RoutineRunner;
  /** 时钟注入（测试用） */
  now?: () => Date;
}

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_SEC = 60;

export class RoutineScheduler {
  private readonly store: RoutineStore;
  private readonly maxConcurrent: number;
  private readonly runner: RoutineRunner;
  private readonly nowFn: () => Date;
  private defs: RoutineDef[] = [];
  private states: Record<string, RoutineState> = {};
  private readonly running = new Set<string>();
  private activeCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(options: SchedulerOptions) {
    this.store = new RoutineStore(options.dir);
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.runner = options.runner ?? (async () => true);
    this.nowFn = options.now ?? (() => new Date());
    this.load();
  }

  /** 加载定义与状态；cron 恢复 nextRunAt，并检测错过窗口（catch-up） */
  load(): void {
    this.defs = this.store.loadDefs();
    this.states = this.store.loadStates();
    const now = this.nowFn();
    for (const def of this.defs) {
      if (def.trigger.kind !== 'cron' || !def.enabled) continue;
      const st = this.states[def.id] ?? (this.states[def.id] = {});
      if (!st.nextRunAt || isNaN(Date.parse(st.nextRunAt))) {
        st.nextRunAt = nextCronRun(def.trigger.expr, now)?.toISOString();
        continue;
      }
      // 错过窗口：持久化的 nextRunAt 已成过去时 → 视是否补跑
      if (new Date(st.nextRunAt).getTime() < now.getTime()) {
        if (def.catchUp !== false) {
          st.missFlag = true;
        } else {
          st.nextRunAt = nextCronRun(def.trigger.expr, now)?.toISOString();
        }
      }
    }
    this.persistStates();
  }

  private persistStates(): void {
    this.store.saveStates(this.states);
  }

  private stateOf(id: string): RoutineState {
    return (this.states[id] ??= {});
  }

  /* ========== 定义管理 ========== */

  addDef(input: Omit<RoutineDef, 'createdAt'> & { createdAt?: string }): RoutineDef {
    if (this.defs.some((d) => d.id === input.id)) {
      throw new Error(`routine id 已存在: ${input.id}`);
    }
    if (input.trigger.kind === 'cron') nextCronRun(input.trigger.expr, this.nowFn()); // 提前校验表达式
    const def: RoutineDef = { ...input, createdAt: input.createdAt ?? this.nowFn().toISOString() };
    this.defs.push(def);
    this.store.saveDefs(this.defs);
    if (def.enabled && def.trigger.kind === 'cron') {
      this.stateOf(def.id).nextRunAt = nextCronRun(def.trigger.expr, this.nowFn())?.toISOString();
      this.persistStates();
    }
    return def;
  }

  removeDef(id: string): boolean {
    const before = this.defs.length;
    this.defs = this.defs.filter((d) => d.id !== id);
    if (this.defs.length === before) return false;
    this.store.saveDefs(this.defs);
    delete this.states[id];
    this.persistStates();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const def = this.defs.find((d) => d.id === id);
    if (!def) return false;
    def.enabled = enabled;
    this.store.saveDefs(this.defs);
    if (!enabled) {
      const st = this.stateOf(id);
      st.missFlag = false;
      st.nextRetryAt = undefined;
      this.persistStates();
    } else if (def.trigger.kind === 'cron') {
      const st = this.stateOf(id);
      if (!st.nextRunAt || new Date(st.nextRunAt) < this.nowFn()) {
        st.nextRunAt = nextCronRun(def.trigger.expr, this.nowFn())?.toISOString();
        this.persistStates();
      }
    }
    return true;
  }

  listDefs(): RoutineDef[] {
    return this.defs.map((d) => ({ ...d }));
  }

  getState(id: string): RoutineState {
    return { ...this.stateOf(id) };
  }

  /* ========== 调度核心 ========== */

  /** 启动定时 tick（默认每分钟）。测试通常直接调 tick()，不 start。 */
  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 一次调度检查：按「重试 > 补偿 > cron」优先级派发。
   * awaitSettle=false 时不等待执行完成（并发测试用），返回本次派发的执行 promise。
   */
  async tick(now: Date = this.nowFn(), opts?: { awaitSettle?: boolean }): Promise<RoutineRunResult[]> {
    const fired: Array<Promise<RoutineRunResult>> = [];
    for (const def of this.defs) {
      if (!def.enabled) continue;
      if (this.running.has(def.id)) continue; // 互斥：运行中不重入
      if (this.activeCount >= this.maxConcurrent) break; // 全局并发上限
      const st = this.stateOf(def.id);
      const kind = this.dueKind(def, st, now);
      if (!kind) continue;
      const p = this.fire(def, kind, now);
      this.track(p);
      fired.push(p);
    }
    if (opts?.awaitSettle === false) return [];
    return Promise.all(fired);
  }

  /** 等待所有在途任务收口（测试/优雅停机用） */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.all([...this.inflight]);
    }
  }

  private track(p: Promise<unknown>): void {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p)).catch(() => undefined);
  }

  /** 判定该 routine 本轮是否到期及触发类型：retry > catchup > cron */
  private dueKind(def: RoutineDef, st: RoutineState, now: Date): TriggerKind | null {
    const nowMs = now.getTime();
    if (st.nextRetryAt) {
      if (new Date(st.nextRetryAt).getTime() <= nowMs) return 'retry';
      return null; // 退避等待期，其他触发让路（互斥保证不重复）
    }
    if (def.trigger.kind === 'cron') {
      if (st.missFlag) return 'catchup';
      if (st.nextRunAt && new Date(st.nextRunAt).getTime() <= nowMs) return 'cron';
    }
    return null;
  }

  /** 事件触发：匹配 event 型 routine 立即派发（容量与互斥约束同 cron） */
  async notifyEvent(event: string, now: Date = this.nowFn()): Promise<RoutineRunResult[]> {
    const fired: Array<Promise<RoutineRunResult>> = [];
    for (const def of this.defs) {
      if (!def.enabled || def.trigger.kind !== 'event') continue;
      if (def.trigger.event !== event) continue;
      if (this.running.has(def.id)) continue;
      if (this.activeCount >= this.maxConcurrent) break;
      const p = this.fire(def, 'event', now);
      this.track(p);
      fired.push(p);
    }
    return Promise.all(fired);
  }

  /** 执行一次并记账：lastRun/failCount/退避/nextRunAt 推进（防重复） */
  private async fire(def: RoutineDef, trigger: TriggerKind, now: Date): Promise<RoutineRunResult> {
    const st = this.stateOf(def.id);
    const startedAt = now.toISOString();
    this.running.add(def.id);
    this.activeCount += 1;
    let ok = false;
    let output: string | undefined;
    let error: string | undefined;
    try {
      const r = await this.runner(def, trigger);
      if (typeof r === 'boolean') {
        ok = r;
      } else {
        ok = r.ok;
        output = r.output;
        error = r.error;
      }
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      this.running.delete(def.id);
      this.activeCount -= 1;
    }

    const finishedAt = this.nowFn().toISOString();
    st.lastRunAt = finishedAt;
    st.lastStatus = ok ? 'ok' : 'failed';
    st.lastError = ok ? undefined : error;
    if (ok) {
      st.failCount = 0;
      st.nextRetryAt = undefined;
    } else {
      st.failCount = (st.failCount ?? 0) + 1;
      const maxRetries = def.maxRetries ?? DEFAULT_MAX_RETRIES;
      const base = def.backoffBaseSec ?? DEFAULT_BACKOFF_BASE_SEC;
      st.nextRetryAt =
        st.failCount <= maxRetries
          ? new Date(now.getTime() + base * 2 ** (st.failCount - 1) * 1000).toISOString()
          : undefined;
    }
    // cron 型：任何一次记账后，把过期的 nextRunAt 推进到未来（补跑/重试均不重复触发）
    if (def.trigger.kind === 'cron') {
      if (!st.nextRunAt || new Date(st.nextRunAt).getTime() <= now.getTime()) {
        st.nextRunAt = nextCronRun(def.trigger.expr, now)?.toISOString();
      }
    }
    if (trigger === 'catchup') st.missFlag = false;
    this.persistStates();
    return { routineId: def.id, trigger, ok, startedAt, finishedAt, output, error };
  }

  stats(): { total: number; enabled: number; running: number; activeCount: number } {
    return {
      total: this.defs.length,
      enabled: this.defs.filter((d) => d.enabled).length,
      running: this.running.size,
      activeCount: this.activeCount,
    };
  }
}

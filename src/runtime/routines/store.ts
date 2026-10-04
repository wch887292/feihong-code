/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Routines 持久化（v8.6.0 P3 · T3.3）：
 * - routines.json：定义（id/name/trigger/action/enabled/补偿与退避配置）
 * - routine-state.json：运行状态（lastRunAt/nextRunAt/missFlag/failCount/nextRetryAt）
 * - 原子写：tmp(带 PID) → renameSync，规避 Windows 文件锁（复用项目既定模式）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ComputeTier } from '../../shared/types';

export type RoutineTrigger =
  | { kind: 'cron'; expr: string }
  | { kind: 'event'; event: string };

export type RoutineAction =
  | { type: 'command'; command: string }
  | { type: 'noop' }
  /** ③ 自动化任务真实执行：AI 目标型动作，经过三级规则引擎 + 审批收件箱门控后由 executeTask 真实执行 */
  | { type: 'goal'; goal: string; tier?: ComputeTier };

export interface RoutineDef {
  id: string;
  name: string;
  trigger: RoutineTrigger;
  action: RoutineAction;
  enabled: boolean;
  /** 错过窗口后是否补跑（默认 true） */
  catchUp?: boolean;
  /** 失败重试上限（默认 2） */
  maxRetries?: number;
  /** 退避基数秒：第 n 次重试等待 base * 2^(n-1)（默认 60） */
  backoffBaseSec?: number;
  createdAt?: string;
}

export interface RoutineState {
  lastRunAt?: string;
  lastStatus?: 'ok' | 'failed';
  lastError?: string;
  nextRunAt?: string;
  /** 检测到错过窗口，待补偿 */
  missFlag?: boolean;
  /** 连续失败计数（成功归零） */
  failCount?: number;
  /** 退避中的下次尝试时间 */
  nextRetryAt?: string;
}

interface DefsFile {
  version: 1;
  defs: RoutineDef[];
}

interface StatesFile {
  version: 1;
  states: Record<string, RoutineState>;
}

/** 原子写 JSON：tmp(带 PID) → renameSync（Windows 锁安全） */
function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, path);
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export class RoutineStore {
  private readonly defsPath: string;
  private readonly statesPath: string;

  constructor(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.defsPath = join(dir, 'routines.json');
    this.statesPath = join(dir, 'routine-state.json');
  }

  loadDefs(): RoutineDef[] {
    const f = readJson<DefsFile>(this.defsPath, { version: 1, defs: [] });
    return Array.isArray(f.defs) ? f.defs : [];
  }

  saveDefs(defs: RoutineDef[]): void {
    writeJsonAtomic(this.defsPath, { version: 1, defs } satisfies DefsFile);
  }

  loadStates(): Record<string, RoutineState> {
    const f = readJson<StatesFile>(this.statesPath, { version: 1, states: {} });
    return f.states ?? {};
  }

  saveStates(states: Record<string, RoutineState>): void {
    writeJsonAtomic(this.statesPath, { version: 1, states } satisfies StatesFile);
  }
}

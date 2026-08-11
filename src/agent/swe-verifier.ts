/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M9 验证器（SWE Verifier）：
 *  - 根据仓库快照/子任务，自动执行构建与测试命令
 *  - 解析 exit code 与输出，判定每步与整体通过/失败
 *  - 离线可用（命令执行走通用 runCommand），不依赖模型
 */
import { runCommand } from '../tools/shell/exec';
import type { RepoSnapshot } from './repo-reader';
import type { SweSubTask } from './swe-planner';

export type VerifyStatus = 'pass' | 'fail' | 'skipped';

export interface VerifyStep {
  name: string;
  command: string;
  status: VerifyStatus;
  exitCode: number;
  /** 截取后的输出（用于反馈给模型做自愈） */
  output: string;
  durationMs: number;
}

export interface VerifyResult {
  overall: VerifyStatus;
  steps: VerifyStep[];
  /** 合并后的错误摘要（便于自愈注入） */
  errorSummary: string;
  durationMs: number;
  log: string;
}

export interface VerifyOptions {
  /** 覆盖默认验证命令（子任务专属 verifyCommand） */
  command?: string;
  /** 超时（毫秒，默认 180000） */
  timeoutMs?: number;
  /** 单步输出最大保留字符（默认 3000） */
  maxOutput?: number;
}

const FAIL_PATTERNS = [
  /error\b/i,
  /failed/i,
  /✗|❌|×/,
  /tests?\s+failed/i,
  /cannot find module/i,
  /tsc:?\s*(error|found)/i,
  /SyntaxError/i,
  /TypeError/i,
  /ReferenceError/i,
  /exit code \d+/i,
  /FAIL/i,
];

function classify(code: number, out: string): VerifyStatus {
  if (code !== 0) return 'fail';
  // 退出码为 0 但仍可能含错误日志（部分工具 exit 0 但打印 error）
  if (FAIL_PATTERNS.some((re) => re.test(out))) {
    // 测试命令打印 "0 tests failed" 不算失败，需更严格
    if (/0\s+tests?\s+failed/i.test(out) && !/1\s|\d{2,}\s/.test(out)) {
      return 'pass';
    }
    return 'fail';
  }
  return 'pass';
}

/** 验证单个子任务（构建/测试/自定义命令） */
export async function verifyTask(
  snapshot: RepoSnapshot,
  task: SweSubTask,
  cwd: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const maxOutput = opts.maxOutput ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 180000;
  const stepDefs: Array<{ name: string; command: string }> = [];

  if (task.verifyCommand) {
    stepDefs.push({ name: 'task-verify', command: task.verifyCommand });
  } else {
    if (snapshot.buildCommand) stepDefs.push({ name: 'build', command: snapshot.buildCommand });
    if (snapshot.testCommand) stepDefs.push({ name: 'test', command: snapshot.testCommand });
  }
  if (opts.command) stepDefs.push({ name: 'custom', command: opts.command });

  if (stepDefs.length === 0) {
    return {
      overall: 'skipped',
      steps: [],
      errorSummary: '（仓库未检测到构建/测试命令，跳过验证）',
      durationMs: 0,
      log: 'no verification command available',
    };
  }

  const steps: VerifyStep[] = [];
  const started = Date.now();
  let overall: VerifyStatus = 'pass';
  const errorLines: string[] = [];

  for (const def of stepDefs) {
    const t0 = Date.now();
    const res = await runCommand(def.command, cwd, timeoutMs);
    const duration = Date.now() - t0;
    const status = classify(res.code, `${res.stdout}${res.stderr}`);
    const output = `${res.stdout}${res.stderr}`.slice(0, maxOutput);
    steps.push({ name: def.name, command: def.command, status, exitCode: res.code, output, durationMs: duration });
    if (status === 'fail') {
      overall = 'fail';
      errorLines.push(`[${def.name}] exit=${res.code}: ${output.split('\n').filter((l) => FAIL_PATTERNS.some((re) => re.test(l))).slice(0, 5).join('\n')}`);
    }
  }

  const durationMs = Date.now() - started;
  const errorSummary = errorLines.length
    ? errorLines.join('\n').slice(0, maxOutput)
    : overall === 'pass'
      ? '（全部通过）'
      : '（验证失败，详情见日志）';
  const log = steps.map((s) => `${s.name}: ${s.status} (exit ${s.exitCode}, ${s.durationMs}ms)`).join('\n');

  return { overall, steps, errorSummary, durationMs, log };
}

/** 仅做构建验证 */
export async function verifyBuild(snapshot: RepoSnapshot, cwd: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const cmd = snapshot.buildCommand ?? (snapshot.hasPackageJson ? 'npm run build' : 'echo no-build');
  return verifyTask(snapshot, { ...emptyTask(), verifyCommand: cmd }, cwd, opts);
}

/** 仅做测试验证 */
export async function verifyTests(snapshot: RepoSnapshot, cwd: string, opts: VerifyOptions = {}): Promise<VerifyResult> {
  const cmd = snapshot.testCommand ?? 'npm test';
  return verifyTask(snapshot, { ...emptyTask(), verifyCommand: cmd }, cwd, opts);
}

function emptyTask(): SweSubTask {
  return {
    id: 'verify',
    title: 'verify',
    description: '',
    targetFiles: [],
    acceptance: '',
    dependsOn: [],
    complexity: 1,
  };
}

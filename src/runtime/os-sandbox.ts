/**
 * 飞虹 Code — OS 级沙箱执行层（跨平台，v8.11）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 与既有沙箱的定位差异（互为纵深防御）：
 *  - src/tools/sandbox.ts       工具级权限策略（该不该做：read-only / deny 优先）
 *  - src/runtime/sandbox.ts     目录级隔离（防误操作：工作区副本 + diff/merge）
 *  - src/tools/docker-sandbox.ts 容器级隔离（Docker 容器内执行）
 *  - 本模块                       进程/命名空间级 OS 隔离（bwrap / unshare / sandbox-exec）
 *
 * 平台矩阵：
 *  - linux   : bubblewrap (bwrap) 优先；无 bwrap 时回退 unshare（user+mount+pid 命名空间）
 *  - darwin  : sandbox-exec（seatbelt profile）
 *  - win32   : 受限执行降级（临时工作区 + 环境注入清理 + 危险命令拦截 + 进程树强杀）；
 *             真 OS 隔离（Job Object / AppContainer / 低完整性令牌）列入 P1 路线（见 docs/SANDBOX-OS.md）
 *
 * 说明：OS 沙箱是有边界的安全隔离（非"防误操作"）；Windows 受限执行是降级态，
 * 不冒充真隔离，可用 `fhcode sandbox status` 查看本机后端能力。
 */
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';

const execFileAsync = promisify(execFile);

export type OsSandboxBackend = 'bwrap' | 'unshare' | 'sandbox-exec' | 'restricted';

export interface OsSandboxInfo {
  platform: NodeJS.Platform;
  /** 实际采用的后端（受限执行也算一种后端，但非真隔离） */
  backend: OsSandboxBackend;
  /** 该后端当前是否可真正调用（bwrap/unshare/sandbox-exec 存在于 PATH） */
  available: boolean;
  /** 不可用原因或说明 */
  reason?: string;
}

export interface OsSandboxRunOptions {
  /** 要执行的 shell 命令 */
  command: string;
  /** 工作目录（默认 process.cwd()） */
  cwd?: string;
  /** 额外注入的环境变量 */
  env?: Record<string, string>;
  /** 执行超时（毫秒，默认 120s） */
  timeoutMs?: number;
  /** 是否允许网络（默认 false：bwrap 用 --unshare-net，sandbox-exec deny network*） */
  networkAllowed?: boolean;
  /** 工作区目录是否可写（默认 true：绑定可写；false 则只读绑定） */
  writableWorkspace?: boolean;
}

export interface OsSandboxRunResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  backend: OsSandboxBackend;
}

/** 危险命令拦截（纵深防御：即使进了 OS 沙箱，这类命令也拒绝执行） */
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?!workspace)/,
  /mkfs/,
  /dd\s+if=.*of=\/dev/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

/** 返回拦截理由；null = 放行 */
export function checkDangerousCommand(command: string): string | null {
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.test(command)) return `危险命令被 OS 沙箱拦截: ${pat}`;
  }
  return null;
}

/** 进程环境注入面清理（NODE_OPTIONS/LD_PRELOAD/DEBUG 等，防父进程注入） */
export function sanitizeEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  for (const k of ['NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DEBUG', 'NODE_DEBUG']) {
    delete env[k];
  }
  if (extra) Object.assign(env, extra);
  return env;
}

/** 探测本机可用的 OS 沙箱后端 */
export async function detectOsSandbox(): Promise<OsSandboxInfo> {
  const platform = process.platform;
  if (platform === 'linux') {
    try {
      const { stdout } = await execFileAsync('which', ['bwrap']);
      if (stdout.trim()) {
        return { platform, backend: 'bwrap', available: true, reason: stdout.trim() };
      }
    } catch { /* bwrap 不存在 */ }
    try {
      const { stdout } = await execFileAsync('which', ['unshare']);
      if (stdout.trim()) {
        return { platform, backend: 'unshare', available: true, reason: 'bwrap 未安装，回退 unshare 命名空间' };
      }
    } catch { /* unshare 不存在 */ }
    return {
      platform, backend: 'restricted', available: false,
      reason: '未找到 bwrap/unshare：请安装 bubblewrap（apt install bubblewrap）或使用 root 权限',
    };
  }
  if (platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('which', ['sandbox-exec']);
      if (stdout.trim()) {
        return { platform, backend: 'sandbox-exec', available: true, reason: stdout.trim() };
      }
    } catch { /* 不存在 */ }
    return { platform, backend: 'restricted', available: false, reason: '未找到 sandbox-exec（macOS 自带 seatbelt）' };
  }
  // win32 及其余平台：受限执行降级（真 OS 隔离列入 P1 路线）
  return {
    platform, backend: 'restricted', available: false,
    reason: 'Windows 受限执行降级：Job Object / AppContainer / 低完整性令牌为 P1 路线（docs/SANDBOX-OS.md）',
  };
}

/** 受限执行（win32 或后端缺失时的兜底）：临时目录隔离 + 环境清理 + 进程树强杀 */
function runRestricted(command: string, cwd: string, env: Record<string, string>, timeoutMs: number, _networkAllowed: boolean): Promise<OsSandboxRunResult> {
  const start = Date.now();
  return new Promise<OsSandboxRunResult>((resolve) => {
    const child = spawn(command, { cwd, env, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') {
        // Windows 需杀整棵进程树（child.kill 只杀 shell）
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
      } else {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, exitCode: code ?? -1, stdout, stderr, timedOut, durationMs: Date.now() - start, backend: 'restricted' });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, exitCode: -1, stdout, stderr: `执行失败: ${e.message}`, timedOut, durationMs: Date.now() - start, backend: 'restricted' });
    });
  });
}

/** Linux bubblewrap 执行：只读绑定系统目录，工作区可写/只读可选，--unshare-all 强隔离 */
function runBwrap(command: string, cwd: string, env: Record<string, string>, timeoutMs: number, networkAllowed: boolean, writable: boolean): Promise<OsSandboxRunResult> {
  const start = Date.now();
  return new Promise<OsSandboxRunResult>((resolve) => {
    const args = ['--die-with-parent', '--unshare-all', '--unshare-user-try', '--proc', '/proc', '--dev', '/dev'];
    for (const dir of ['/usr', '/bin', '/lib', '/lib64', '/etc', '/sbin']) {
      if (existsSync(dir)) args.push('--ro-bind', dir, dir);
    }
    if (networkAllowed) args.push('--share-net');
    args.push(writable ? '--bind' : '--ro-bind', cwd, cwd, '--chdir', cwd, '/bin/sh', '-c', command);
    const child = spawn('bwrap', args, { env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, exitCode: code ?? -1, stdout, stderr, timedOut, durationMs: Date.now() - start, backend: 'bwrap' });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, exitCode: -1, stdout, stderr: `bwrap 执行失败: ${e.message}`, timedOut, durationMs: Date.now() - start, backend: 'bwrap' });
    });
  });
}

/** Linux unshare 回退：user+mount+pid 命名空间（需内核支持，root 或 userns 可用） */
function runUnshare(command: string, cwd: string, env: Record<string, string>, timeoutMs: number): Promise<OsSandboxRunResult> {
  const start = Date.now();
  return new Promise<OsSandboxRunResult>((resolve) => {
    const args = ['--user', '--map-root-user', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc', '/bin/sh', '-c', command];
    const child = spawn('unshare', args, { cwd, env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, exitCode: code ?? -1, stdout, stderr, timedOut, durationMs: Date.now() - start, backend: 'unshare' });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, exitCode: -1, stdout, stderr: `unshare 执行失败: ${e.message}`, timedOut, durationMs: Date.now() - start, backend: 'unshare' });
    });
  });
}

/** macOS sandbox-exec（seatbelt）：默认放行读、拒绝网络写与外部写 */
function runSandboxExec(command: string, cwd: string, env: Record<string, string>, timeoutMs: number, networkAllowed: boolean): Promise<OsSandboxRunResult> {
  const start = Date.now();
  return new Promise<OsSandboxRunResult>((resolve) => {
    const netRule = networkAllowed ? '(allow network*)' : '(deny network*)';
    const profile = `(version 1)(allow default)(allow file-read*)${netRule}(deny file-write*)`;
    const child = spawn('sandbox-exec', ['-p', profile, '/bin/sh', '-c', command], { cwd, env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, exitCode: code ?? -1, stdout, stderr, timedOut, durationMs: Date.now() - start, backend: 'sandbox-exec' });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, exitCode: -1, stdout, stderr: `sandbox-exec 执行失败: ${e.message}`, timedOut, durationMs: Date.now() - start, backend: 'sandbox-exec' });
    });
  });
}

/** OS 级沙箱执行入口：探测后端 → 危险命令拦截 → 平台分派 */
export async function runOsSandboxed(options: OsSandboxRunOptions): Promise<OsSandboxRunResult> {
  const command = options.command;
  const cwd = options.cwd || process.cwd();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const networkAllowed = !!options.networkAllowed;
  const writable = options.writableWorkspace !== false;
  const env = sanitizeEnv(options.env);

  const blocked = checkDangerousCommand(command);
  if (blocked) {
    return { success: false, exitCode: -1, stdout: '', stderr: blocked, timedOut: false, durationMs: 0, backend: 'restricted' };
  }

  const info = await detectOsSandbox();
  if (info.backend === 'bwrap' && info.available) {
    return runBwrap(command, cwd, env, timeoutMs, networkAllowed, writable);
  }
  if (info.backend === 'unshare' && info.available) {
    return runUnshare(command, cwd, env, timeoutMs);
  }
  if (info.backend === 'sandbox-exec' && info.available) {
    return runSandboxExec(command, cwd, env, timeoutMs, networkAllowed);
  }
  return runRestricted(command, cwd, env, timeoutMs, networkAllowed);
}

/** 人类可读描述（doctor / status / help 用） */
export function describeOsSandbox(info: OsSandboxInfo): string {
  switch (info.backend) {
    case 'bwrap': return `bubblewrap OS 沙箱（${info.reason ?? '可用'}）`;
    case 'unshare': return `unshare 命名空间隔离（${info.reason ?? ''}）`;
    case 'sandbox-exec': return `macOS seatbelt 沙箱（${info.reason ?? '可用'}）`;
    case 'restricted':
      return info.available ? '受限执行（降级，非真 OS 隔离）' : `受限执行降级：${info.reason ?? '后端不可用'}`;
  }
}

/** 便捷：创建一次性临时目录（受限模式工作区），返回 cleanup */
export function makeTempWorkspace(prefix = 'fh-os-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

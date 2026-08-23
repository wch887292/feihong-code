/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 命令执行辅助（跨平台，spawn shell）
 * P5-4：容器执行（docker run 挂载工作区，镜像 FH_SANDBOX_IMAGE）
 */
import { spawn } from 'child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 容器镜像（FH_SANDBOX_IMAGE 可覆盖；默认 node:22-alpine 轻量且覆盖常见工具） */
export function containerImage(): string {
  return process.env.FH_SANDBOX_IMAGE || 'node:22-alpine';
}

/** 容器模式下应把命令包装成 docker run 执行；镜像不存在时由 docker 自动拉取 */
export function runCommandInContainer(cmd: string, cwd: string, timeoutMs = 120000): Promise<ExecResult> {
  const image = containerImage();
  // 挂载工作区到 /workspace，容器内 cwd=/workspace；--rm 用完即删
  const dockerArgs = [
    'run',
    '--rm',
    '-v',
    `${cwd}:/workspace`,
    '-w',
    '/workspace',
    image,
    'sh',
    '-c',
    cmd,
  ];
  return runCommand('docker ' + dockerArgs.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' '), cwd, timeoutMs);
}

export function runCommand(cmd: string, cwd: string, timeoutMs = 120000): Promise<ExecResult> {
  return new Promise((resolve) => {
    // 不用内置 timeout 选项：它只杀 shell 进程，不杀 shell 启动的子进程（如 npm/node）。
    // 手动实现超时：先 SIGTERM，宽限期后 SIGKILL，并尝试杀整个进程组。
    const child = spawn(cmd, { cwd, shell: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(result);
    };

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    // spawn 启动失败时只会触发 error 且不再触发 close，必须在此 resolve，否则调用方 await 永久挂起
    child.on('error', (e) => {
      stderr += e.message;
      finish({ code: 1, stdout, stderr });
    });
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }));

    // 超时处理：先 SIGTERM，5 秒后 SIGKILL
    const isWindows = process.platform === 'win32';
    const killTimer = setTimeout(() => {
      if (settled) return;
      try {
        if (!isWindows && child.pid) {
          // Unix: 杀整个进程组（负 pid），确保子进程也被杀
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 进程组不存在则退化为杀单进程 */ }
        }
        child.kill('SIGKILL');
      } catch { /* 忽略 kill 失败 */ }
    }, 5000);

    const timer = setTimeout(() => {
      if (settled) return;
      stderr += `\n[超时] 命令执行超过 ${timeoutMs}ms，正在终止…`;
      try {
        if (!isWindows && child.pid) {
          try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 退化为杀单进程 */ }
        }
        child.kill('SIGTERM');
      } catch { /* 忽略 */ }
      // killTimer 会在 5 秒后发 SIGKILL
    }, timeoutMs);
  });
}

/**
 * 受管命令约束（run_tests / build_check 等）：仅允许包管理器脚本，
 * 禁止 shell 注入元字符与危险子命令，杜绝任意命令执行（沙箱逃逸）。
 */
const MANAGED_INJECTION_RE = /[;&|`$(){}<>!]|&&|\|\||\b(alias|eval|exec|source)\b/;
const MANAGED_DANGEROUS_RE = /\b(rm\s+-rf|curl|wget|sh\s+-c|bash\s+-c|eval|nc\b|telnet|mkfs)\b/i;
const MANAGED_PKG_RE = /^(npm|pnpm|yarn|bun)(\s|$)/;

export function sanitizeManagedCommand(raw?: string, fallback = 'npm test'): string | null {
  const cmd = (raw ?? fallback).trim();
  if (MANAGED_INJECTION_RE.test(cmd)) return null;
  if (!MANAGED_PKG_RE.test(cmd)) return null;
  if (MANAGED_DANGEROUS_RE.test(cmd)) return null;
  return cmd;
}

/** 取命令首词（用于白名单校验） */
export function commandHead(cmd: string): string {
  const m = cmd.trim().match(/^(\S+)/);
  return m ? m[1] : '';
}

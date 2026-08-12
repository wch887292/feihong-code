/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 命令执行辅助（跨平台，spawn shell）
 */
import { spawn } from 'child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(cmd: string, cwd: string, timeoutMs = 120000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    // spawn 启动失败时只会触发 error 且不再触发 close，必须在此 resolve，否则调用方 await 永久挂起
    child.on('error', (e) => {
      stderr += e.message;
      resolve({ code: 1, stdout, stderr });
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
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

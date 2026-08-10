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
    child.on('error', (e) => (stderr += e.message));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** 取命令首词（用于白名单校验） */
export function commandHead(cmd: string): string {
  const m = cmd.trim().match(/^(\S+)/);
  return m ? m[1] : '';
}

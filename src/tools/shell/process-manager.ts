/**
 * 飞虹 Code · 后台长任务进程管理器
 *
 * 解决 run_shell 同步等待导致 dev server / watch 模式等长任务被超时杀掉的问题。
 * - start(): 后台启动命令，立即返回 job_id，不阻塞调用方
 * - 输出实时写入环形缓冲（默认保留最后 2000 行），避免内存爆炸
 * - status() / logs() / stop() / list() 供 AI 随时查询和管理
 * - 进程表落盘到 ~/.feihong-code/background-jobs.json，重启可恢复（已结束的标记为 exited）
 */
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface BackgroundJob {
  jobId: string;
  command: string;
  cwd: string;
  pid: number | null;
  status: 'running' | 'exited' | 'killed' | 'failed';
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
  /** 环形缓冲：stdout 最后 N 行 */
  stdoutTail: string[];
  /** 环形缓冲：stderr 最后 N 行 */
  stderrTail: string[];
  /** 累计输出字符数（用于判断是否有新输出） */
  stdoutBytes: number;
  stderrBytes: number;
}

interface ManagedProcess {
  job: BackgroundJob;
  proc: ChildProcess;
  stdoutBuf: string; // 半行缓冲
  stderrBuf: string;
}

const MAX_TAIL_LINES = 2000;
const JOBS_DIR = join(homedir(), '.feihong-code');
const JOBS_FILE = join(JOBS_DIR, 'background-jobs.json');

function loadJobs(): Map<string, BackgroundJob> {
  try {
    if (existsSync(JOBS_FILE)) {
      const raw = JSON.parse(readFileSync(JOBS_FILE, 'utf-8'));
      const map = new Map<string, BackgroundJob>();
      for (const j of raw as BackgroundJob[]) {
        // 重启后仍标记为 running 的视为失联（进程已不在），降级为 exited
        if (j.status === 'running') {
          j.status = 'exited';
          j.exitCode = j.exitCode ?? -1;
          j.endedAt = j.endedAt ?? new Date().toISOString();
        }
        map.set(j.jobId, j);
      }
      return map;
    }
  } catch { /* 忽略损坏文件 */ }
  return new Map();
}

function saveJobs(jobs: Map<string, BackgroundJob>): void {
  try {
    if (!existsSync(JOBS_DIR)) mkdirSync(JOBS_DIR, { recursive: true });
    // 只持久化元数据（不含 tail 缓冲，避免文件过大），tail 仅内存持有
    const meta = Array.from(jobs.values()).map(({ stdoutTail, stderrTail, ...rest }) => rest);
    writeFileSync(JOBS_FILE, JSON.stringify(meta, null, 2), 'utf-8');
  } catch { /* 持久化失败不影响运行 */ }
}

function pushTail(tail: string[], buf: string, chunk: string): string {
  buf += chunk;
  const lines = buf.split('\n');
  // 最后一段可能是不完整行，留到下次
  const complete = lines.slice(0, -1);
  for (const line of complete) {
    tail.push(line);
    if (tail.length > MAX_TAIL_LINES) tail.shift();
  }
  return lines[lines.length - 1] ?? '';
}

class ProcessManagerImpl {
  private jobs = loadJobs();
  private procs = new Map<string, ManagedProcess>();

  /** 后台启动命令，立即返回 job 元数据（不等待进程结束） */
  start(command: string, cwd: string): BackgroundJob {
    const jobId = randomUUID().slice(0, 8);
    const job: BackgroundJob = {
      jobId,
      command,
      cwd,
      pid: null,
      status: 'running',
      exitCode: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      stdoutTail: [],
      stderrTail: [],
      stdoutBytes: 0,
      stderrBytes: 0,
    };

    let proc: ChildProcess;
    try {
      proc = spawn(command, { cwd, shell: true, detached: false });
    } catch (e) {
      job.status = 'failed';
      job.exitCode = 1;
      job.endedAt = new Date().toISOString();
      job.stderrTail.push(String(e));
      this.jobs.set(jobId, job);
      saveJobs(this.jobs);
      return job;
    }

    job.pid = proc.pid ?? null;
    const managed: ManagedProcess = { job, proc, stdoutBuf: '', stderrBuf: '' };

    proc.stdout?.on('data', (d: Buffer) => {
      const s = d.toString();
      job.stdoutBytes += s.length;
      managed.stdoutBuf = pushTail(job.stdoutTail, managed.stdoutBuf, s);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      job.stderrBytes += s.length;
      managed.stderrBuf = pushTail(job.stderrTail, managed.stderrBuf, s);
    });
    proc.on('error', (e) => {
      job.status = 'failed';
      job.exitCode = 1;
      job.endedAt = new Date().toISOString();
      job.stderrTail.push(e.message);
      this.procs.delete(jobId);
      saveJobs(this.jobs);
    });
    proc.on('close', (code) => {
      // flush 剩余缓冲
      if (managed.stdoutBuf) { job.stdoutTail.push(managed.stdoutBuf); managed.stdoutBuf = ''; }
      if (managed.stderrBuf) { job.stderrTail.push(managed.stderrBuf); managed.stderrBuf = ''; }
      if (job.status === 'running') {
        job.status = 'exited';
        job.exitCode = code;
      }
      job.endedAt = new Date().toISOString();
      this.procs.delete(jobId);
      saveJobs(this.jobs);
    });

    this.jobs.set(jobId, job);
    this.procs.set(jobId, managed);
    saveJobs(this.jobs);
    return job;
  }

  /** 查询单个任务状态（含最新日志尾部） */
  status(jobId: string): BackgroundJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /** 获取日志（stdout + stderr 合并，按时间近似排序） */
  logs(jobId: string, maxLines = 200): { stdout: string; stderr: string; combined: string } | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const stdout = job.stdoutTail.slice(-maxLines).join('\n');
    const stderr = job.stderrTail.slice(-maxLines).join('\n');
    // 简单合并：stdout 在前，stderr 在后（无法精确按时间戳排序，因为行缓冲没存时间）
    const combined = [stdout, stderr ? `--- stderr ---\n${stderr}` : ''].filter(Boolean).join('\n');
    return { stdout, stderr, combined };
  }

  /** 停止后台任务（杀整个进程树） */
  stop(jobId: string): { ok: boolean; message: string } {
    const managed = this.procs.get(jobId);
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, message: `任务不存在: ${jobId}` };
    if (job.status !== 'running') return { ok: false, message: `任务已结束 (${job.status})` };

    const pid = managed?.proc.pid ?? job.pid;
    if (!pid) return { ok: false, message: '无法获取 PID' };

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { detached: true, stdio: 'ignore' }).unref();
      } else {
        try { process.kill(-pid, 'SIGTERM'); } catch { /* 进程组不存在 */ }
        try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
        // 5 秒后强制杀
        setTimeout(() => {
          try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ }
          try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
        }, 5000);
      }
      job.status = 'killed';
      job.exitCode = -1;
      job.endedAt = new Date().toISOString();
      this.procs.delete(jobId);
      saveJobs(this.jobs);
      return { ok: true, message: `已发送终止信号 (pid=${pid})` };
    } catch (e) {
      return { ok: false, message: `停止失败: ${String(e)}` };
    }
  }

  /** 列出所有任务（默认只列 running，可传 all=true 列全部） */
  list(all = false): BackgroundJob[] {
    const jobs = Array.from(this.jobs.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all ? jobs : jobs.filter((j) => j.status === 'running');
  }

  /** 清理已结束的任务记录（默认保留最近 20 条） */
  cleanup(keep = 20): number {
    const exited = Array.from(this.jobs.values())
      .filter((j) => j.status !== 'running')
      .sort((a, b) => b.endedAt!.localeCompare(a.endedAt!));
    let removed = 0;
    for (let i = keep; i < exited.length; i++) {
      this.jobs.delete(exited[i].jobId);
      removed++;
    }
    if (removed > 0) saveJobs(this.jobs);
    return removed;
  }
}

export const processManager = new ProcessManagerImpl();

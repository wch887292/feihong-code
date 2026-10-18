/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 本地代码沙箱（对标 dsh sandboxed commands）：
 *  - createWorkspaceSandbox：把工作区复制到 OS 临时目录（忽略 node_modules/.git/dist/build 等大目录）
 *  - runInSandbox：在沙箱目录执行命令（防误操作直接污染用户工作区）
 *  - diffSandbox / mergeSandbox：沙箱变更清单与合并回原目录（--sync 显式触发）
 *
 * 注意：这是「防误操作」目录隔离，不是安全边界——shell 命令可自由 cd 出沙箱。
 */
import { mkdtemp, copyFile, mkdir, readdir, stat, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep, dirname } from 'path';
import { spawn } from 'child_process';

export interface SandboxHandle {
  root: string;
  cleanup: () => Promise<void>;
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage']);
/** 复制大目录时跳过的文件大小上限（MB） */
const MAX_FILE_MB = 20;

async function copyTree(src: string, dst: string): Promise<{ copied: number; skippedBytes: number }> {
  let copied = 0;
  let skippedBytes = 0;
  const walk = async (s: string, d: string): Promise<void> => {
    const entries = await readdir(s, { withFileTypes: true });
    for (const e of entries) {
      const sp = join(s, e.name);
      const dp = join(d, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        await mkdir(dp, { recursive: true });
        await walk(sp, dp);
      } else if (e.isSymbolicLink()) {
        // 符号链接不复制目标内容，仅重建链接，避免大目录穿透
        try {
          await rm(dp, { recursive: true, force: true });
          const link = await import('fs/promises').then((m) => m.readlink(sp));
          await import('fs/promises').then((m) => m.symlink(link, dp));
        } catch { /* 忽略无法重建的链接 */ }
      } else {
        try {
          const st = await stat(sp);
          if (st.size > MAX_FILE_MB * 1024 * 1024) {
            skippedBytes += st.size;
            continue;
          }
          await mkdir(dirname(dp), { recursive: true });
          await copyFile(sp, dp);
          copied++;
        } catch { /* 忽略读取失败的文件 */ }
      }
    }
  };
  await walk(src, dst);
  return { copied, skippedBytes };
}

/** 创建沙箱：复制工作区到临时目录 */
export async function createWorkspaceSandbox(workdir: string): Promise<SandboxHandle> {
  if (!existsSync(workdir)) throw new Error(`工作区不存在: ${workdir}`);
  const root = await mkdtemp(join(tmpdir(), 'fh-sandbox-'));
  const { copied, skippedBytes } = await copyTree(workdir, root);
  const stderr = skippedBytes > 0 ? `（跳过 ${(skippedBytes / 1024 / 1024).toFixed(1)}MB 大文件）` : '';
  console.error(`沙箱就绪: ${root} 复制 ${copied} 个文件${stderr}`);
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export interface SandboxRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 在沙箱目录执行命令（返回码 + 输出） */
export function runInSandbox(sandboxDir: string, command: string, timeoutMs = 300_000): Promise<SandboxRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: sandboxDir, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: String(e) });
    });
  });
}

export type SandboxChange = { kind: 'add' | 'modify' | 'delete'; path: string };

/** 沙箱相对原工作区的变更清单（文件级） */
export async function diffSandbox(sandboxDir: string, workdir: string): Promise<SandboxChange[]> {
  const changes: SandboxChange[] = [];
  const walk = async (dir: string, rel = ''): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? toPosix(join(rel, e.name)) : e.name;
      if (IGNORE_DIRS.has(e.name)) continue;
      const sp = join(dir, e.name);
      const wp = join(workdir, relPath);
      if (e.isDirectory()) {
        await walk(sp, relPath);
        continue;
      }
      if (!existsSync(wp)) {
        changes.push({ kind: 'add', path: relPath });
      } else {
        try {
          const [a, b] = await Promise.all([stat(sp), stat(wp)]);
          if (a.size !== b.size || a.mtimeMs > b.mtimeMs) changes.push({ kind: 'modify', path: relPath });
        } catch { /* 忽略 */ }
      }
    }
  };
  // 检测被删除的文件：原工作区有而沙箱没有（沙箱从原目录复制而来，删除即缺失）
  const walkDelete = async (dir: string, rel = ''): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? toPosix(join(rel, e.name)) : e.name;
      if (IGNORE_DIRS.has(e.name)) continue;
      const wp = join(dir, e.name);
      const sp = join(sandboxDir, relPath);
      if (e.isDirectory()) {
        if (existsSync(sp)) await walkDelete(wp, relPath);
        else if (await hasFiles(wp)) changes.push({ kind: 'delete', path: relPath });
      } else if (!existsSync(sp)) {
        changes.push({ kind: 'delete', path: relPath });
      }
    }
  };
  await walk(sandboxDir);
  await walkDelete(workdir);
  // 目录删除坍缩：若子路径已标记 delete，父级不再重复
  return changes.filter((c) => !changes.some((o) => o !== c && o.kind === 'delete' && o.path.startsWith(c.path + sep)));
}

async function hasFiles(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    if (e.isDirectory()) { if (await hasFiles(join(dir, e.name))) return true; }
    else return true;
  }
  return false;
}

/** 把沙箱变更合并回原工作区（add/modify 复制，delete 删除） */
export async function mergeSandbox(sandboxDir: string, workdir: string, changes: SandboxChange[]): Promise<string[]> {
  const merged: string[] = [];
  for (const c of changes) {
    const sp = join(sandboxDir, c.path);
    const wp = join(workdir, c.path);
    if (c.kind === 'delete') {
      try { await rm(wp, { recursive: true, force: true }); merged.push(c.path); } catch { /* 忽略 */ }
    } else {
      if (!existsSync(sp)) continue;
      await mkdir(dirname(wp), { recursive: true });
      await copyFile(sp, wp);
      merged.push(c.path);
    }
  }
  return merged;
}

/** 沙箱路径辅助（供 diff 显示相对路径） */
export function toPosix(p: string): string {
  return p.split(sep).join('/');
}
export { relative as relPath };

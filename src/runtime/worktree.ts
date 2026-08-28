/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工作树隔离：用 git worktree 为每个子代理创建独立工作区（独立目录 + 独立分支），
 * 实现多子代理并行开发的物理隔离。任务完成后可安全移除。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const exec = promisify(execFile);

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeError';
  }
}

export interface Worktree {
  /** 隔离工作区绝对路径 */
  path: string;
  /** 子代理专用分支名 */
  branch: string;
}

/** 取当前 git 仓库根目录（用于在其上创建 worktree） */
export async function getRepoRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch {
    throw new WorktreeError(`当前目录不是 git 仓库，无法创建 worktree: ${cwd}`);
  }
}

async function getCurrentBranch(repoRoot: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
  return stdout.trim();
}

/**
 * 创建隔离工作树。
 * @param repoRoot 主仓库根目录
 * @param name 子代理/任务名（用于分支与目录命名）
 * @param baseBranch 基线分支（默认当前分支）
 */
export async function createWorktree(
  repoRoot: string,
  name: string,
  baseBranch?: string,
): Promise<Worktree> {
  const base = baseBranch ?? (await getCurrentBranch(repoRoot));
  const branch = `fhcode/${slug(name)}-${Date.now().toString(36)}`;
  const path = mkdtempSync(join(tmpdir(), `fhcode-wt-${slug(name)}-`));
  try {
    await exec('git', ['worktree', 'add', '--force', '-b', branch, path, base], {
      cwd: repoRoot,
    });
  } catch (e) {
    // git worktree add 失败：清理已创建的临时目录，避免孤儿目录泄漏
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    throw new WorktreeError(
      `创建 worktree 失败 (${name}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { path, branch };
}

/**
 * 移除工作树（--force 即使有未提交改动也删除，子代理产物不进主仓库）。
 *
 * 注意：Windows 上 git 对“顺序移除多个 worktree”存在已知缺陷——
 * 移除第一个时可能连带清掉整个 .git/worktrees 目录，使后续 worktree 的
 * git 原生移除报 “is not a working tree”。因此此处采用“尽力移除 + 强制清目录 + prune”
 * 的鲁棒策略：先尝试 git 原生移除；无论成败都强制删除磁盘目录（防止孤儿目录）；
 * 最后 prune 清理残留元数据。子代理结果已在移除前收集，清理仅针对工作区本身。
 */
export async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  const norm = path.replace(/\\/g, '/');
  // 1) 尽力用 git 原生移除（可能因上述 Windows bug 失败，忽略）
  try {
    await exec('git', ['worktree', 'remove', '--force', norm], { cwd: repoRoot });
  } catch {
    /* best-effort，下面兜底 */
  }
  // 2) 强制删除磁盘目录，避免孤儿临时目录残留
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* best-effort */
  }
  // 3) 兜底清理 git 元数据残留
  try {
    await exec('git', ['worktree', 'prune'], { cwd: repoRoot });
  } catch {
    /* best-effort */
  }
}

/** 列出所有 worktree 路径 */
export async function listWorktrees(repoRoot: string): Promise<string[]> {
  const { stdout } = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  return stdout
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim());
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'task';
}

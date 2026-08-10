/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Git 辅助（M3 diff/rollback）：仅作用于会话 touchedFiles，绝不整仓回滚，避免误删。
 * 非 git 仓库时安全退出并提示，不执行任何破坏性操作。
 */
import { spawn } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

interface GitOut {
  code: number;
  out: string;
  err: string;
}

function git(args: string[], cwd: string): Promise<GitOut> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, shell: false });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    child.on('error', (e) => resolve({ code: 1, out, err: e.message }));
  });
}

export function isGitRepo(cwd: string): boolean {
  return existsSync(join(cwd, '.git'));
}

/** 生成会话作用域的 diff（追踪文件走 git diff，未跟踪文件走 --no-index） */
export async function gitDiff(cwd: string, files?: string[]): Promise<string> {
  if (!isGitRepo(cwd)) {
    return '(当前目录不是 git 仓库，无法生成 diff；请手动核对 touchedFiles)';
  }
  const parts: string[] = [];
  const target = files && files.length ? files : null;

  const trackedArgs = ['diff', '--color=never'];
  if (target) trackedArgs.push('--', ...target);
  const tracked = await git(trackedArgs, cwd);
  if (tracked.out.trim()) parts.push(tracked.out);

  const status = await git(['status', '--porcelain', '--'], cwd);
  const untracked = status.out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(2).trim());
  const untrackedToShow = target ? untracked.filter((f) => target.includes(f)) : untracked;
  for (const f of untrackedToShow) {
    const abs = join(cwd, f);
    if (!existsSync(abs)) continue;
    const ni = await git(['diff', '--no-index', '--color=never', '/dev/null', abs.replace(/\\/g, '/')], cwd);
    parts.push(ni.out || `(新增文件: ${f})`);
  }
  return parts.join('\n').trim() || '(无变更)';
}

export interface RollbackResult {
  reverted: string[];
  removed: string[];
  errors: string[];
}

/**
 * 回滚会话 touchedFiles：
 *  - 已跟踪文件 → git checkout -- <file>
 *  - 未跟踪文件 → 删除
 * 未确认(--yes)或非 git 仓库时拒绝执行，绝不静默破坏。
 */
export async function gitRollback(
  cwd: string,
  files: string[],
  opts: { yes?: boolean } = {},
): Promise<RollbackResult> {
  const res: RollbackResult = { reverted: [], removed: [], errors: [] };
  if (!isGitRepo(cwd)) {
    res.errors.push('当前目录不是 git 仓库，回滚已中止（避免误删）');
    return res;
  }
  if (!opts.yes) {
    res.errors.push('回滚是破坏性操作，请加 --yes 显式确认');
    return res;
  }
  const status = await git(['status', '--porcelain', '--'], cwd);
  const untracked = new Set(
    status.out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.startsWith('??'))
      .map((l) => l.slice(2).trim()),
  );
  for (const f of files) {
    if (untracked.has(f)) {
      try {
        rmSync(join(cwd, f), { force: true, recursive: true });
        res.removed.push(f);
      } catch (e) {
        res.errors.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      const r = await git(['checkout', '--', f], cwd);
      if (r.code === 0) res.reverted.push(f);
      else res.errors.push(`${f}: ${r.err.trim() || 'checkout 失败'}`);
    }
  }
  return res;
}

/**
 * 飞虹 Code - Git 集成模块 (P2-2)
 * 完整的 Git 操作封装：状态、diff、暂存、提交、分支、历史、推送/拉取
 *
 * 设计原则：
 * - 所有操作通过 child_process 调用 git 命令
 * - 非 git 仓库时安全退出
 * - 破坏性操作（push/reset/force）需要显式确认
 * - 输出结构化，便于前端展示
 */
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../shared/logger';

/** Git 命令执行结果 */
interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 执行 git 命令 */
function git(args: string[], cwd: string, timeoutMs = 30000): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (error as any).code ?? 1 : 0,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      });
  });
}

/** 文件状态 */
export interface GitFileStatus {
  path: string;
  /** 暂存区状态（M=修改, A=新增, D=删除, R=重命名, C=复制, ??=未跟踪） */
  indexStatus: string;
  /** 工作区状态 */
  workTreeStatus: string;
  /** 是否有冲突 */
  conflict: boolean;
}

/** Git 状态 */
export interface GitStatus {
  isRepo: boolean;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  /** 暂存区文件数 */
  stagedCount: number;
  /** 工作区修改文件数 */
  modifiedCount: number;
  /** 未跟踪文件数 */
  untrackedCount: number;
}

/** 提交信息 */
export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  subject: string;
}

/** 分支信息 */
export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommit: string;
}

/** Diff hunk */
export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Array<{ type: 'add' | 'remove' | 'context'; content: string }>;
}

/** 文件 diff */
export interface FileDiff {
  path: string;
  oldPath: string | null;
  newPath: string | null;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

/**
 * Git 集成管理器
 */
export class GitIntegration {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** 是否为 git 仓库 */
  isRepo(): boolean {
    return existsSync(join(this.cwd, '.git'));
  }

  /** 获取 Git 状态 */
  async status(): Promise<GitStatus> {
    if (!this.isRepo()) {
      return {
        isRepo: false, branch: '', upstream: null, ahead: 0, behind: 0,
        files: [], stagedCount: 0, modifiedCount: 0, untrackedCount: 0,
      };
    }

    // 获取状态（porcelain 格式 + 分支信息）
    const statusResult = await git(['status', '--porcelain=v2', '--branch'], this.cwd);
    const files: GitFileStatus[] = [];
    let branch = '';
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;

    for (const line of statusResult.stdout.split('\n')) {
      if (!line) continue;
      if (line.startsWith('# ')) {
        // 分支信息
        const parts = line.slice(2).split(' ');
        if (parts[0] === 'branch.head') branch = parts[1] || '';
        if (parts[0] === 'branch.upstream') upstream = parts[1] || null;
        if (parts[0] === 'branch.ab') {
          const ab = parts[1] || '';
          const aMatch = ab.match(/\+(\d+)/);
          const bMatch = ab.match(/-(\d+)/);
          ahead = aMatch ? parseInt(aMatch[1]) : 0;
          behind = bMatch ? parseInt(bMatch[1]) : 0;
        }
      } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        // 已跟踪文件变更
        const parts = line.split(' ');
        const xy = parts[1] || '';
        const indexStatus = xy[0] || '.';
        const workTreeStatus = xy[1] || '.';
        const path = parts.slice(parts.length - 1)[0] || '';
        files.push({
          path,
          indexStatus,
          workTreeStatus,
          conflict: indexStatus === 'U' || workTreeStatus === 'U' || xy === 'AA' || xy === 'DD',
        });
      } else if (line.startsWith('? ')) {
        // 未跟踪文件
        const path = line.slice(2);
        files.push({ path, indexStatus: '?', workTreeStatus: '?', conflict: false });
      }
    }

    const stagedCount = files.filter((f) => f.indexStatus !== '.' && f.indexStatus !== '?').length;
    const modifiedCount = files.filter((f) => f.workTreeStatus !== '.' && f.workTreeStatus !== '?').length;
    const untrackedCount = files.filter((f) => f.indexStatus === '?').length;

    return { isRepo: true, branch, upstream, ahead, behind, files, stagedCount, modifiedCount, untrackedCount };
  }

  /** 获取文件 diff */
  async diff(path?: string, staged = false): Promise<FileDiff[]> {
    if (!this.isRepo()) return [];

    const args = ['diff', '--color=never', '--unified=3'];
    if (staged) args.push('--cached');
    if (path) args.push('--', path);

    const result = await git(args, this.cwd);
    return this.parseDiff(result.stdout);
  }

  /** 解析 diff 输出 */
  private parseDiff(diffText: string): FileDiff[] {
    const files: FileDiff[] = [];
    if (!diffText.trim()) return files;

    const fileBlocks = diffText.split(/^diff --git /m).slice(1);
    for (const block of fileBlocks) {
      const lines = block.split('\n');
      const headerLine = lines[0] || '';
      const oldPathMatch = headerLine.match(/a\/(.+) b\//);
      const newPathMatch = headerLine.match(/ b\/(.+)/);
      const oldPath = oldPathMatch ? oldPathMatch[1] : null;
      const newPath = newPathMatch ? newPathMatch[1] : null;
      const path = newPath || oldPath || '';

      const isNew = lines.some((l) => l.startsWith('new file mode'));
      const isDeleted = lines.some((l) => l.startsWith('deleted file mode'));
      const isBinary = lines.some((l) => l.includes('Binary files'));

      const hunks: DiffHunk[] = [];
      let currentHunk: DiffHunk | null = null;
      let additions = 0;
      let deletions = 0;

      for (const line of lines) {
        if (line.startsWith('@@')) {
          if (currentHunk) hunks.push(currentHunk);
          const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
          currentHunk = {
            header: line,
            oldStart: match ? parseInt(match[1]) : 0,
            oldLines: match ? (match[2] ? parseInt(match[2]) : 1) : 0,
            newStart: match ? parseInt(match[3]) : 0,
            newLines: match ? (match[4] ? parseInt(match[4]) : 1) : 0,
            lines: [],
          };
        } else if (currentHunk) {
          if (line.startsWith('+')) {
            currentHunk.lines.push({ type: 'add', content: line.slice(1) });
            additions++;
          } else if (line.startsWith('-')) {
            currentHunk.lines.push({ type: 'remove', content: line.slice(1) });
            deletions++;
          } else if (line.startsWith(' ')) {
            currentHunk.lines.push({ type: 'context', content: line.slice(1) });
          }
        }
      }
      if (currentHunk) hunks.push(currentHunk);

      files.push({ path, oldPath, newPath, isNew, isDeleted, isBinary, hunks, additions, deletions });
    }

    return files;
  }

  /** 暂存文件（git add） */
  async add(paths: string[]): Promise<{ success: boolean; message: string }> {
    if (!this.isRepo()) return { success: false, message: '不是 git 仓库' };
    const result = await git(['add', '--', ...paths], this.cwd);
    if (result.code === 0) {
      logger.info('git add', { paths });
      return { success: true, message: `已暂存 ${paths.length} 个文件` };
    }
    return { success: false, message: result.stderr.trim() || 'git add 失败' };
  }

  /** 取消暂存（git reset HEAD） */
  async reset(paths: string[]): Promise<{ success: boolean; message: string }> {
    if (!this.isRepo()) return { success: false, message: '不是 git 仓库' };
    const result = await git(['reset', 'HEAD', '--', ...paths], this.cwd);
    if (result.code === 0) {
      return { success: true, message: `已取消暂存 ${paths.length} 个文件` };
    }
    return { success: false, message: result.stderr.trim() || 'git reset 失败' };
  }

  /** 提交（git commit） */
  async commit(message: string, paths?: string[]): Promise<{ success: boolean; hash?: string; message: string }> {
    if (!this.isRepo()) return { success: false, message: '不是 git 仓库' };
    if (!message.trim()) return { success: false, message: '提交信息不能为空' };

    const args = ['commit', '-m', message];
    if (paths && paths.length) args.push('--', ...paths);

    const result = await git(args, this.cwd);
    if (result.code === 0) {
      // 获取提交 hash
      const hashResult = await git(['rev-parse', 'HEAD'], this.cwd);
      const hash = hashResult.stdout.trim();
      logger.info('git commit', { hash, message });
      return { success: true, hash, message: '提交成功' };
    }
    return { success: false, message: result.stderr.trim() || 'git commit 失败' };
  }

  /** 获取分支列表 */
  async branches(): Promise<GitBranch[]> {
    if (!this.isRepo()) return [];

    const result = await git(['branch', '-vv', '--no-abbrev'], this.cwd);
    const branches: GitBranch[] = [];

    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue;
      const isCurrent = line.startsWith('*');
      const isRemote = line.trim().startsWith('remotes/');
      const name = isRemote
        ? line.trim().replace(/^remotes\//, '')
        : line.trim().replace(/^[\* ]\s*/, '').split(/\s+/)[0] || '';

      // 解析 upstream 和 ahead/behind
      let upstream: string | null = null;
      let ahead = 0;
      let behind = 0;
      const upstreamMatch = line.match(/\[([^\]]+)\]/);
      if (upstreamMatch) {
        const info = upstreamMatch[1];
        upstream = info.split(':')[0];
        const aMatch = info.match(/ahead (\d+)/);
        const bMatch = info.match(/behind (\d+)/);
        ahead = aMatch ? parseInt(aMatch[1]) : 0;
        behind = bMatch ? parseInt(bMatch[1]) : 0;
      }

      // 获取最后提交 hash
      const hashMatch = line.match(/([0-9a-f]{7,40})/);
      const lastCommit = hashMatch ? hashMatch[1] : '';

      branches.push({ name, current: isCurrent, remote: isRemote, upstream, ahead, behind, lastCommit });
    }

    return branches;
  }

  /** 切换分支 */
  async checkout(branch: string, createNew = false): Promise<{ success: boolean; message: string }> {
    if (!this.isRepo()) return { success: false, message: '不是 git 仓库' };
    const args = createNew ? ['checkout', '-b', branch] : ['checkout', branch];
    const result = await git(args, this.cwd);
    if (result.code === 0) {
      return { success: true, message: `已切换到分支 ${branch}` };
    }
    return { success: false, message: result.stderr.trim() || 'git checkout 失败' };
  }

  /** 获取提交历史 */
  async log(count = 20): Promise<GitCommit[]> {
    if (!this.isRepo()) return [];

    const format = '%H%n%h%n%an%n%ae%n%aI%n%s%n%b%n---END---';
    const result = await git(['log', `--pretty=format:${format}`, `-${count}`], this.cwd);

    const commits: GitCommit[] = [];
    const blocks = result.stdout.split('---END---').filter((b) => b.trim());

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 6) continue;
      const [hash, shortHash, author, email, date, subject, ...bodyLines] = lines;
      commits.push({
        hash,
        shortHash,
        author,
        email,
        date,
        subject,
        message: bodyLines.join('\n').trim() || subject,
      });
    }

    return commits;
  }

  /** 推送 */
  async push(remote = 'origin', branch?: string, force = false): Promise<{ success: boolean; message: string }> {
    if (!this.isRepo()) return { success: false, message: '不是 git 仓库' };
    const args = ['push'];
    if (force) args.push('--force-with-lease');
    args.push(remote);
    if (branch) args.push(branch);

    const result = await git(args, this.cwd, 60000);
    if (result.code === 0) {
      return { success: true, message: '推送成功' };
    }
    return { success: false, message: result.stderr.trim() || 'git push 失败' };
  }

  /** 拉取 */
  async pull(remote = 'origin', branch?: string): Promise<{ success: boolean; message: string }> {
    if (!this.isRepo()) return { success: false, message: '不是 git 仓库' };
    const args = ['pull'];
    args.push(remote);
    if (branch) args.push(branch);

    const result = await git(args, this.cwd, 60000);
    if (result.code === 0) {
      return { success: true, message: '拉取成功' };
    }
    return { success: false, message: result.stderr.trim() || 'git pull 失败' };
  }

  /** 初始化仓库 */
  async init(): Promise<{ success: boolean; message: string }> {
    if (this.isRepo()) return { success: false, message: '已经是 git 仓库' };
    const result = await git(['init'], this.cwd);
    if (result.code === 0) {
      return { success: true, message: 'Git 仓库初始化成功' };
    }
    return { success: false, message: result.stderr.trim() || 'git init 失败' };
  }
}

/** 便捷函数：创建 Git 集成管理器 */
export function createGitIntegration(cwd: string): GitIntegration {
  return new GitIntegration(cwd);
}

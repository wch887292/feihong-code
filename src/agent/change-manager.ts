/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P3-1 多文件协同编辑变更管理器：
 *  - 暂存文件变更（不直接写入磁盘，用户确认后才应用）
 *  - 行级 Diff 生成（unified diff 格式）
 *  - 逐文件 / 逐 Hunk 接受/拒绝
 *  - 冲突检测：编辑期间用户手动修改同一文件时高亮冲突
 *  - 原子化提交：所有变更一次性写入，失败自动回滚
 *  - 变更面板数据：文件变更树、增删行数统计、状态管理
 *
 * 设计原则：
 *  - 不破坏：变更暂存在内存，用户确认前不碰磁盘
 *  - 可回滚：提交失败时自动恢复原始内容
 *  - 可观测：每个文件的变更状态、diff、冲突都可查询
 *  - 粒度可控：支持全文件接受/拒绝，也支持逐 hunk 操作
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import { logger } from '../shared/logger';

/** 变更类型 */
export type ChangeType = 'modified' | 'added' | 'deleted';

/** 单个 Diff Hunk */
export interface DiffHunk {
  /** hunk 序号（从 0 开始） */
  index: number;
  /** 原始文件起始行 */
  oldStart: number;
  /** 原始文件行数 */
  oldLines: number;
  /** 新文件起始行 */
  newStart: number;
  /** 新文件行数 */
  newLines: number;
  /** hunk 内容（带 +/-/空格前缀的行） */
  lines: string[];
  /** 是否被用户接受（null=未决定，true=接受，false=拒绝） */
  accepted: boolean | null;
}

/** 单个文件的暂存变更 */
export interface StagedChange {
  /** 文件路径（相对项目根） */
  path: string;
  /** 变更类型 */
  type: ChangeType;
  /** 原始内容（磁盘上的内容） */
  originalContent: string;
  /** 新内容（AI 生成的内容） */
  newContent: string;
  /** Diff hunks */
  hunks: DiffHunk[];
  /** 变更状态 */
  status: 'pending' | 'accepted' | 'rejected' | 'conflict';
  /** 新增行数 */
  additions: number;
  /** 删除行数 */
  deletions: number;
  /** 原始文件哈希（用于冲突检测） */
  originalHash: string;
  /** 暂存时间 */
  stagedAt: string;
}

/** 变更管理器配置 */
export interface ChangeManagerConfig {
  /** 项目根目录 */
  cwd: string;
  /** 最大暂存文件数（默认 50） */
  maxStagedFiles: number;
  /** 冲突检测是否启用（默认 true） */
  enableConflictDetection: boolean;
}

const DEFAULT_CONFIG: ChangeManagerConfig = {
  cwd: process.cwd(),
  maxStagedFiles: 50,
  enableConflictDetection: true,
};

/** 变更提交结果 */
export interface CommitResult {
  success: boolean;
  /** 成功写入的文件 */
  committed: string[];
  /** 失败的文件及原因 */
  failed: Array<{ path: string; error: string }>;
  /** 是否触发了回滚 */
  rolledBack: boolean;
}

/** 变更面板统计 */
export interface ChangeStats {
  totalFiles: number;
  pending: number;
  accepted: number;
  rejected: number;
  conflict: number;
  totalAdditions: number;
  totalDeletions: number;
}

/**
 * 多文件变更管理器
 */
export class ChangeManager {
  private config: ChangeManagerConfig;
  private changes = new Map<string, StagedChange>();

  constructor(config: Partial<ChangeManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 暂存一个文件变更
   */
  stageChange(path: string, newContent: string): StagedChange | null {
    const absPath = join(this.config.cwd, path);
    const normalizedPath = path.replace(/\\/g, '/');

    // 检查最大暂存数
    if (this.changes.size >= this.config.maxStagedFiles && !this.changes.has(normalizedPath)) {
      logger.warn('change manager: max staged files reached', { max: this.config.maxStagedFiles });
      return null;
    }

    // 读取原始内容
    let originalContent = '';
    let type: ChangeType = 'modified';
    if (existsSync(absPath)) {
      try {
        originalContent = readFileSync(absPath, 'utf8');
      } catch {
        originalContent = '';
      }
    } else {
      type = 'added';
    }

    // 如果内容相同，不需要暂存
    if (originalContent === newContent) {
      return null;
    }

    // 生成 diff
    const hunks = this.generateDiff(originalContent, newContent);
    const { additions, deletions } = this.countChanges(hunks);

    const change: StagedChange = {
      path: normalizedPath,
      type,
      originalContent,
      newContent,
      hunks,
      status: 'pending',
      additions,
      deletions,
      originalHash: this.hash(originalContent),
      stagedAt: new Date().toISOString(),
    };

    this.changes.set(normalizedPath, change);
    logger.info('change staged', { path: normalizedPath, type, additions, deletions });
    return change;
  }

  /**
   * 获取所有暂存变更
   */
  getAllChanges(): StagedChange[] {
    return Array.from(this.changes.values());
  }

  /**
   * 获取单个文件的变更
   */
  getChange(path: string): StagedChange | undefined {
    return this.changes.get(path.replace(/\\/g, '/'));
  }

  /**
   * 接受整个文件的变更
   */
  acceptFile(path: string): boolean {
    const change = this.getChange(path);
    if (!change) return false;
    change.status = 'accepted';
    for (const hunk of change.hunks) hunk.accepted = true;
    return true;
  }

  /**
   * 拒绝整个文件的变更
   */
  rejectFile(path: string): boolean {
    const change = this.getChange(path);
    if (!change) return false;
    change.status = 'rejected';
    for (const hunk of change.hunks) hunk.accepted = false;
    return true;
  }

  /**
   * 接受单个 Hunk
   */
  acceptHunk(path: string, hunkIndex: number): boolean {
    const change = this.getChange(path);
    if (!change || !change.hunks[hunkIndex]) return false;
    change.hunks[hunkIndex].accepted = true;
    this.updateFileStatus(change);
    return true;
  }

  /**
   * 拒绝单个 Hunk
   */
  rejectHunk(path: string, hunkIndex: number): boolean {
    const change = this.getChange(path);
    if (!change || !change.hunks[hunkIndex]) return false;
    change.hunks[hunkIndex].accepted = false;
    this.updateFileStatus(change);
    return true;
  }

  /**
   * 根据 hunk 接受状态更新文件状态
   */
  private updateFileStatus(change: StagedChange): void {
    if (change.hunks.length === 0) {
      change.status = 'accepted';
      return;
    }
    const accepted = change.hunks.filter((h) => h.accepted === true).length;
    const rejected = change.hunks.filter((h) => h.accepted === false).length;
    if (accepted === change.hunks.length) change.status = 'accepted';
    else if (rejected === change.hunks.length) change.status = 'rejected';
    else change.status = 'pending';
  }

  /**
   * 检测冲突：检查磁盘上的文件是否在暂存后被修改
   */
  detectConflicts(): string[] {
    if (!this.config.enableConflictDetection) return [];
    const conflicts: string[] = [];
    for (const change of this.changes.values()) {
      if (change.type === 'added') continue;
      const absPath = join(this.config.cwd, change.path);
      if (!existsSync(absPath)) {
        // 文件被删除了
        change.status = 'conflict';
        conflicts.push(change.path);
        continue;
      }
      try {
        const currentContent = readFileSync(absPath, 'utf8');
        const currentHash = this.hash(currentContent);
        if (currentHash !== change.originalHash) {
          change.status = 'conflict';
          conflicts.push(change.path);
        }
      } catch {
        change.status = 'conflict';
        conflicts.push(change.path);
      }
    }
    if (conflicts.length > 0) {
      logger.warn('change conflicts detected', { files: conflicts });
    }
    return conflicts;
  }

  /**
   * 原子化提交：将所有已接受的变更写入磁盘
   * 失败时自动回滚
   */
  commit(): CommitResult {
    const committed: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    const backups = new Map<string, string>();

    // 先检测冲突
    const conflicts = this.detectConflicts();
    if (conflicts.length > 0) {
      return {
        success: false,
        committed: [],
        failed: conflicts.map((p) => ({ path: p, error: '文件在暂存后被修改，存在冲突' })),
        rolledBack: false,
      };
    }

    // 写入所有已接受的变更
    for (const change of this.changes.values()) {
      if (change.status !== 'accepted') continue;
      const absPath = join(this.config.cwd, change.path);
      try {
        // 备份原始内容
        if (existsSync(absPath)) {
          backups.set(absPath, readFileSync(absPath, 'utf8'));
        } else {
          backups.set(absPath, '__NEW_FILE__');
        }
        // 确保目录存在
        mkdirSync(dirname(absPath), { recursive: true });
        // 写入新内容
        writeFileSync(absPath, change.newContent, 'utf8');
        committed.push(change.path);
      } catch (e) {
        failed.push({ path: change.path, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // 如果有失败，回滚所有已写入的变更
    if (failed.length > 0) {
      for (const [absPath, original] of backups) {
        try {
          if (original === '__NEW_FILE__') {
            // 新文件，删除
            const { unlinkSync } = require('fs');
            unlinkSync(absPath);
          } else {
            writeFileSync(absPath, original, 'utf8');
          }
        } catch {
          /* 回滚失败忽略 */
        }
      }
      logger.error('change commit failed, rolled back', { failed: failed.length });
      return { success: false, committed: [], failed, rolledBack: true };
    }

    // 提交成功，清空暂存
    for (const path of committed) {
      this.changes.delete(path);
    }
    logger.info('changes committed', { count: committed.length });
    return { success: true, committed, failed: [], rolledBack: false };
  }

  /**
   * 丢弃所有暂存变更
   */
  discardAll(): void {
    this.changes.clear();
    logger.info('all changes discarded');
  }

  /**
   * 丢弃单个文件的变更
   */
  discard(path: string): boolean {
    return this.changes.delete(path.replace(/\\/g, '/'));
  }

  /**
   * 获取变更统计
   */
  getStats(): ChangeStats {
    let pending = 0, accepted = 0, rejected = 0, conflict = 0;
    let totalAdditions = 0, totalDeletions = 0;
    for (const c of this.changes.values()) {
      if (c.status === 'pending') pending++;
      else if (c.status === 'accepted') accepted++;
      else if (c.status === 'rejected') rejected++;
      else if (c.status === 'conflict') conflict++;
      totalAdditions += c.additions;
      totalDeletions += c.deletions;
    }
    return {
      totalFiles: this.changes.size,
      pending,
      accepted,
      rejected,
      conflict,
      totalAdditions,
      totalDeletions,
    };
  }

  /**
   * 生成行级 Diff（简化版 unified diff）
   */
  private generateDiff(oldText: string, newText: string): DiffHunk[] {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const hunks: DiffHunk[] = [];

    // 简化的 LCS diff：逐行比较，找到变化区域
    let i = 0, j = 0;
    let hunkIndex = 0;
    const contextLines = 3;

    while (i < oldLines.length || j < newLines.length) {
      // 跳过相同的行
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        i++;
        j++;
        continue;
      }

      // 找到变化块的起始（包含上下文）
      const hunkOldStart = Math.max(0, i - contextLines) + 1;
      const hunkNewStart = Math.max(0, j - contextLines) + 1;
      const lines: string[] = [];

      // 添加上下文行
      const ctxStart = Math.max(0, i - contextLines);
      for (let k = ctxStart; k < i; k++) {
        lines.push(' ' + oldLines[k]);
      }

      // 找到变化块的结束
      const oldBlockStart = i;
      const newBlockStart = j;
      let oldEnd = i, newEnd = j;

      // 收集变化行（简化：连续的不同行视为一个块）
      while (oldEnd < oldLines.length || newEnd < newLines.length) {
        if (oldEnd < oldLines.length && newEnd < newLines.length && oldLines[oldEnd] === newLines[newEnd]) {
          // 检查后面是否还有连续相同行（>=2行视为块结束）
          let sameCount = 0;
          let oi = oldEnd, ni = newEnd;
          while (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni] && sameCount < contextLines) {
            sameCount++;
            oi++;
            ni++;
          }
          if (sameCount >= contextLines || oi >= oldLines.length || ni >= newLines.length) {
            break;
          }
        }
        if (oldEnd < oldLines.length) oldEnd++;
        if (newEnd < newLines.length) newEnd++;
      }

      // 输出变化行
      let oi = oldBlockStart, ni = newBlockStart;
      while (oi < oldEnd || ni < newEnd) {
        if (oi < oldEnd && (ni >= newEnd || oldLines[oi] !== newLines[ni])) {
          lines.push('-' + oldLines[oi]);
          oi++;
        } else if (ni < newEnd) {
          lines.push('+' + newLines[ni]);
          ni++;
        }
      }

      // 添加后续上下文
      const ctxEnd = Math.min(oldLines.length, oldEnd + contextLines);
      for (let k = oldEnd; k < ctxEnd; k++) {
        lines.push(' ' + oldLines[k]);
      }

      hunks.push({
        index: hunkIndex++,
        oldStart: hunkOldStart,
        oldLines: oldEnd - oldBlockStart + contextLines * 2,
        newStart: hunkNewStart,
        newLines: newEnd - newBlockStart + contextLines * 2,
        lines,
        accepted: null,
      });

      i = oldEnd;
      j = newEnd;
    }

    return hunks;
  }

  /** 统计增删行数 */
  private countChanges(hunks: DiffHunk[]): { additions: number; deletions: number } {
    let additions = 0, deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) additions++;
        else if (line.startsWith('-')) deletions++;
      }
    }
    return { additions, deletions };
  }

  /** 简单哈希（用于冲突检测） */
  private hash(text: string): string {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return h.toString(36);
  }

  /**
   * 生成变更面板的 JSON 数据（供前端渲染）
   */
  toPanelData(): {
    stats: ChangeStats;
    files: Array<{
      path: string;
      type: ChangeType;
      status: StagedChange['status'];
      additions: number;
      deletions: number;
      hunks: DiffHunk[];
    }>;
  } {
    return {
      stats: this.getStats(),
      files: this.getAllChanges().map((c) => ({
        path: c.path,
        type: c.type,
        status: c.status,
        additions: c.additions,
        deletions: c.deletions,
        hunks: c.hunks,
      })),
    };
  }
}

/** 便捷函数：创建变更管理器 */
export function createChangeManager(config?: Partial<ChangeManagerConfig>): ChangeManager {
  return new ChangeManager(config);
}

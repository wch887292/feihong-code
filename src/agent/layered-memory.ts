/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1-2 分层记忆架构（Layered Memory Architecture）：
 *  - 工作记忆（Working Memory）：当前对话窗口，完整消息列表
 *  - 任务记忆（Task Memory）：子任务完成后的结构化 Checkpoint 列表
 *  - 项目记忆（Project Memory）：跨会话持久化记忆（技术决策、用户偏好、历史任务）
 *
 * 核心能力：
 *  - 自动压缩：工作记忆超阈值时，将早期内容压缩为任务记忆 Checkpoint
 *  - 上下文召回：新任务启动时，从项目记忆中召回相关历史任务摘要
 *  - 分层注入：构建上下文时，项目记忆摘要 + 任务记忆 Checkpoint + 工作记忆完整消息
 *  - 持久化：任务记忆可落盘，支持跨会话恢复
 *
 * 设计原则：
 *  - 不丢失关键决策：压缩时保留决策点、产物路径、遗留问题，丢弃过程性对话
 *  - 可观测：每层记忆的大小、压缩次数、召回结果都有统计
 *  - 可配置：压缩阈值、保留轮数、记忆目录均可配置
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ChatMessage } from '../models/model.interface';
import {
  compactContext,
  createCheckpoint,
  mergeCheckpoints,
  smartCompact,
  shouldCompact,
  type TaskCheckpoint,
} from './context-compactor';
import { logger } from '../shared/logger';

/** 分层记忆配置 */
export interface LayeredMemoryConfig {
  /** 工作记忆压缩阈值（消息数），超过则触发压缩 */
  workingMemoryThreshold: number;
  /** 压缩后保留的最近完整消息轮数 */
  preservedRounds: number;
  /** 任务记忆最大 Checkpoint 数（超过则合并最早的） */
  maxTaskCheckpoints: number;
  /** 项目记忆目录（跨会话持久化） */
  memoryDir: string;
  /** 是否启用智能压缩（基于内容重要性选择性保留） */
  useSmartCompaction: boolean;
  /** 项目记忆召回的最大条目数 */
  maxRecalledItems: number;
}

const DEFAULT_CONFIG: LayeredMemoryConfig = {
  workingMemoryThreshold: 30,
  preservedRounds: 10,
  maxTaskCheckpoints: 20,
  memoryDir: join(process.env.FH_HOME?.trim() || join(homedir(), '.feihong-code'), 'layered-memory'),
  useSmartCompaction: true,
  maxRecalledItems: 5,
};

/** 项目记忆条目（跨会话持久化） */
export interface ProjectMemoryEntry {
  id: string;
  /** 任务目标摘要 */
  goal: string;
  /** 关键技术决策 */
  decisions: string[];
  /** 产物路径 */
  artifacts: string[];
  /** 遗留问题 */
  pendingIssues: string[];
  /** 用户偏好/习惯（从任务中提取） */
  userPreferences: string[];
  /** 时间戳 */
  timestamp: string;
  /** 相关标签（用于召回匹配） */
  tags: string[];
}

/** 记忆统计 */
export interface MemoryStats {
  workingMemoryCount: number;
  taskMemoryCount: number;
  projectMemoryCount: number;
  totalCompressions: number;
  totalCheckpoints: number;
  lastCompactionAt: string | null;
}

/**
 * 分层记忆管理器
 */
export class LayeredMemory {
  private config: LayeredMemoryConfig;
  /** 工作记忆：当前对话窗口的完整消息 */
  private workingMemory: ChatMessage[] = [];
  /** 任务记忆：子任务完成后的结构化 Checkpoint */
  private taskMemory: TaskCheckpoint[] = [];
  /** 项目记忆：跨会话持久化的历史任务摘要 */
  private projectMemory: ProjectMemoryEntry[] = [];
  /** 统计 */
  private stats: MemoryStats = {
    workingMemoryCount: 0,
    taskMemoryCount: 0,
    projectMemoryCount: 0,
    totalCompressions: 0,
    totalCheckpoints: 0,
    lastCompactionAt: null,
  };
  /** 当前任务的起始消息索引（用于创建 checkpoint 时确定范围） */
  private currentTaskStartIdx = 0;

  constructor(config: Partial<LayeredMemoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureDirs();
    this.loadProjectMemory();
  }

  /** 添加消息到工作记忆 */
  append(message: ChatMessage): void {
    this.workingMemory.push(message);
    this.stats.workingMemoryCount = this.workingMemory.length;
  }

  /** 批量添加消息 */
  appendAll(messages: ChatMessage[]): void {
    for (const m of messages) this.workingMemory.push(m);
    this.stats.workingMemoryCount = this.workingMemory.length;
  }

  /** 获取当前工作记忆 */
  getWorkingMemory(): ChatMessage[] {
    return [...this.workingMemory];
  }

  /** 获取任务记忆 */
  getTaskMemory(): TaskCheckpoint[] {
    return [...this.taskMemory];
  }

  /** 获取项目记忆 */
  getProjectMemory(): ProjectMemoryEntry[] {
    return [...this.projectMemory];
  }

  /**
   * 检查并执行压缩（如果工作记忆超阈值）
   * 返回是否执行了压缩
   */
  compressIfNeeded(): boolean {
    if (!shouldCompact(this.workingMemory, this.config.workingMemoryThreshold)) {
      return false;
    }

    const before = this.workingMemory.length;

    if (this.config.useSmartCompaction) {
      // 智能压缩：基于内容重要性选择性保留
      const { messages: compacted, stats } = smartCompact(this.workingMemory, this.config.preservedRounds * 2);
      this.workingMemory = compacted;
      logger.info('layered-memory: smart compaction', { before, after: compacted.length, preserved: stats.preservedMessages });
    } else {
      // 普通压缩：保留最近 N 轮，压缩早期
      const { messages: compacted } = compactContext(this.workingMemory, this.config.preservedRounds);
      this.workingMemory = compacted;
      logger.info('layered-memory: regular compaction', { before, after: compacted.length });
    }

    this.stats.totalCompressions++;
    this.stats.lastCompactionAt = new Date().toISOString();
    this.stats.workingMemoryCount = this.workingMemory.length;
    return true;
  }

  /**
   * 创建任务级 Checkpoint（子任务完成时调用）
   * 将当前任务从起始位置到现在的消息压缩为结构化摘要
   */
  createTaskCheckpoint(goal: string): TaskCheckpoint {
    const endIdx = this.workingMemory.length;
    const checkpoint = createCheckpoint(this.workingMemory, {
      start: this.currentTaskStartIdx,
      end: endIdx,
    }, goal);

    this.taskMemory.push(checkpoint);
    this.stats.totalCheckpoints++;
    this.stats.taskMemoryCount = this.taskMemory.length;

    // 如果任务记忆超阈值，合并最早的 Checkpoint
    if (this.taskMemory.length > this.config.maxTaskCheckpoints) {
      this.mergeOldestCheckpoints();
    }

    // 更新当前任务起始位置
    this.currentTaskStartIdx = endIdx;

    logger.info('layered-memory: checkpoint created', {
      goal,
      result: checkpoint.result,
      artifacts: checkpoint.artifacts.length,
      totalCheckpoints: this.taskMemory.length,
    });

    return checkpoint;
  }

  /** 合并最早的两个 Checkpoint 为一个（保留关键信息） */
  private mergeOldestCheckpoints(): void {
    if (this.taskMemory.length < 2) return;
    const [first, second, ...rest] = this.taskMemory;
    const merged: TaskCheckpoint = {
      goal: `${first.goal} + ${second.goal}`,
      approach: [...first.approach, ...second.approach].slice(0, 8),
      result: second.result === 'success' && first.result === 'success' ? 'success' : 'partial',
      artifacts: [...new Set([...first.artifacts, ...second.artifacts])].slice(0, 15),
      decisions: [...first.decisions, ...second.decisions].slice(0, 5),
      pendingIssues: [...first.pendingIssues, ...second.pendingIssues].slice(0, 5),
      keyParams: { ...first.keyParams, ...second.keyParams },
      createdAt: second.createdAt,
      messageRange: { start: first.messageRange.start, end: second.messageRange.end },
    };
    this.taskMemory = [merged, ...rest];
    this.stats.taskMemoryCount = this.taskMemory.length;
    logger.info('layered-memory: oldest checkpoints merged', { total: this.taskMemory.length });
  }

  /**
   * 从项目记忆中召回与当前目标相关的历史条目
   * 基于标签和关键词匹配
   */
  recall(goal: string): ProjectMemoryEntry[] {
    if (this.projectMemory.length === 0) return [];

    const keywords = this.extractKeywords(goal);
    const scored = this.projectMemory.map((entry) => {
      let score = 0;
      // 标签匹配
      for (const tag of entry.tags) {
        if (keywords.some((kw) => tag.toLowerCase().includes(kw.toLowerCase()))) {
          score += 2;
        }
      }
      // 目标文本匹配
      for (const kw of keywords) {
        if (entry.goal.toLowerCase().includes(kw.toLowerCase())) score += 1;
        if (entry.decisions.some((d) => d.toLowerCase().includes(kw.toLowerCase()))) score += 0.5;
      }
      // 时间衰减：越近的权重越高
      const ageDays = (Date.now() - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      score *= Math.max(0.3, 1 - ageDays / 30); // 30 天以上衰减到 0.3
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const recalled = scored.filter((x) => x.score > 0).slice(0, this.config.maxRecalledItems).map((x) => x.entry);

    logger.info('layered-memory: recalled project memory', {
      goal: goal.slice(0, 50),
      recalled: recalled.length,
      total: this.projectMemory.length,
    });

    return recalled;
  }

  /** 提取关键词（中英文混合） */
  private extractKeywords(text: string): string[] {
    const words: string[] = [];
    const english = text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
    for (const w of english) {
      if (w.length >= 3) words.push(w.toLowerCase());
    }
    const chinese = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    words.push(...chinese);
    return [...new Set(words)].slice(0, 15);
  }

  /**
   * 构建完整上下文（用于注入 system prompt）
   * 包含：项目记忆召回摘要 + 任务记忆 Checkpoint 合并 + 工作记忆完整消息
   */
  buildContext(goal?: string): {
    systemPrompt: string;
    messages: ChatMessage[];
  } {
    const parts: string[] = [];

    // 1. 项目记忆召回（如果有目标）
    if (goal) {
      const recalled = this.recall(goal);
      if (recalled.length > 0) {
        parts.push('=== 项目记忆（相关历史任务召回）===');
        for (const entry of recalled) {
          parts.push(`\n📌 ${entry.goal}`);
          if (entry.decisions.length > 0) {
            parts.push(`  决策: ${entry.decisions.slice(0, 3).join('; ')}`);
          }
          if (entry.artifacts.length > 0) {
            parts.push(`  产物: ${entry.artifacts.slice(0, 5).join(', ')}`);
          }
          if (entry.pendingIssues.length > 0) {
            parts.push(`  遗留: ${entry.pendingIssues.join('; ')}`);
          }
        }
        parts.push('=== 项目记忆结束 ===\n');
      }
    }

    // 2. 任务记忆 Checkpoint 合并
    if (this.taskMemory.length > 0) {
      parts.push(mergeCheckpoints(this.taskMemory));
      parts.push('');
    }

    const systemPrompt = parts.join('\n');
    return { systemPrompt, messages: this.workingMemory };
  }

  /**
   * 将当前任务记忆持久化为项目记忆条目（任务完成时调用）
   */
  persistToProjectMemory(goal: string, tags: string[] = []): ProjectMemoryEntry {
    const entry: ProjectMemoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      goal,
      decisions: this.taskMemory.flatMap((cp) => cp.decisions).slice(0, 10),
      artifacts: [...new Set(this.taskMemory.flatMap((cp) => cp.artifacts))].slice(0, 20),
      pendingIssues: this.taskMemory.flatMap((cp) => cp.pendingIssues).slice(0, 5),
      userPreferences: [],
      timestamp: new Date().toISOString(),
      tags: tags.length > 0 ? tags : this.extractKeywords(goal),
    };

    this.projectMemory.push(entry);
    this.saveProjectMemory();
    this.stats.projectMemoryCount = this.projectMemory.length;

    logger.info('layered-memory: persisted to project memory', {
      goal,
      tags: entry.tags,
      total: this.projectMemory.length,
    });

    return entry;
  }

  /** 清空当前会话的工作记忆和任务记忆（项目记忆保留） */
  resetSession(): void {
    this.workingMemory = [];
    this.taskMemory = [];
    this.currentTaskStartIdx = 0;
    this.stats.workingMemoryCount = 0;
    this.stats.taskMemoryCount = 0;
    logger.info('layered-memory: session reset');
  }

  /** 获取记忆统计 */
  getStats(): MemoryStats {
    return { ...this.stats };
  }

  /** 确保目录存在 */
  private ensureDirs(): void {
    try {
      mkdirSync(this.config.memoryDir, { recursive: true });
    } catch {
      /* 目录创建失败忽略 */
    }
  }

  /** 项目记忆文件路径 */
  private projectMemoryFile(): string {
    return join(this.config.memoryDir, 'project-memory.json');
  }

  /** 加载项目记忆 */
  private loadProjectMemory(): void {
    try {
      const file = this.projectMemoryFile();
      if (!existsSync(file)) return;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as ProjectMemoryEntry[];
      if (Array.isArray(parsed)) {
        this.projectMemory = parsed;
        this.stats.projectMemoryCount = parsed.length;
      }
    } catch (e) {
      logger.warn('layered-memory: failed to load project memory', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 保存项目记忆 */
  private saveProjectMemory(): void {
    try {
      const file = this.projectMemoryFile();
      mkdirSync(dirname(file), { recursive: true });
      // 只保留最近 100 条，防止文件过大
      const toSave = this.projectMemory.slice(-100);
      writeFileSync(file, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (e) {
      logger.warn('layered-memory: failed to save project memory', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** 便捷函数：创建分层记忆管理器 */
export function createLayeredMemory(config?: Partial<LayeredMemoryConfig>): LayeredMemory {
  return new LayeredMemory(config);
}

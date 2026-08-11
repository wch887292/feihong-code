/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 自我改进（M8）：
 * - 任务后反思：提取成功/失败模式
 * - 策略优化：基于历史表现调整行为
 * - 经验融合：将反思结果注入经验库
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ChatMessage } from '../models/model.interface';
import { saveExperience, type Experience } from './experience';

export interface ReflectionResult {
  success: boolean;
  patterns: string[];
  improvements: string[];
  strategyChanges: string[];
}

export interface SelfImprovementConfig {
  reflectionEnabled: boolean;
  maxPatternsPerTask: number;
  experienceDir: string;
}

const DEFAULT_CONFIG: SelfImprovementConfig = {
  reflectionEnabled: true,
  maxPatternsPerTask: 5,
  experienceDir: join(require('os').homedir(), '.feihong-code', 'improvements'),
};

export class SelfImprover {
  private readonly config: SelfImprovementConfig;
  private readonly improvements: ImprovementRecord[] = [];

  constructor(config: Partial<SelfImprovementConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 任务后反思 */
  reflect(messages: ChatMessage[], success: boolean, durationMs: number): ReflectionResult {
    const patterns = this.extractPatterns(messages, success);
    const improvements = this.generateImprovements(messages, success, patterns);
    const strategyChanges = this.deriveStrategyChanges(patterns, improvements);

    const result: ReflectionResult = {
      success,
      patterns: patterns.slice(0, this.config.maxPatternsPerTask),
      improvements,
      strategyChanges,
    };

    // 保存反思记录
    this.improvements.push({
      timestamp: new Date().toISOString(),
      success,
      durationMs,
      patterns: result.patterns,
      improvements: result.improvements,
    });

    // 写入经验库
    if (this.config.reflectionEnabled) {
      const exp: Experience = {
        id: `improvement-${Date.now()}`,
        type: success ? 'success-pattern' : 'error-pattern',
        title: success ? '成功模式提取' : '失败模式分析',
        content: result.improvements.join('\n'),
        metadata: {
          successRate: success ? 1.0 : 0.0,
          sessionCount: 1,
          tags: result.patterns.slice(0, 3),
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
      };
      mkdirSync(this.config.experienceDir, { recursive: true });
      saveExperience(this.config.experienceDir, exp).catch(() => {});
    }

    return result;
  }

  /** 加载历史改进记录 */
  loadImprovements(): ImprovementRecord[] {
    const file = join(this.config.experienceDir, 'improvements.json');
    if (!existsSync(file)) return [];
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ImprovementRecord[];
    } catch {
      return [];
    }
  }

  /** 保存改进记录 */
  saveImprovements(records: ImprovementRecord[]): void {
    mkdirSync(this.config.experienceDir, { recursive: true });
    writeFileSync(
      join(this.config.experienceDir, 'improvements.json'),
      JSON.stringify(records, null, 2),
      'utf8',
    );
  }

  /** 获取改进统计 */
  getStats(): { totalReflections: number; successRate: number; avgDurationMs: number } {
    if (this.improvements.length === 0) {
      return { totalReflections: 0, successRate: 0, avgDurationMs: 0 };
    }
    const total = this.improvements.length;
    const successful = this.improvements.filter((i) => i.success).length;
    const avgDuration =
      this.improvements.reduce((sum, i) => sum + i.durationMs, 0) / total;
    return {
      totalReflections: total,
      successRate: successful / total,
      avgDurationMs: avgDuration,
    };
  }

  private extractPatterns(_messages: ChatMessage[], success: boolean): string[] {
    const patterns: string[] = [];

    // 成功/失败模式
    if (success) {
      patterns.push('任务成功完成，策略有效');
    } else {
      patterns.push('任务未完成，需要调整策略');
    }

    return patterns;
  }

  private generateImprovements(_messages: ChatMessage[], success: boolean, patterns: string[]): string[] {
    const improvements: string[] = [];

    if (!success) {
      improvements.push('失败任务：检查错误分类并重试');
      improvements.push('失败任务：考虑简化目标或分解子任务');
    }

    // 基于模式生成改进建议
    for (const pattern of patterns) {
      if (pattern.includes('工具') && pattern.includes('高频')) {
        improvements.push('高频工具调用：考虑批量操作优化');
      }
      if (pattern.includes('错误')) {
        improvements.push('错误模式：增加前置校验减少运行时错误');
      }
    }

    if (improvements.length === 0) {
      improvements.push('持续监控工具调用效率');
    }

    return improvements;
  }

  private deriveStrategyChanges(patterns: string[], improvements: string[]): string[] {
    const changes: string[] = [];

    if (patterns.some((p) => p.includes('错误模式'))) {
      changes.push('增强错误检测机制');
    }
    if (improvements.some((i) => i.includes('批量操作'))) {
      changes.push('优化工具调用批次');
    }
    if (changes.length === 0) {
      changes.push('保持当前策略');
    }

    return changes;
  }
}

export interface ImprovementRecord {
  timestamp: string;
  success: boolean;
  durationMs: number;
  patterns: string[];
  improvements: string[];
}

/** 便捷函数 */
export function createSelfImprover(config?: Partial<SelfImprovementConfig>): SelfImprover {
  return new SelfImprover(config);
}

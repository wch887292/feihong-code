/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 自我改进（M6 / 自我迭代核心）：
 * - 任务后反思：从真实对话中统计工具调用、错误簇、自愈恢复，产出具体模式与改进
 * - 经验融合：将反思结果以「稳定 id + upsert」写入与 orchestrator 同一套 experiences 库，
 *   使自我迭代真正回流到后续任务（闭合环），而非写入互不相连的孤岛目录
 * - 人类可读账本：另存 improvements.json 供 self-improve 命令展示
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ChatMessage } from '../models/model.interface';
import {
  upsertExperience,
  retrieveRelevantExperiences,
  generateExperiencePrompt,
  normalizeExperienceId,
  type Experience,
} from './experience';

export interface ReflectionResult {
  success: boolean;
  patterns: string[];
  improvements: string[];
  strategyChanges: string[];
}

export interface SelfImprovementConfig {
  reflectionEnabled: boolean;
  maxPatternsPerTask: number;
  /** 与 orchestrator 共用同一经验库，默认就是 experiences 目录 */
  experienceDir: string;
}

const DEFAULT_CONFIG: SelfImprovementConfig = {
  reflectionEnabled: true,
  maxPatternsPerTask: 5,
  experienceDir: join(homedir(), '.feihong-code', 'experiences'),
};

export class SelfImprover {
  private readonly config: SelfImprovementConfig;
  private readonly improvements: ImprovementRecord[] = [];

  constructor(config: Partial<SelfImprovementConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 经验库目录（与 orchestrator 共用，供命令层展示） */
  get experienceStoreDir(): string {
    return this.config.experienceDir;
  }

  /** 任务后反思（基于真实对话内容分析，异步持久化到统一经验库） */
  async reflect(messages: ChatMessage[], success: boolean, durationMs: number): Promise<ReflectionResult> {
    const toolCalls = messages
      .filter((m) => m.role === 'assistant' && m.toolCalls)
      .flatMap((m) => m.toolCalls ?? []);
    const errors = messages.filter((m) => m.role === 'tool' && (m.content || '').startsWith('错误:'));
    const hasSelfHeal =
      errors.length > 0 &&
      messages.some((m) =>
        m.role === 'assistant' && /修复|已修复|解决|resolved|fixed|通过验证|验证通过/i.test(m.content || ''),
      );

    // 模式提取（具体、可观测）
    const patterns: string[] = [];
    if (success) patterns.push('任务成功完成，核心策略有效');
    else patterns.push('任务未达成，需调整策略');
    if (toolCalls.length >= 3) patterns.push(`工具调用高频(${toolCalls.length}次)，注意批次化与最小改动`);
    if (errors.length > 0) patterns.push(`出现 ${errors.length} 处工具错误，需增强前置校验`);
    if (hasSelfHeal) patterns.push('发生自愈并恢复，闭环修复有效');

    // 改进建议（针对性）
    const improvements: string[] = [];
    if (!success) {
      improvements.push('复盘失败任务：定位首个错误根因，先最小化复现再修复');
      improvements.push('考虑将大目标拆为更小、可独立验证的子任务');
    }
    if (errors.length > 0) improvements.push('为高频错误类型补充前置校验，减少运行时失败');
    if (toolCalls.length >= 5) improvements.push('工具调用偏多，先勘察再动手可减少往返轮次');
    if (improvements.length === 0) improvements.push('维持当前执行节奏，持续监控工具效率');

    // 策略变化
    const strategyChanges: string[] = [];
    if (errors.length > 0) strategyChanges.push('增强错误检测与前置校验');
    if (hasSelfHeal) strategyChanges.push('固化自愈闭环为默认行为');
    if (strategyChanges.length === 0) strategyChanges.push('保持当前策略');

    const result: ReflectionResult = {
      success,
      patterns: patterns.slice(0, this.config.maxPatternsPerTask),
      improvements,
      strategyChanges,
    };

    // 内存账本
    this.improvements.push({
      timestamp: new Date().toISOString(),
      success,
      durationMs,
      patterns: result.patterns,
      improvements: result.improvements,
    });

    // 写入统一经验库（与 orchestrator 共用，实现回流）
    if (this.config.reflectionEnabled) {
      const key = `reflect:${result.patterns.slice(0, 2).join('|')}`;
      const exp: Experience = {
        id: normalizeExperienceId(success ? 'success-pattern' : 'error-pattern', key),
        type: success ? 'success-pattern' : 'error-pattern',
        title: success ? '成功模式反思' : '失败模式反思',
        content: `反思结论:\n${result.improvements.join('\n')}\n策略变化: ${result.strategyChanges.join('; ')}`,
        metadata: {
          successRate: success ? 1.0 : 0.0,
          sessionCount: 1,
          tags: result.patterns.slice(0, 3).map((p) => p.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12)),
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
      };
      mkdirSync(this.config.experienceDir, { recursive: true });
      await upsertExperience(this.config.experienceDir, exp);
      this.saveImprovements(this.improvements);
    }

    return result;
  }

  /** 基于目标召回既往学习，生成注入模型的「学习提示」 */
  async getLearnedPrompt(goal: string): Promise<string> {
    const exps = await retrieveRelevantExperiences(this.config.experienceDir, goal);
    return generateExperiencePrompt(exps);
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
    const avgDuration = this.improvements.reduce((sum, i) => sum + i.durationMs, 0) / total;
    return {
      totalReflections: total,
      successRate: successful / total,
      avgDurationMs: avgDuration,
    };
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

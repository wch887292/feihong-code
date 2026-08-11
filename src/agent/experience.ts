/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 经验学习（Experience Learning）：
 * - 会话完成后自动提取经验（成功模式、失败教训、高效工具调用序列）
 * - 存储到 FH_HOME/experiences/*.jsonl
 * - 下次任务开始时加载相关经验注入 system prompt
 */
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { ChatMessage } from '../models/model.interface';
import { logger } from '../shared/logger';

export type ExperienceType =
  | 'tool-efficiency'      // 高效工具调用模式
  | 'error-pattern'        // 错误模式与规避
  | 'path-planning'        // 文件路径规划技巧
  | 'success-pattern'      // 成功执行序列
  | 'performance-tip';     // 性能优化建议

export interface Experience {
  id: string;
  type: ExperienceType;
  title: string;
  content: string;
  metadata: {
    sessionCount: number;
    successRate: number;
    tags: string[];
    createdAt: string;
    lastUsedAt: string;
  };
}

/** 从会话历史中提取经验 */
export function extractExperience(messages: ChatMessage[], runId: string): Experience[] {
  const experiences: Experience[] = [];
  const toolCalls: Array<{ name: string; args: unknown; success: boolean }> = [];

  // 提取工具调用序列
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        toolCalls.push({ name: tc.name, args: tc.arguments, success: true });
      }
    }
    if (msg.role === 'tool') {
      const lastCall = toolCalls[toolCalls.length - 1];
      if (lastCall && (msg.content || '').startsWith('错误:')) {
        lastCall.success = false;
      }
    }
  }

  // 经验 1: 高效工具调用模式
  if (toolCalls.length >= 3) {
    const successfulCalls = toolCalls.filter((tc) => tc.success);
    if (successfulCalls.length >= 2) {
      const pattern = successfulCalls.map((tc) => tc.name).join(' → ');
      experiences.push({
        id: `exp-${runId}-tools`,
        type: 'tool-efficiency',
        title: `成功工具序列: ${pattern}`,
        content: `在本次任务中，以下工具调用序列成功完成目标:\n${pattern}\n\n建议未来类似任务可参考此序列。`,
        metadata: {
          sessionCount: 1,
          successRate: successfulCalls.length / toolCalls.length,
          tags: successfulCalls.map((tc) => tc.name),
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
      });
    }
  }

  // 经验 2: 错误模式与规避
  const errors = messages.filter((m) => m.role === 'tool' && (m.content || '').startsWith('错误:'));
  if (errors.length > 0) {
    const errorTypes = errors.map((e) => {
      const content = e.content || '';
      if (content.includes('路径') || content.includes('path')) return 'path-error';
      if (content.includes('超时') || content.includes('timeout')) return 'timeout';
      if (content.includes('权限') || content.includes('permission')) return 'permission';
      return 'unknown';
    });
    const uniqueErrors = [...new Set(errorTypes)];
    experiences.push({
      id: `exp-${runId}-errors`,
      type: 'error-pattern',
      title: `常见错误模式: ${uniqueErrors.join(', ')}`,
      content: `本次任务遇到以下错误类型:\n${uniqueErrors.map((e) => `- ${e}`).join('\n')}\n\n规避建议: 检查文件路径、增加超时重试、确认权限设置。`,
      metadata: {
        sessionCount: 1,
        successRate: 0,
        tags: uniqueErrors,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      },
    });
  }

  return experiences;
}

/** 保存经验到文件 */
export async function saveExperience(experienceDir: string, experience: Experience): Promise<void> {
  await mkdir(experienceDir, { recursive: true });
  const file = join(experienceDir, 'experiences.jsonl');
  await appendFile(file, JSON.stringify(experience) + '\n', 'utf8');
  logger.info('experience saved', { id: experience.id, type: experience.type });
}

/** 加载相关经验（基于任务关键词） */
export async function loadExperiences(experienceDir: string, keywords: string[]): Promise<Experience[]> {
  const file = join(experienceDir, 'experiences.jsonl');
  if (!existsSync(file)) return [];

  try {
    const content = await readFile(file, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const experiences: Experience[] = [];

    for (const line of lines) {
      try {
        const exp: Experience = JSON.parse(line);
        // 匹配关键词
        const matched = keywords.some((kw) =>
          exp.title.includes(kw) ||
          exp.content.includes(kw) ||
          exp.metadata.tags.some((tag) => tag.includes(kw)),
        );
        if (matched) {
          experiences.push(exp);
        }
      } catch {
        // 跳过损坏的经验记录
      }
    }

    // 按成功率排序，返回前 5 条
    return experiences
      .sort((a, b) => b.metadata.successRate - a.metadata.successRate)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/** 更新经验使用统计 */
export async function updateExperienceUsage(experienceDir: string, experienceId: string): Promise<void> {
  const file = join(experienceDir, 'experiences.jsonl');
  if (!existsSync(file)) return;

  try {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const updatedLines = lines.map((line) => {
      try {
        const exp: Experience = JSON.parse(line);
        if (exp.id === experienceId) {
          return JSON.stringify({
            ...exp,
            metadata: {
              ...exp.metadata,
              sessionCount: exp.metadata.sessionCount + 1,
              lastUsedAt: new Date().toISOString(),
            },
          });
        }
        return line;
      } catch {
        return line;
      }
    });

    await writeFile(file, updatedLines.join('\n') + '\n', 'utf8');
  } catch {
    // 静默失败
  }
}

/** 生成经验注入的系统提示 */
export function generateExperiencePrompt(experiences: Experience[]): string {
  if (experiences.length === 0) return '';

  const parts = ['📚 历史经验参考'];
  for (const exp of experiences) {
    parts.push(`\n**${exp.title}** (${exp.type}):\n${exp.content.slice(0, 300)}`);
  }

  return parts.join('\n');
}

/** 列出所有经验 */
export async function listExperiences(experienceDir: string): Promise<Experience[]> {
  const file = join(experienceDir, 'experiences.jsonl');
  if (!existsSync(file)) return [];

  try {
    const content = await readFile(file, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Experience)
      .sort((a, b) => b.metadata.sessionCount - a.metadata.sessionCount);
  } catch {
    return [];
  }
}

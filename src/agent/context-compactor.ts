/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 上下文压缩（Context Compaction）：
 * - 长时任务防止上下文溢出
 * - 保留最近 N 轮完整消息
 * - 压缩早期消息为结构化摘要
 * - 摘要注入为 system message
 */
import type { ChatMessage } from '../models/model.interface';
import { logger } from '../shared/logger';

export interface CompactionStats {
  originalLength: number;
  compressedLength: number;
  preservedMessages: number;
  compressedRounds: number;
  timestamp: string;
}

/** 从早期消息中提取结构化摘要 */
function extractSummary(messages: ChatMessage[]): {
  decisionPoints: string[];
  modifiedFiles: string[];
  keyInsights: string[];
} {
  const modifiedFiles = new Set<string>();
  const decisionPoints: string[] = [];
  const keyInsights: string[] = [];

  for (const msg of messages) {
    // 提取文件路径
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.name === 'write_file' || tc.name === 'edit_file') {
          const path = (tc.arguments as { path?: string })?.path;
          if (path) modifiedFiles.add(path);
        }
        if (tc.name === 'run_shell') {
          const cmd = (tc.arguments as { command?: string })?.command || '';
          if (cmd.includes('npm test') || cmd.includes('npm run build')) {
            decisionPoints.push(`执行验证: ${cmd.slice(0, 50)}`);
          }
        }
      }
    }
    // 提取关键洞察
    if (msg.role === 'assistant' && msg.content) {
      const content = msg.content;
      if (content.includes('完成') || content.includes('成功') || content.includes('注意')) {
        keyInsights.push(content.slice(0, 100));
      }
    }
  }

  return {
    decisionPoints: [...new Set(decisionPoints)].slice(0, 5),
    modifiedFiles: [...modifiedFiles].slice(0, 10),
    keyInsights: [...new Set(keyInsights)].slice(0, 3),
  };
}

/** 生成压缩后的 system prompt */
function generateCompactionPrompt(summary: {
  decisionPoints: string[];
  modifiedFiles: string[];
  keyInsights: string[];
}, preservedCount: number, totalRounds: number): string {
  const parts: string[] = ['📋 任务进展摘要（上下文压缩）'];

  if (summary.modifiedFiles.length > 0) {
    parts.push(`\n**已修改文件** (${summary.modifiedFiles.length} 个):\n${summary.modifiedFiles.map((f: string) => `- ${f}`).join('\n')}`);
  }

  if (summary.decisionPoints.length > 0) {
    parts.push(`\n**关键决策点**:\n${summary.decisionPoints.map((d) => `- ${d}`).join('\n')}`);
  }

  if (summary.keyInsights.length > 0) {
    parts.push(`\n**关键洞察**:\n${summary.keyInsights.map((k) => `- ${k}`).join('\n')}`);
  }

  parts.push(`\n**上下文状态**: 已压缩 ${totalRounds - preservedCount} 轮早期消息，保留最近 ${preservedCount} 轮完整对话`);

  return parts.join('\n');
}

/**
 * 压缩上下文：
 * - 保留最近 preservedCount 轮完整消息
 * - 压缩早期消息为结构化摘要
 * - 返回新的消息列表和压缩统计
 */
export function compactContext(
  messages: ChatMessage[],
  preservedCount: number = 10,
): { messages: ChatMessage[]; stats: CompactionStats } {
  // 始终保留首条 system 指令（messages[0]），避免压缩后丢失系统级提示导致行为退化
  const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
  const body = systemMsg ? messages.slice(1) : messages;

  const totalRounds = Math.floor(body.length / 2); // 假设每轮 2 条消息（assistant + tool）
  const preservedMessages = Math.min(preservedCount * 2, body.length);
  const earlyMessages = body.slice(0, body.length - preservedMessages);
  const recentMessages = body.slice(body.length - preservedMessages);

  if (earlyMessages.length === 0) {
    return { messages, stats: { originalLength: messages.length, compressedLength: messages.length, preservedMessages, compressedRounds: 0, timestamp: new Date().toISOString() } };
  }

  // 提取摘要
  const summary = extractSummary(earlyMessages);
  const compactionPrompt = generateCompactionPrompt(summary, preservedMessages, totalRounds);

  // 压缩摘要作为 system message 注入；原 system 指令（如有）始终保留在首位
  const systemHint: ChatMessage = {
    role: 'system',
    content: compactionPrompt,
  };
  const prefix = systemMsg ? [systemMsg, systemHint] : [systemHint];

  const compacted: ChatMessage[] = [...prefix, ...recentMessages];
  const stats: CompactionStats = {
    originalLength: messages.length,
    compressedLength: compacted.length,
    preservedMessages,
    compressedRounds: totalRounds - Math.floor(preservedMessages / 2),
    timestamp: new Date().toISOString(),
  };

  logger.info('context compaction applied', {
    originalLength: stats.originalLength,
    compressedLength: stats.compressedLength,
    preservedMessages: stats.preservedMessages,
    compressedRounds: stats.compressedRounds,
  });

  return { messages: compacted, stats };
}

/** 检查是否需要触发压缩 */
export function shouldCompact(messages: ChatMessage[], threshold: number): boolean {
  return messages.length >= threshold;
}

/** 从配置读取压缩阈值（默认每 30 条消息触发一次） */
export function getCompactionThreshold(config: { compactEvery?: number } = {}): number {
  return config.compactEvery ?? 30;
}

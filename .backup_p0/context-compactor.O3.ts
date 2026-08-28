/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
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
import { routeContext, allocateBudget, exceedsBudget, estimateTokens } from './context-budget';

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

  // P0 修复：始终保留首条 user 消息（即原始目标），否则压缩后消息数组不再含 user 角色，
  // 部分模型网关（如 agnes-ai.cn）会拒绝并返回 "No user query found in messages"。
  // 先把首条 user 从 body 中摘除，压缩后再放回，避免在 recent 中重复。
  const firstUserIdx = body.findIndex((m) => m.role === 'user');
  const firstUser = firstUserIdx >= 0 ? body[firstUserIdx] : undefined;
  const bodySansUser = firstUser ? [...body.slice(0, firstUserIdx), ...body.slice(firstUserIdx + 1)] : body;

  const totalRounds = Math.floor(body.length / 2); // 假设每轮 2 条消息（assistant + tool）
  const preservedMessages = Math.min(preservedCount * 2, bodySansUser.length);
  const earlyMessages = bodySansUser.slice(0, bodySansUser.length - preservedMessages);
  const recentMessages = bodySansUser.slice(bodySansUser.length - preservedMessages);

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

  // 首条 user 目标始终置于 system 之后、recent 之前，保证下游模型请求必含 user 角色
  const compacted: ChatMessage[] = firstUser
    ? [...prefix, firstUser, ...recentMessages]
    : [...prefix, ...recentMessages];
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

/* ========== O3：token 感知的上下文路由/压缩入口 ========== */

function estimateTokensSafe(m: ChatMessage): number {
  return estimateTokens((m.content || '') + (m.toolCalls ? JSON.stringify(m.toolCalls) : ''));
}

/** 是否因超出 token 预算而需要路由（O3） */
export function shouldCompactByTokens(
  messages: ChatMessage[],
  maxTokens = 128000,
  reservedForOutput = 8192,
): boolean {
  return exceedsBudget(messages, allocateBudget(maxTokens, reservedForOutput));
}

/**
 * token 感知压缩（O3 主入口）：
 *  1) 上下文未超预算 → 原样返回
 *  2) 超预算 → 先做相关性路由（保留 system/首条目标/最近 N 轮 + 高价值早期消息）
 *  3) 路由后仍超预算 → 退化为结构化摘要压缩（compactContext）
 *
 * @param focus 当前任务焦点（用于相关性打分），如目标描述或当前文件路径
 */
export function compactContextByTokens(
  messages: ChatMessage[],
  focus: string,
  opts: { maxTokens?: number; reservedForOutput?: number; recentRounds?: number; preservedCount?: number } = {},
): { messages: ChatMessage[]; tokens: number; routed: boolean; compacted: boolean } {
  const budget = allocateBudget(opts.maxTokens ?? 128000, opts.reservedForOutput ?? 8192);
  if (!exceedsBudget(messages, budget)) {
    return {
      messages,
      tokens: messages.reduce((s, m) => s + estimateTokensSafe(m), 0),
      routed: false,
      compacted: false,
    };
  }
  // 第一层：相关性路由
  const routed = routeContext(messages, focus, budget, { recentRounds: opts.recentRounds ?? 8 });
  if (!exceedsBudget(routed.messages, budget)) {
    logger.info('context routed by tokens (no summary compaction needed)', {
      kept: routed.keptMessages,
      dropped: routed.droppedMessages,
      tokens: routed.totalTokens,
    });
    return { messages: routed.messages, tokens: routed.totalTokens, routed: true, compacted: false };
  }
  // 第二层：仍超预算则退化为结构化摘要压缩
  const compacted = compactContext(routed.messages, opts.preservedCount ?? 10);
  logger.info('context routed + compacted by tokens', {
    routedTokens: routed.totalTokens,
    compactedLength: compacted.stats.compressedLength,
  });
  return { messages: compacted.messages, tokens: compacted.stats.compressedLength, routed: true, compacted: true };
}

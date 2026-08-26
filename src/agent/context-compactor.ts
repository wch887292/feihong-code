/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1-1 上下文压缩与任务级 Checkpoint：
 *  - 长时任务防止上下文溢出
 *  - 保留最近 N 轮完整消息
 *  - 压缩早期消息为结构化摘要（决策点、修改文件、关键洞察、错误修复）
 *  - 任务级 Checkpoint：每个子任务完成后生成结构化摘要（目标/做法/结果/遗留问题/产物路径）
 *  - Checkpoint 合并与格式化，注入为 system message
 *  - 智能压缩：保留决策点和关键参数，丢弃过程性对话
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

/** 任务级 Checkpoint：子任务完成后的结构化摘要 */
export interface TaskCheckpoint {
  /** 子任务目标 */
  goal: string;
  /** 做法摘要（关键步骤） */
  approach: string[];
  /** 结果（成功/失败/部分完成） */
  result: 'success' | 'partial' | 'failed';
  /** 产物路径（生成/修改的文件） */
  artifacts: string[];
  /** 关键决策点（为什么这么做） */
  decisions: string[];
  /** 遗留问题（未解决的、需要后续处理的） */
  pendingIssues: string[];
  /** 关键参数/配置（后续任务需要知道的） */
  keyParams: Record<string, string>;
  /** 创建时间 */
  createdAt: string;
  /** 覆盖的消息范围（从第几条到第几条） */
  messageRange: { start: number; end: number };
}

/** 从早期消息中提取结构化摘要（增强版：提取更多关键信息） */
function extractSummary(messages: ChatMessage[]): {
  decisionPoints: string[];
  modifiedFiles: string[];
  keyInsights: string[];
  errorFixes: string[];
  toolResults: string[];
} {
  const modifiedFiles = new Set<string>();
  const decisionPoints: string[] = [];
  const keyInsights: string[] = [];
  const errorFixes: string[] = [];
  const toolResults: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // 提取文件路径
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.name === 'write_file' || tc.name === 'edit_file') {
          const path = (tc.arguments as { path?: string })?.path;
          if (path) modifiedFiles.add(path);
        }
        if (tc.name === 'run_shell') {
          const cmd = (tc.arguments as { command?: string })?.command || '';
          if (cmd.includes('npm test') || cmd.includes('npm run build') || cmd.includes('tsc')) {
            decisionPoints.push(`执行验证: ${cmd.slice(0, 60)}`);
          }
        }
        if (tc.name === 'read_file' || tc.name === 'list_dir') {
          // 记录关键的信息收集动作
        }
      }
    }
    // 提取工具结果中的关键信息（错误、成功、输出）
    if (msg.role === 'tool' && msg.content) {
      const content = msg.content;
      if (content.startsWith('错误:')) {
        errorFixes.push(content.slice(0, 120));
      } else if (content.includes('成功') || content.includes('已生成') || content.includes('已创建')) {
        toolResults.push(content.slice(0, 100));
      }
    }
    // 提取关键洞察（assistant 的总结性内容）
    if (msg.role === 'assistant' && msg.content) {
      const content = msg.content;
      // 总结性语句
      if (/(完成|成功|注意|关键|因此|所以|接下来|下一步)/.test(content) && content.length < 300) {
        keyInsights.push(content.slice(0, 150));
      }
      // 决策说明
      if (/(选择|决定|采用|使用|因为|由于|考虑到)/.test(content) && content.length < 200) {
        decisionPoints.push(content.slice(0, 120));
      }
    }
  }

  return {
    decisionPoints: [...new Set(decisionPoints)].slice(0, 8),
    modifiedFiles: [...modifiedFiles].slice(0, 15),
    keyInsights: [...new Set(keyInsights)].slice(0, 5),
    errorFixes: [...new Set(errorFixes)].slice(0, 5),
    toolResults: [...new Set(toolResults)].slice(0, 5),
  };
}

/** 生成压缩后的 system prompt */
function generateCompactionPrompt(summary: {
  decisionPoints: string[];
  modifiedFiles: string[];
  keyInsights: string[];
  errorFixes: string[];
  toolResults: string[];
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

  if (summary.errorFixes.length > 0) {
    parts.push(`\n**已修复的错误**:\n${summary.errorFixes.map((e) => `- ${e}`).join('\n')}`);
  }

  parts.push(`\n**上下文状态**: 已压缩 ${totalRounds - preservedCount} 轮早期消息，保留最近 ${preservedCount} 轮完整对话`);

  return parts.join('\n');
}

/**
 * 从消息范围创建任务级 Checkpoint
 * 用于子任务完成后的结构化摘要，比普通压缩更精细
 */
export function createCheckpoint(
  messages: ChatMessage[],
  range: { start: number; end: number },
  goal?: string,
): TaskCheckpoint {
  const slice = messages.slice(range.start, range.end);
  const summary = extractSummary(slice);

  // 推断结果：如果最后一条是工具错误，标记为 failed；如果有成功输出，标记为 success
  let result: TaskCheckpoint['result'] = 'partial';
  const lastTool = [...slice].reverse().find((m) => m.role === 'tool');
  if (lastTool) {
    if (lastTool.content?.startsWith('错误:')) {
      result = 'failed';
    } else if (lastTool.content && (lastTool.content.includes('成功') || lastTool.content.includes('已生成'))) {
      result = 'success';
    }
  }
  const lastAssistant = [...slice].reverse().find((m) => m.role === 'assistant' && m.content);
  if (lastAssistant && /(完成|成功解决|已实现)/.test(lastAssistant.content)) {
    result = 'success';
  }

  // 提取遗留问题：未修复的错误
  const pendingIssues = summary.errorFixes.length > 0 && result !== 'success'
    ? summary.errorFixes.slice(0, 3)
    : [];

  return {
    goal: goal || '未命名子任务',
    approach: summary.decisionPoints.slice(0, 5),
    result,
    artifacts: summary.modifiedFiles,
    decisions: summary.keyInsights.slice(0, 3),
    pendingIssues,
    keyParams: {},
    createdAt: new Date().toISOString(),
    messageRange: range,
  };
}

/** 合并多个 Checkpoint 为一个摘要（用于任务记忆层） */
export function mergeCheckpoints(checkpoints: TaskCheckpoint[]): string {
  if (checkpoints.length === 0) return '';

  const parts: string[] = ['📚 任务记忆（已完成子任务摘要）'];

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    const statusIcon = cp.result === 'success' ? '✅' : cp.result === 'partial' ? '⚠️' : '❌';
    parts.push(`\n**子任务 ${i + 1}**: ${cp.goal} ${statusIcon}`);
    if (cp.approach.length > 0) {
      parts.push(`  做法: ${cp.approach.slice(0, 3).join('; ')}`);
    }
    if (cp.artifacts.length > 0) {
      parts.push(`  产物: ${cp.artifacts.slice(0, 5).join(', ')}`);
    }
    if (cp.pendingIssues.length > 0) {
      parts.push(`  遗留: ${cp.pendingIssues.join('; ')}`);
    }
  }

  const successCount = checkpoints.filter((c) => c.result === 'success').length;
  parts.push(`\n**总计**: ${checkpoints.length} 个子任务，${successCount} 成功，${checkpoints.length - successCount} 需关注`);

  return parts.join('\n');
}

/** 格式化单个 Checkpoint 为 prompt 片段（用于按需注入） */
export function formatCheckpoint(cp: TaskCheckpoint): string {
  const statusIcon = cp.result === 'success' ? '✅' : cp.result === 'partial' ? '⚠️' : '❌';
  const lines = [
    `📌 ${cp.goal} ${statusIcon}`,
  ];
  if (cp.approach.length > 0) {
    lines.push(`做法: ${cp.approach.join('; ')}`);
  }
  if (cp.artifacts.length > 0) {
    lines.push(`产物: ${cp.artifacts.join(', ')}`);
  }
  if (cp.decisions.length > 0) {
    lines.push(`决策: ${cp.decisions.join('; ')}`);
  }
  if (cp.pendingIssues.length > 0) {
    lines.push(`遗留: ${cp.pendingIssues.join('; ')}`);
  }
  return lines.join('\n');
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

/** 智能压缩：基于内容重要性的选择性保留（而非简单截断）
 *  保留：system 指令、原始目标、包含决策/错误/产物的消息
 *  压缩：纯过程性对话、重复的工具调用
 */
export function smartCompact(
  messages: ChatMessage[],
  targetLength: number = 40,
): { messages: ChatMessage[]; stats: CompactionStats } {
  if (messages.length <= targetLength) {
    return {
      messages,
      stats: { originalLength: messages.length, compressedLength: messages.length, preservedMessages: messages.length, compressedRounds: 0, timestamp: new Date().toISOString() },
    };
  }

  // 标记每条消息的重要性
  const importance = messages.map((msg, idx) => {
    let score = 0;
    // 首条 system 最重要
    if (idx === 0 && msg.role === 'system') score += 100;
    // 首条 user（原始目标）
    if (msg.role === 'user' && idx <= 2) score += 50;
    // 包含文件修改的 assistant 消息
    if (msg.role === 'assistant' && msg.toolCalls) {
      const hasFileOp = msg.toolCalls.some((tc) => tc.name === 'write_file' || tc.name === 'edit_file');
      if (hasFileOp) score += 30;
      const hasVerify = msg.toolCalls.some((tc) => tc.name === 'run_shell');
      if (hasVerify) score += 15;
    }
    // 工具错误结果
    if (msg.role === 'tool' && msg.content?.startsWith('错误:')) score += 25;
    // 包含总结性内容的 assistant 消息
    if (msg.role === 'assistant' && msg.content && /(完成|成功|注意|关键|决策)/.test(msg.content)) score += 20;
    // 最近的消息权重更高
    const recency = (idx / messages.length) * 10;
    return score + recency;
  });

  // 选择最重要的消息，同时保持顺序
  const indexed = importance.map((score, idx) => ({ idx, score }));
  indexed.sort((a, b) => b.score - a.score);
  const selectedIdx = new Set(indexed.slice(0, targetLength).map((x) => x.idx));

  // 被压缩的消息范围（最早的未选中消息）
  const compressedStart = Math.min(...Array.from(selectedIdx));
  const compressedSlice = messages.slice(0, compressedStart);
  const summary = extractSummary(compressedSlice);

  const compactionPrompt = generateCompactionPrompt(summary, targetLength, Math.floor(messages.length / 2));
  const systemHint: ChatMessage = { role: 'system', content: compactionPrompt };

  const result = messages.filter((_, idx) => selectedIdx.has(idx));
  // 在 system 之后插入摘要（如果首条是 system）
  if (result[0]?.role === 'system') {
    result.splice(1, 0, systemHint);
  } else {
    result.unshift(systemHint);
  }

  const stats: CompactionStats = {
    originalLength: messages.length,
    compressedLength: result.length,
    preservedMessages: targetLength,
    compressedRounds: Math.floor((messages.length - targetLength) / 2),
    timestamp: new Date().toISOString(),
  };

  logger.info('smart compaction applied', { originalLength: stats.originalLength, compressedLength: stats.compressedLength });

  return { messages: result, stats };
}

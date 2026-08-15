/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 自我修复循环（Self-Healing Loop）：
 * - 错误模式分类（编译失败/运行时错误/路径穿越/超时等）
 * - 反思提示词生成（基于错误提出修复建议）
 * - 自动重试机制（最多 N 次）
 */
import type { ChatMessage } from '../models/model.interface';
import { logger } from '../shared/logger';

export type ErrorCategory =
  | 'compile-error'
  | 'runtime-error'
  | 'path-traversal'
  | 'timeout'
  | 'permission-denied'
  | 'model-error'
  | 'unknown';

export interface ErrorAnalysis {
  category: ErrorCategory;
  message: string;
  fixHint: string;
}

/** 错误分类器：根据工具返回结果判断错误类型（中英双语识别） */
export function classifyError(output: string, error?: string): ErrorAnalysis | null {
  const text = (error || output).toLowerCase();

  // 编译错误
  if (
    text.includes('error ts') ||
    text.includes('typescript error') ||
    text.includes('cannot find module') ||
    text.includes('syntax error') ||
    text.includes('编译') ||
    text.includes('tsc')
  ) {
    return {
      category: 'compile-error',
      message: error || output,
      fixHint: '检查 TypeScript 类型错误、缺失依赖或路径拼写错误。尝试运行 npm run build 查看完整错误信息。',
    };
  }

  // 运行时错误
  if (
    text.includes('undefined is not') ||
    text.includes('cannot read property') ||
    text.includes('referenceerror') ||
    text.includes('typeerror') ||
    text.includes('未定义') ||
    text.includes('is not a function')
  ) {
    return {
      category: 'runtime-error',
      message: error || output,
      fixHint: '检查变量是否已定义、函数调用是否正确、空值处理是否完善。',
    };
  }

  // 路径穿越
  if (
    text.includes('path traversal') ||
    text.includes('outside workspace') ||
    text.includes('safe-path') ||
    text.includes('forbidden') ||
    text.includes('路径') ||
    text.includes('穿越')
  ) {
    return {
      category: 'path-traversal',
      message: error || output,
      fixHint: '文件路径包含非法字符或试图访问工作区外部。使用相对路径，避免 ../ 穿越。',
    };
  }

  // 超时
  if (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('ETIMEDOUT') ||
    text.includes('超时')
  ) {
    return {
      category: 'timeout',
      message: error || output,
      fixHint: '命令执行超时。检查是否存在死循环或需要长时间运行的进程。',
    };
  }

  // 权限拒绝
  if (
    text.includes('permission denied') ||
    text.includes('eacces') ||
    text.includes('eperm') ||
    text.includes('权限') ||
    text.includes('拒绝')
  ) {
    return {
      category: 'permission-denied',
      message: error || output,
      fixHint: '文件权限不足或路径不存在。检查文件权限和目录结构。',
    };
  }

  // 模型错误
  if (
    text.includes('api error') ||
    text.includes('rate limit') ||
    text.includes('429') ||
    text.includes('500') ||
    text.includes('模型') ||
    text.includes('限流')
  ) {
    return {
      category: 'model-error',
      message: error || output,
      fixHint: '模型 API 错误。检查 API 密钥、速率限制或网络连通性。',
    };
  }

  return null;
}

/** 生成反思提示词，指导模型基于错误进行修复 */
export function generateReflectPrompt(errorAnalysis: ErrorAnalysis, _goal?: string): string {
  return `⚠️ 上一轮任务执行失败，请反思并修复：

**错误类型**: ${errorAnalysis.category}
**错误详情**: ${errorAnalysis.message}
**修复建议**: ${errorAnalysis.fixHint}

请基于以上错误信息，重新制定执行方案，注意：
1. 避免重复之前的错误
2. 如有必要，先勘察代码库理解上下文
3. 采用更稳健的实现方式
4. 完成后再次验证
`;
}

/** 将反思消息注入对话上下文 */
export function injectReflection(messages: ChatMessage[], errorAnalysis: ErrorAnalysis, goal: string): ChatMessage[] {
  const reflectMsg: ChatMessage = {
    role: 'user',
    content: generateReflectPrompt(errorAnalysis, goal),
  };
  return [...messages, reflectMsg];
}

/** 统计连续失败次数 */
export function countConsecutiveErrors(messages: ChatMessage[], maxRetries: number): { failed: boolean; errors: number } {
  let errors = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'tool' && msg.content.includes('错误:')) {
      errors++;
    } else if (msg.role === 'tool' && !msg.content.includes('错误:')) {
      // 工具成功执行，重置计数
      break;
    } else if (msg.role === 'assistant' && errors > 0) {
      // 助手在连续错误后仍无工具调用，说明已尝试修复但失败
      break;
    }
  }
  return {
    failed: errors >= maxRetries,
    errors,
  };
}

/** 构建反思上下文（包含历史错误） */
export function buildReflectContext(messages: ChatMessage[], errors: ErrorAnalysis[]): {
  messages: ChatMessage[];
  contextLength: number;
} {
  // 保留最近 5 轮完整对话
  const recentMessages = messages.slice(-10);

  // 将错误历史作为系统提示注入
  const errorHistory = errors.map((e, i) =>
    `[第 ${i + 1} 次失败] 类型: ${e.category}, 详情: ${e.message.slice(0, 200)}`,
  ).join('\n');

  const systemHint: ChatMessage = {
    role: 'system',
    content: `⚠️ 连续失败记录（自动学习模式）\n\n${errorHistory}\n\n请从错误中学习，调整策略，避免重复失败。`,
  };

  return {
    messages: [systemHint, ...recentMessages],
    contextLength: messages.length,
  };
}

/** 记录修复事件到日志 */
export async function logRecoveryAttempt(
  eventLog: { append: (type: string, payload: unknown) => Promise<void> },
  iteration: number,
  errorAnalysis: ErrorAnalysis,
  success: boolean,
): Promise<void> {
  await eventLog.append('self-heal.attempt', {
    iteration,
    category: errorAnalysis.category,
    message: errorAnalysis.message.slice(0, 500),
    success,
    timestamp: new Date().toISOString(),
  });
  logger.info('self-heal recovery attempt', { iteration, category: errorAnalysis.category, success });
}

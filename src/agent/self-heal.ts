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
import type { EventLog } from '../runtime/event-log';
import { logger } from '../shared/logger';

export type ErrorCategory =
  | 'compile-error'
  | 'runtime-error'
  | 'path-traversal'
  | 'timeout'
  | 'permission-denied'
  | 'model-error'
  | 'file-not-found'
  | 'build-error'
  | 'command-not-found'
  | 'invalid-args'
  | 'unknown';

export interface ErrorAnalysis {
  category: ErrorCategory;
  message: string;
  fixHint: string;
}

interface ErrorRule {
  category: ErrorCategory;
  keywords: string[];
  fixHint: string;
}

/** 错误分类规则表（顺序即优先级，命中即返回） */
const ERROR_RULES: ErrorRule[] = [
  {
    category: 'compile-error',
    keywords: ['error ts', 'typescript error', 'cannot find module', 'syntax error', '编译', 'tsc'],
    fixHint: '检查 TypeScript 类型错误、缺失依赖或路径拼写错误。尝试运行 npm run build 查看完整错误信息。',
  },
  {
    category: 'runtime-error',
    keywords: ['undefined is not', 'cannot read property', 'referenceerror', 'typeerror', '未定义', 'is not a function'],
    fixHint: '检查变量是否已定义、函数调用是否正确、空值处理是否完善。',
  },
  {
    category: 'path-traversal',
    keywords: ['path traversal', 'outside workspace', 'safe-path', 'forbidden', '路径', '穿越'],
    fixHint: '文件路径包含非法字符或试图访问工作区外部。使用相对路径，避免 ../ 穿越。',
  },
  {
    category: 'timeout',
    keywords: ['timeout', 'timed out', 'ETIMEDOUT', '超时'],
    fixHint: '命令执行超时。检查是否存在死循环或需要长时间运行的进程。',
  },
  {
    category: 'permission-denied',
    keywords: ['permission denied', 'eacces', 'eperm', '权限', '拒绝'],
    fixHint: '文件权限不足或路径不存在。检查文件权限和目录结构。',
  },
  {
    category: 'file-not-found',
    keywords: ['enoent', 'no such file', '读取失败', '文件不存在', 'not found', 'eisdir', '不存在'],
    fixHint: '目标文件或目录不存在。先用 list_dir 勘察当前目录结构，确认正确路径后再操作；不要反复尝试同一不存在的路径。',
  },
  {
    category: 'build-error',
    keywords: ['missing script', 'npm error', 'build failed', '编译失败', '构建失败', 'exit code 1', 'command failed', 'npm err'],
    fixHint: '构建命令执行失败。请按以下步骤排查：1) 先用 list_dir 确认当前工作目录和 package.json 位置；2) 检查 package.json 的 scripts 字段是否存在对应命令；3) 运行 npm install 确保依赖已安装；4) 直接运行构建命令查看完整错误信息（如 npm run build）；5) 根据具体错误信息修复代码后再重试。不要盲目重复相同的构建命令。',
  },
  {
    category: 'command-not-found',
    keywords: ['command not found', 'not recognized', 'is not recognized', '找不到命令', '命令不存在', 'enoent command'],
    fixHint: '命令不存在或未安装。检查命令拼写是否正确、是否需要先安装依赖、是否在正确的工作目录下执行。',
  },
  {
    category: 'invalid-args',
    keywords: ['参数校验失败', '参数警告', 'unknown tool', '未知工具', 'invalid argument', 'unexpected argument'],
    fixHint: '工具参数错误。检查是否把 A 工具的参数传给了 B 工具，每个工具只接受自己文档中定义的参数。先确认工具名称，再传对应参数。',
  },
  {
    category: 'model-error',
    keywords: ['api error', 'rate limit', '429', '500', '模型', '限流'],
    fixHint: '模型 API 错误。检查 API 密钥、速率限制或网络连通性。',
  },
];

/** 错误分类器：根据工具返回结果判断错误类型（规则表驱动，中英双语识别）。
 *  未命中任何规则时返回 'unknown' 兜底分类，确保 orchestrator 的重试上限与自愈逻辑不会被绕过。 */
export function classifyError(output: string, error?: string): ErrorAnalysis {
  const text = (error || output).toLowerCase();
  for (const rule of ERROR_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return { category: rule.category, message: error || output, fixHint: rule.fixHint };
    }
  }
  return {
    category: 'unknown',
    message: error || output,
    fixHint: '未识别的错误类型。请仔细阅读错误信息，调整执行策略，避免重复相同操作。',
  };
}

/** 生成反思提示词，指导模型基于错误进行修复。
 *  包含具体工具名、参数、错误详情，避免笼统的"请反思"导致模型重复同样错误。
 *  healCount: 累计自我修复次数，用于动态调整策略——次数越多越强调换思路而非死磕。 */
export function generateReflectPrompt(errorAnalysis: ErrorAnalysis, _goal?: string, lastToolCall?: { name: string; args: Record<string, unknown> }, healCount = 0): string {
  const toolInfo = lastToolCall
    ? `\n**出错工具**: ${lastToolCall.name}\n**传入参数**: ${JSON.stringify(lastToolCall.args)}\n`
    : '';

  // 根据累计修复次数动态调整策略提示
  let strategyHint = '';
  if (healCount >= 7) {
    // 第8次及以上：强烈警告，要求彻底换方向
    strategyHint = `
🚨 **严重警告**：这已经是第 ${healCount + 1} 次尝试修复了，但问题仍然存在。说明当前思路/方法可能根本走不通！

**必须彻底改变策略**：
1. 不要再尝试修复当前的代码或命令——它已经失败了 ${healCount + 1} 次
2. 停下来重新思考：目标是什么？有没有完全不同的实现方式？
3. 换一个工具、换一个库、换一种架构——甚至简化目标，砍掉复杂的部分
4. 如果某个功能一直实现不了，先跳过它，把能跑的基础版本做出来
5. 先用 list_dir 全面勘察当前目录，确认你在正确的位置、有哪些文件可用
`;
  } else if (healCount >= 4) {
    // 第5-7次：强调换方法
    strategyHint = `
⚠️ **注意**：这已经是第 ${healCount + 1} 次尝试修复了。如果同样的方法反复失败，请考虑：
1. 换一种完全不同的实现方式，不要在同一个坑里反复试
2. 换一个工具来完成目标（比如用 write_file 替代 run_shell，或用 list_dir 先勘察）
3. 简化目标——先做出能跑的最小版本，再逐步加功能
4. 检查是否在错误的目录下操作，先用 list_dir 确认当前位置
`;
  } else {
    // 前4次：正常修复提示
    strategyHint = `
请严格遵守以下规则：
1. 不要再用相同参数重复调用同一个失败的工具——这会继续失败
2. 检查工具名称是否正确、参数是否属于该工具（每个工具只接受自己文档中定义的参数）
3. 如有必要，先用 list_dir 勘察目录结构，或用 read_file 确认文件存在
4. 如果某个工具连续失败，换一种方式或换一个工具实现目标
5. 修正后再调用工具，不要盲目重试
`;
  }

  return `⚠️ 上一轮工具执行失败，请仔细反思并修正策略：

**错误类型**: ${errorAnalysis.category}
**错误详情**: ${errorAnalysis.message}${toolInfo}
**修复建议**: ${errorAnalysis.fixHint}
${strategyHint}`;
}

/** 将反思消息注入对话上下文。healCount 为累计修复次数，用于动态调整策略。 */
export function injectReflection(messages: ChatMessage[], errorAnalysis: ErrorAnalysis, goal: string, lastToolCall?: { name: string; args: Record<string, unknown> }, healCount = 0): ChatMessage[] {
  const reflectMsg: ChatMessage = {
    role: 'user',
    content: generateReflectPrompt(errorAnalysis, goal, lastToolCall, healCount),
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
  eventLog: Pick<EventLog, 'append'>,
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

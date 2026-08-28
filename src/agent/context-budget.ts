/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * O3 超长上下文路由（context-budget）：
 *  - estimateTokens：轻量 token 估算（中文按字、其它按 ~4 字符/token），不依赖 tiktoken，零外部依赖
 *  - allocateBudget：在模型窗口内为"上下文"与"输出"分配预算
 *  - relevanceScore：基于关键词/符号重叠的相关性打分，用于挑选高价值历史
 *  - routeContext：预算内路由——保留 system、首条目标、最近 N 轮，并按相关性补回早期高价值消息
 *
 * 设计原则：纯函数、无副作用、可单元测试；被 orchestrator 在"超长上下文"场景调用，
 * 补全路径亦可复用（把 fileContent 作为 focus 做相关性路由）。
 */
import type { ChatMessage } from '../models/model.interface';

/** 估算一段文本的 token 数（启发式，足够用于预算决策） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

export interface ContextBudget {
  /** 模型上下文窗口上限 */
  maxTokens: number;
  /** 预留给模型输出的 token */
  reservedForOutput: number;
  /** 实际可用于上下文的预算 */
  availableForContext: number;
}

export function allocateBudget(
  maxTokens = 128000,
  reservedForOutput = 8192,
): ContextBudget {
  return {
    maxTokens,
    reservedForOutput,
    availableForContext: Math.max(0, maxTokens - reservedForOutput),
  };
}

/** 把一条消息序列化为可打分的文本 */
function messageText(m: ChatMessage): string {
  return (
    (m.content || '') +
    (m.toolCalls && m.toolCalls.length ? '\n' + JSON.stringify(m.toolCalls) : '')
  );
}

/**
 * 相关性打分：focus 与消息文本之间的关键词（≥2 字/词）重叠数。
 * 用于超长上下文时，优先保留与当前任务最相关的历史片段。
 */
export function relevanceScore(msg: ChatMessage, focus: string): number {
  const hay = messageText(msg).toLowerCase();
  if (!hay || !focus) return 0;
  const terms = focus
    .toLowerCase()
    .split(/[^\w一-鿿]+/)
    .filter((t) => t.length >= 2);
  const seen = new Set<string>();
  let score = 0;
  for (const t of terms) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (hay.includes(t)) score += 1;
  }
  return score;
}

export interface RoutedContext {
  messages: ChatMessage[];
  totalTokens: number;
  keptMessages: number;
  droppedMessages: number;
}

/**
 * 预算内上下文路由：
 * 1) 始终保留 system 指令与首条 user 目标（防止行为退化）
 * 2) 保留最近 recentRounds 轮完整消息
 * 3) 剩余预算按相关性补回早期高价值消息（仍按时间近似有序插入）
 */
export function routeContext(
  messages: ChatMessage[],
  focus: string,
  budget: ContextBudget = allocateBudget(),
  opts: { recentRounds?: number } = {},
): RoutedContext {
  const recentRounds = opts.recentRounds ?? 8;

  const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
  const body = systemMsg ? messages.slice(1) : messages;

  const firstUserIdx = body.findIndex((m) => m.role === 'user');
  const firstUser = firstUserIdx >= 0 ? body[firstUserIdx] : undefined;
  const bodySansUser = firstUser
    ? [...body.slice(0, firstUserIdx), ...body.slice(firstUserIdx + 1)]
    : body;

  const recentCount = Math.min(recentRounds * 2, bodySansUser.length);
  const recent = bodySansUser.slice(bodySansUser.length - recentCount);
  const early = bodySansUser.slice(0, bodySansUser.length - recentCount);

  const selected: ChatMessage[] = [];
  if (systemMsg) selected.push(systemMsg);
  if (firstUser) selected.push(firstUser);
  selected.push(...recent);

  const headLen = selected.length - recent.length; // 固定头部（system+firstUser）长度
  let total = selected.reduce((s, m) => s + estimateTokens(messageText(m)), 0);

  const earlyRanked = early
    .map((m) => ({ m, s: relevanceScore(m, focus) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  let keptFromEarly = 0;
  for (const { m } of earlyRanked) {
    const t = estimateTokens(messageText(m));
    if (total + t > budget.availableForContext) break;
    // 插入到 recent 之前，保持时间近似有序
    selected.splice(headLen + keptFromEarly, 0, m);
    keptFromEarly += 1;
    total += t;
  }

  return {
    messages: selected,
    totalTokens: total,
    keptMessages: selected.length,
    droppedMessages: early.length - keptFromEarly,
  };
}

/** 判断当前消息列表是否超出上下文预算（用于触发路由/压缩） */
export function exceedsBudget(
  messages: ChatMessage[],
  budget: ContextBudget = allocateBudget(),
): boolean {
  const total = messages.reduce((s, m) => s + estimateTokens(messageText(m)), 0);
  return total > budget.availableForContext;
}

/* ========== 自测（tsx src/agent/context-budget.ts 直接运行） ========== */
if (require.main === module) {
  const msgs: ChatMessage[] = [
    { role: 'system', content: '你是飞虹 Code 智能体' },
    { role: 'user', content: '目标：给 auth.ts 增加 refresh token 轮换' },
    { role: 'assistant', content: '我先读取 auth.ts' },
    { role: 'assistant', content: '', toolCalls: [{ name: 'read_file', arguments: { path: 'auth.ts' }, id: '1' } as any] },
    { role: 'user', content: '无关闲聊：今天天气不错' },
    { role: 'assistant', content: '好的' },
    { role: 'user', content: '请继续实现 refresh token 轮换逻辑' },
    { role: 'assistant', content: '已添加 rotateRefreshToken 函数' },
  ];
  const b = allocateBudget(2000, 256);
  const r = routeContext(msgs, 'auth.ts refresh token 轮换', b, { recentRounds: 2 });
  console.log('估算 token 示例(中文):', estimateTokens('你好世界 hello world'));
  console.log('路由后保留消息数:', r.keptMessages, '丢弃:', r.droppedMessages, '总 token:', r.totalTokens);
  console.log('超预算判定(小窗口):', exceedsBudget(msgs, allocateBudget(50, 10)));
}

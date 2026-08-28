/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2-2 子代理结果摘要（对齐 Claude Code subagents：只回摘要+元数据，
 * 隔离中间结果，避免大输出撑爆主上下文）。
 *
 * 策略：保留首部关键信息（做什么/验证什么），超长截断并标注；同时输出
 * 结构化元数据（字符数/截断标记），供上层报告或审计使用。
 */

/** 子代理结果摘要：默认保留长度 */
export const SUBAGENT_SUMMARY_MAX = 600;

export interface SubTaskSummary {
  /** 摘要文本（≤ SUBAGENT_SUMMARY_MAX 字符） */
  text: string;
  /** 原始长度 */
  originalLength: number;
  /** 是否被截断 */
  truncated: boolean;
}

/**
 * 摘要化子任务最终答案：
 *  - ≤ max 直接返回原文
 *  - > max 保留首部，尾部追加截断标注（含原始长度），不丢"做了什么"的语义
 */
export function summarizeSubTaskAnswer(answer: string, max = SUBAGENT_SUMMARY_MAX): SubTaskSummary {
  const originalLength = answer.length;
  if (answer.length <= max) {
    return { text: answer, originalLength, truncated: false };
  }
  const head = answer.slice(0, max);
  const tail = `\n…（已截断，原文 ${originalLength} 字符）`;
  return { text: head + tail, originalLength, truncated: true };
}

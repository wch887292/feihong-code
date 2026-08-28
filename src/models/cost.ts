/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 成本计量（铁律：模型调用必须可核算成本，避免预算失控）
 */
import type { TokenUsage } from './model.interface';

/** 按每千 token 统一费率估算成本（USD），costPer1k 来自 ProviderConfig */
export function estimateCost(usage: TokenUsage, costPer1k: number): number {
  return (usage.totalTokens / 1000) * costPer1k;
}

/** 预算是否超限 */
export function isOverBudget(spent: number, budget: number): boolean {
  return budget > 0 && spent > budget;
}

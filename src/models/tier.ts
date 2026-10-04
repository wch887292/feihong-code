/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 算力档位（对标纳米Work 轻量 / 省钱 / 满血）：
 *  - 让 fhcode 像纳米Work一样按任务复杂度/成本自动选模型档
 *  - light：最便宜模型优先，适合日常问答/短摘要/简单写作
 *  - save ：成本优先 + cheap 标签，适合资料整理/常规报告
 *  - full ：能力优先（reasoning/code-gen），适合复杂规划/深度分析
 */
import type { CapabilityTag, ComputeTier, ModelStrategy } from '../shared/types';
export type { ComputeTier } from '../shared/types';

export interface TierProfile {
  id: ComputeTier;
  /** 中文档位名 */
  label: string;
  /** 档位说明 */
  desc: string;
  /** 该档位下的模型路由策略 */
  strategy: ModelStrategy;
  /** 该档位默认附加的能力过滤标签 */
  tags: CapabilityTag[];
  /** 成本系数（仅用于展示/估算，不影响实际计费） */
  costFactor: number;
}

/** 三档元信息：与纳米Work 轻量/省钱/满血对齐 */
export const TIERS: Record<ComputeTier, TierProfile> = {
  light: {
    id: 'light',
    label: '轻量模式',
    desc: '省90%：日常问答 / 短摘要 / 简单写作',
    strategy: 'cost',
    tags: ['cheap'],
    costFactor: 0.1,
  },
  save: {
    id: 'save',
    label: '省钱模式',
    desc: '省70%：资料整理 / 信息收集 / 常规报告',
    strategy: 'cost',
    tags: ['cheap'],
    costFactor: 0.3,
  },
  full: {
    id: 'full',
    label: '满血模式',
    desc: '不省能力：复杂规划 / 深度分析 / 长链推理',
    strategy: 'capability',
    tags: [],
    costFactor: 1,
  },
};

/**
 * 启发式复杂度分类（对标纳米Work「按任务复杂度自动调度」）。
 * 命中硬关键词或目标较长时升档；否则走轻量。
 * 注意：仅作默认建议，可被 --tier 或配置 defaultTier 显式覆盖。
 */
export function classifyGoalTier(goal: string): ComputeTier {
  const g = (goal || '').trim();
  if (
    /架构|设计|重构|复杂|深度|分析|规划|调研|实现|开发|debug|调试|修复|优化|安全|审计|长链|推理|技术方案|full|代码生成|自动化/i.test(
      g,
    )
  ) {
    return 'full';
  }
  if (g.length > 120) return 'save';
  return 'light';
}

/** 规范化档位输入，非法值返回 undefined */
export function normalizeTier(v: string | undefined | null): ComputeTier | undefined {
  return v === 'light' || v === 'save' || v === 'full' ? v : undefined;
}

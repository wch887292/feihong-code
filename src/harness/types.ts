/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 模块组核心类型：评测实例 / 执行产出 / 验证结果 / 报告。
 * 对齐 SWE-bench 官方实例结构，供加载器、执行器、验证器、报告器共享。
 */

/** 一个编码/修复评测实例（对齐 SWE-bench 字段） */
export interface HarnessInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  /** 参考修复补丁（gold patch，评测时不应直接注入模型） */
  patch: string;
  /** 测试补丁（评估用 FAIL_TO_PASS / PASS_TO_PASS 的来源） */
  test_patch: string;
  FAIL_TO_PASS: string[];
  PASS_TO_PASS: string[];
  created_at: string;
  version: string;
}

/** 执行器对单个实例的原始产出（不含通过判定，判定交给验证器） */
export interface HarnessExecutionResult {
  instance_id: string;
  repo: string;
  /** 问题首行摘要（报告表格用） */
  problem: string;
  failToPass: number;
  passToPass: number;
  /** 编排器是否正常收尾 */
  runOk: boolean;
  iterations: number;
  toolCalls: number;
  /** 执行工作区（验证器在此检查产出） */
  cwd: string;
  /** 清理临时资源（由编排层在验证后统一调用） */
  cleanup: () => void;
}

/** 单个实例的最终评测结果（执行 + 验证合并） */
export interface HarnessResult {
  instance_id: string;
  repo: string;
  problem: string;
  failToPass: number;
  passToPass: number;
  /** 综合通过：编排收尾 && 验证器通过 */
  ok: boolean;
  iterations: number;
  toolCalls: number;
  /** 验证器是否通过（如方案文件存在） */
  verified: boolean;
}

/** 一次评测运行的元信息 */
export interface HarnessMeta {
  split: string;
  limit: number;
  offset: number;
  mode: string;
  startedAt: string;
}

/** 汇总指标 */
export interface HarnessSummary {
  total: number;
  completed: number;
  rate: number;
}

/** 完整评测报告 */
export interface HarnessReport {
  meta: HarnessMeta;
  results: HarnessResult[];
  summary: HarnessSummary;
}

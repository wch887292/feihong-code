/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 共享类型定义
 */

/** 一次 CLI 运行 / 一个任务的唯一标识 */
export type RunId = string;

/** 能力标签：用于模型路由按能力选优 */
export type CapabilityTag =
  | 'code-gen'
  | 'reasoning'
  | 'long-context'
  | 'vision'
  | 'cheap'
  | 'local';

/** 模型路由策略 */
export type ModelStrategy = 'cost' | 'capability' | 'latency';

/** 任意可 JSON 序列化值 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/** 结构化日志条目 */
export interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  msg: string;
  runId: RunId;
  [key: string]: JSONValue;
}

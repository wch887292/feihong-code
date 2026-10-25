/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹
 *
 * sync-client 类型定义：跨端同步客户端的数据结构
 */

/** sync-client 配置项（从环境变量 / fhcode.config.json 读取） */
export interface SyncClientConfig {
  /** sync-server 的 Base URL，如 http://127.0.0.1:8787 */
  url: string;
  /** Bearer token，与 sync-server 的 FHCODE_SYNC_TOKEN 一致 */
  token: string;
  /** 是否启用同步功能，默认 false（不影响未配置用户） */
  enabled: boolean;
  /** 轮询间隔（毫秒），默认 60000（60 秒） */
  interval: number;
}

/** 会话消息条目（与 sync-server messages 数组元素对齐） */
export interface SyncMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** 工具调用名称（role=tool 时有效） */
  toolName?: string;
  /** 工具调用结果摘要 */
  toolResult?: string;
  timestamp?: string;
}

/** 会话快照（推送到 sync-server 的完整结构） */
export interface SyncSessionSnapshot {
  runId: string;
  goal: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  messages: SyncMessage[];
}

/** claim 接口返回的 goal 条目 */
export interface SyncClaimedGoal {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
  claimedAt?: string;
}

/** claim 接口响应 */
export interface SyncClaimResponse {
  ok: boolean;
  goal: SyncClaimedGoal;
}

/** status 接口响应 */
export interface SyncStatusResponse {
  ok: boolean;
  runId: string;
  status: string;
}

/** sessions 接口响应 */
export interface SyncSessionsResponse {
  ok: boolean;
  runId: string;
  updatedAt: string;
}

/** 会话列表摘要条目（GET /api/sessions 的 sessions 数组元素） */
export interface SyncSessionsSummary {
  runId: string;
  goal: string;
  status: string;
  updatedAt: string | null;
  messageCount: number;
  goalCount: number;
}

/** 推送结果 */
export interface SyncPushResult {
  ok: boolean;
  error?: string;
  runId?: string;
}

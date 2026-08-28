/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 模型层接口契约：与具体 LLM 供应商解耦
 */
import type { CapabilityTag } from '../shared/types';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** assistant 发起的一次工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  /** 归一后的 JSON 参数对象（供应商原始可能是字符串，provider 负责 parse） */
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** 工具结果回填时对应 assistant 的 tool_call id */
  toolCallId?: string;
  /** assistant 回合发起的工具调用 */
  toolCalls?: ToolCall[];
}

/** 暴露给模型的工具定义（JSON Schema 描述入参） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 外部中断信号（如任务队列的停止按钮），触发后中断当前网络请求与编排循环 */
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  message: ChatMessage;
  usage: TokenUsage;
  providerId: string;
  model: string;
  costUsd: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly tags: CapabilityTag[];
  readonly costPer1k?: number;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具系统接口契约
 */
import { z } from 'zod';
import type { RunId } from '../shared/types';
import type { ToolDefinition } from '../models/model.interface';

export interface ToolSecurityConfig {
  shellAllowlist: string[];
  requireApproval: boolean;
}

export interface ToolContext {
  runId: RunId;
  /** 工作区根目录（工具只能在此范围内操作，安全沙箱） */
  cwd: string;
  security: ToolSecurityConfig;
  /** 需要人工审批时回调，返回 true 表示批准 */
  approve?: (action: string) => Promise<boolean>;
}

export interface ToolResult {
  ok: boolean;
  /** 回填给模型的文本内容 */
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  /** 给模型看的 JSON Schema（参数描述） */
  jsonSchema: Record<string, unknown>;
  /** 运行时校验 schema（zod） */
  schema: z.ZodTypeAny;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** 工具 → 模型可见的工具定义 */
export function toDefinition(tool: Tool): ToolDefinition {
  return { name: tool.name, description: tool.description, parameters: tool.jsonSchema };
}

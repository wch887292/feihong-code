/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具系统接口契约
 */
import { z } from 'zod';
import type { RunId } from '../shared/types';
import type { ToolDefinition } from '../models/model.interface';
import type { SandboxMode, SandboxRules } from './sandbox';
import type { HookConfig } from '../runtime/hooks';

export interface ToolSecurityConfig {
  shellAllowlist: string[];
  requireApproval: boolean;
  /** P0-2：沙箱模式（read-only / workspace-write / danger-full-access） */
  sandboxMode?: SandboxMode;
  /** P0-2：网络域名规则 */
  networkRules?: SandboxRules;
  /** P2-1：hooks 确定性控制 */
  hooks?: HookConfig[];
}

/** M4 守卫判定结果 */
export interface ToolGuardVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * M4 工具守卫：在工具真正执行前做「RBAC 策略 → 人工审批 → 审计留痕」。
 * 可选注入；不注入时工具链行为与 M3 一致（社区版无感）。
 */
export interface ToolGuard {
  check(tool: string, args: Record<string, unknown>): Promise<ToolGuardVerdict>;
}

export interface ToolContext {
  runId: RunId;
  /** 工作区根目录（工具只能在此范围内操作，安全沙箱） */
  cwd: string;
  security: ToolSecurityConfig;
  /** 需要人工审批时回调，返回 true 表示批准 */
  approve?: (action: string) => Promise<boolean>;
  /** M4：企业级权限/审计守卫 */
  guard?: ToolGuard;
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

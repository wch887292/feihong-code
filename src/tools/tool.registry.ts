/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具注册表：注册、查找、执行（含 zod 校验 + 错误归一）
 */
import { logger } from '../shared/logger';
import type { Tool, ToolContext, ToolResult } from './tool.interface';
import { toDefinition } from './tool.interface';
import type { ToolDefinition } from '../models/model.interface';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      logger.warn('tool overwritten', { name: tool.name });
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** 模型可见的工具定义列表 */
  definitions(): ToolDefinition[] {
    return this.list().map(toDefinition);
  }

  /** 执行工具（自动 zod 校验入参，错误归一为 ToolResult） */
  async execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, output: '', error: `未知工具: ${name}` };
    }
    const parsed = tool.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return { ok: false, output: '', error: `参数校验失败: ${parsed.error.message}` };
    }
    const args = parsed.data as Record<string, unknown>;

    // M4：企业守卫前置（策略 → 审批 → 审计）。未注入 guard 时行为不变。
    if (ctx.guard) {
      let verdict;
      try {
        verdict = await ctx.guard.check(name, args);
      } catch (e) {
        // 审计写入失败等异常一律按拒绝处理：宁可不做，不可无痕
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('工具守卫校验异常，已拒绝执行', { tool: name, error: msg });
        return { ok: false, output: '', error: `守卫校验失败，操作被拒绝: ${msg}` };
      }
      if (!verdict.allowed) {
        logger.warn('工具调用被守卫拒绝', { tool: name, reason: verdict.reason });
        return { ok: false, output: '', error: verdict.reason };
      }
      // 守卫已是唯一权威闸门（策略 + 审批 + 审计都已完成），
      // 此处关闭工具内的二次审批与白名单硬拦截，避免重复弹审批 / 决策打架。
      ctx = { ...ctx, security: { shellAllowlist: [], requireApproval: false } };
    }

    try {
      return await tool.execute(args, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('tool execution failed', { tool: name, error: msg });
      return { ok: false, output: '', error: msg };
    }
  }
}

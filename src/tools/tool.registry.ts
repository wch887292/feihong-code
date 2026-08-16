/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具注册表：注册、查找、执行（含 zod 校验 + 错误归一）
 */
import { logger } from '../shared/logger';
import type { Tool, ToolContext, ToolResult } from './tool.interface';
import { toDefinition } from './tool.interface';
import { checkSandbox, type SandboxMode, type SandboxRules } from './sandbox';
import { runHooks } from '../runtime/hooks';
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

    // P0-2：沙箱技术边界（先于 RBAC 守卫执行 —— 沙箱是"能否做"的硬边界，
    // 审批/策略都无权放行被沙箱拦截的动作）
    if (ctx.security.sandboxMode) {
      const rules: SandboxRules = ctx.security.networkRules ?? { networkAllow: [], networkDeny: [] };
      const decision = checkSandbox(ctx.security.sandboxMode as SandboxMode, name, args, rules);
      if (decision.blocked) {
        logger.warn('sandbox blocked tool call', { tool: name, reason: decision.reason });
        return { ok: false, output: '', error: `[沙箱拦截] ${decision.reason}` };
      }
    }

    // P2-1：PreToolUse hook（确定性拦截，命令退出码非 0 → 阻止执行）
    const hookCtx = {
      cwd: ctx.cwd,
      runId: ctx.runId,
      tool: name,
      path: typeof args.path === 'string' ? args.path : typeof args.file === 'string' ? args.file : undefined,
    };
    if (ctx.security.hooks?.length) {
      const pre = await runHooks(ctx.security.hooks, 'PreToolUse', hookCtx);
      if (pre.blocked) {
        logger.warn('hook denied tool call', { tool: name, reason: pre.reason });
        return { ok: false, output: '', error: `[hook 拦截] ${pre.reason}` };
      }
    }

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

    let result: ToolResult;
    try {
      result = await tool.execute(args, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('tool execution failed', { tool: name, error: msg });
      return { ok: false, output: '', error: msg };
    }

    // P2-1：PostToolUse / PostEdit hook（记录结果；编辑成功时对文件触发）
    if (ctx.security.hooks?.length) {
      const postCtx = { ...hookCtx, ok: result.ok };
      await runHooks(ctx.security.hooks, 'PostToolUse', postCtx);
      if (result.ok && hookCtx.path) {
        await runHooks(ctx.security.hooks, 'PostEdit', postCtx);
      }
    }

    return result;
  }
}

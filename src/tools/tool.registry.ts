/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具注册表：注册、查找、执行（含 zod 校验 + 错误归一）
 */
import { logger } from '../shared/logger';
import type { Tool, ToolContext, ToolResult } from './tool.interface';
import { toDefinition } from './tool.interface';
import { checkSandbox, type SandboxMode, type SandboxRules } from './sandbox';
import { runHooks } from '../runtime/hooks';
import { runSkillHooks } from '../runtime/hooks';
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

    // 处理 parseToolArgs 返回的解析错误（模型返回了完全无法解析的参数）
    if (rawArgs && typeof rawArgs === 'object' && '__parse_error__' in (rawArgs as Record<string, unknown>)) {
      const rawText = String((rawArgs as Record<string, unknown>).__parse_error__).slice(0, 300);
      logger.warn('tool args parse error', { tool: name, raw: rawText });
      return {
        ok: false,
        output: '',
        error: `工具参数解析失败：你返回的 arguments 不是合法 JSON。原始内容: ${rawText}。请返回合法的 JSON 对象作为工具参数。`,
      };
    }

    // 检测并警告被 zod 静默丢弃的未知参数（模型常把 A 工具的参数传给 B 工具）
    const rawKeys = rawArgs && typeof rawArgs === 'object' ? Object.keys(rawArgs as Record<string, unknown>) : [];
    const knownKeys = Object.keys(args);
    const droppedKeys = rawKeys.filter((k) => !knownKeys.includes(k));
    if (droppedKeys.length > 0) {
      const validHint = tool.jsonSchema && typeof tool.jsonSchema === 'object' && tool.jsonSchema.properties
        ? '，该工具仅接受参数: ' + Object.keys(tool.jsonSchema.properties as Record<string, unknown>).join(', ')
        : '';
      logger.warn('tool args dropped unknown keys', { tool: name, dropped: droppedKeys });
      // 不阻止执行，但在输出中注入警告，让模型知道参数传错了
      const warning = `[参数警告] 以下参数被忽略（不属于工具 ${name}）: ${droppedKeys.join(', ')}${validHint}。请检查工具名称与参数是否匹配。\n`;
      // 延迟到执行后拼接，这里先存到 ctx 上
      (ctx as ToolContext & { _argWarning?: string })._argWarning = warning;
    }

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

    // 如果有参数警告，注入到输出开头（让模型知道自己参数传错了）
    const argWarning = (ctx as ToolContext & { _argWarning?: string })._argWarning;
    if (argWarning) {
      result = {
        ...result,
        output: argWarning + (result.output || ''),
      };
    }

    // P2-1：PostToolUse / PostEdit hook（记录结果；编辑成功时对文件触发）
    if (ctx.security.hooks?.length) {
      const postCtx = { ...hookCtx, ok: result.ok };
      await runHooks(ctx.security.hooks, 'PostToolUse', postCtx);
      if (result.ok && hookCtx.path) {
        await runHooks(ctx.security.hooks, 'PostEdit', postCtx);
      }
    }

    // P2-1：进程内技能 hooks（如 pua-ext 压力旁白注入），在 shell hooks 后执行
    const skillHookResult = await runSkillHooks('PostToolUse', { ...hookCtx, ok: result.ok });
    if (skillHookResult.outputInjection) {
      result = {
        ...result,
        output: (result.output || '') + skillHookResult.outputInjection,
      };
    }

    return result;
  }
}

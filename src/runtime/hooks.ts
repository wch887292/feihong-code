/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2-1 hooks 确定性控制（对齐 Claude Code hooks）：
 *  - PreToolUse   工具执行前触发；命令退出码非 0 → 阻止该工具调用（硬拦截）
 *  - PostToolUse  工具执行后触发（可跑 linter/格式化等，结果只记录不阻断）
 *  - PostEdit     文件编辑工具（write/edit）成功落盘后触发（只针对被改文件）
 *  - SessionStart 会话开始时触发（预留，CLI 装配处调用）
 *
 * 配置来源：FH_HOOKS 环境变量（JSON 数组）或配置文件 hooks 字段。
 * 占位符：{cwd} {tool} {path} {runId} {ok}（PostToolUse 的 ok=1/0）。
 * 零上下文成本：hook 是"代码/命令"而非"指令文本"，不占 system prompt。
 */
import { runCommand } from '../tools/shell/exec';
import { logger } from '../shared/logger';

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PostEdit' | 'SessionStart';

export interface HookConfig {
  event: HookEvent;
  /** 触发的 shell 命令（支持 {cwd} {tool} {path} {runId} {ok} 占位符） */
  command: string;
  /** 仅匹配这些工具（缺省全部） */
  tools?: string[];
  /** PostEdit 仅匹配这些文件路径片段（缺省全部） */
  paths?: string[];
  /** 超时（ms，缺省 10000） */
  timeoutMs?: number;
}

export interface HookCtx {
  cwd: string;
  runId: string;
  tool?: string;
  path?: string;
  /** PostToolUse：工具执行结果（1=成功 0=失败） */
  ok?: boolean;
}

export interface HookRunResult {
  blocked: boolean;
  reason?: string;
}

/** 解析 FH_HOOKS / 配置文件 hooks（非法 JSON 返回空并告警） */
export function parseHooks(raw?: string | null): HookConfig[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (h): h is HookConfig =>
        !!h && typeof h === 'object' && typeof h.command === 'string' && typeof h.event === 'string',
    );
  } catch {
    logger.warn('FH_HOOKS 不是合法 JSON，已忽略');
    return [];
  }
}

/** 替换占位符 */
function substitute(cmd: string, ctx: HookCtx): string {
  return cmd
    .replace(/\{cwd\}/g, ctx.cwd)
    .replace(/\{runId\}/g, ctx.runId)
    .replace(/\{tool\}/g, ctx.tool ?? '')
    .replace(/\{path\}/g, ctx.path ?? '')
    .replace(/\{ok\}/g, ctx.ok === undefined ? '' : ctx.ok ? '1' : '0');
}

function hookMatches(hook: HookConfig, ctx: HookCtx): boolean {
  if (hook.tools && hook.tools.length > 0 && ctx.tool && !hook.tools.includes(ctx.tool)) return false;
  if (hook.paths && hook.paths.length > 0 && ctx.path && !hook.paths.some((p) => ctx.path!.includes(p))) return false;
  return true;
}

/**
 * 运行事件相关 hooks，返回是否应阻止（仅 PreToolUse 有阻断语义）。
 * 单个 hook 命令失败不影响其他 hook 执行。
 */
export async function runHooks(
  hooks: HookConfig[],
  event: HookEvent,
  ctx: HookCtx,
): Promise<HookRunResult> {
  const matched = hooks.filter((h) => h.event === event && hookMatches(h, ctx));
  for (const hook of matched) {
    const cmd = substitute(hook.command, ctx);
    try {
      const res = await runCommand(cmd, ctx.cwd, hook.timeoutMs ?? 10000);
      if (event === 'PreToolUse' && res.code !== 0) {
        logger.warn('hook blocked tool', { tool: ctx.tool, command: cmd, code: res.code });
        return {
          blocked: true,
          reason: `PreToolUse hook 拒绝（exit ${res.code}）: ${(res.stderr || res.stdout).slice(0, 200)}`,
        };
      }
    } catch (e) {
      logger.warn('hook execution failed', {
        event,
        command: cmd,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { blocked: false };
}

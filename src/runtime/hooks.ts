/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2-1 hooks 确定性控制（对齐 Claude Code hooks）：
 *  - PreToolUse   工具执行前触发；命令退出码非 0 → 阻止该工具调用（硬拦截）
 *  - PostToolUse  工具执行后触发（可跑 linter/格式化等，结果只记录不阻断）
 *  - PostEdit     文件编辑工具（write/edit）成功落盘后触发（只针对被改文件）
 *  - SessionStart 会话开始时触发（CLI 装配处调用，可注入系统提示）
 *  - PreCompact   上下文压缩前触发（可持久化状态、保存失败计数等）
 *
 * 两种 hook 形态并存：
 *  1. Shell 命令式 hooks（FH_HOOKS 环境变量 / 配置文件）：外部工具集成，零上下文成本
 *  2. 进程内技能 hooks（registerSkillHook）：技能级回调，可读写状态、注入系统提示/工具输出
 *
 * 占位符：{cwd} {tool} {path} {runId} {ok}（PostToolUse 的 ok=1/0）。
 */
import { runCommand } from '../tools/shell/exec';
import { logger } from '../shared/logger';

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PostEdit' | 'SessionStart' | 'PreCompact';

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
  /** PreCompact：当前消息数 */
  messageCount?: number;
  /** PreCompact：保留的最近轮数 */
  preservedCount?: number;
  /** PreCompact：压缩焦点（当前任务/文件） */
  focus?: string;
  /** SessionStart：用户目标 */
  goal?: string;
}

export interface HookRunResult {
  blocked: boolean;
  reason?: string;
}

/* ===================== 进程内技能 hooks 注册表 ===================== */

/**
 * 进程内技能 hook 的返回值：
 *  - systemInjection：要注入到系统提示的文本（SessionStart 用）
 *  - outputInjection：要注入到工具输出的文本（PostToolUse 用，追加到 output 开头）
 *  - state：任意状态更新（由 hook 自身管理，框架不解释）
 */
export interface SkillHookResult {
  systemInjection?: string;
  outputInjection?: string;
  state?: unknown;
}

/** 进程内技能 hook 处理器 */
export type SkillHookHandler = (ctx: HookCtx) => Promise<SkillHookResult | void> | SkillHookResult | void;

interface SkillHookEntry {
  event: HookEvent;
  handler: SkillHookHandler;
  /** 技能名（用于日志/调试） */
  skill: string;
}

/** 进程内技能 hooks 注册表（单例） */
const skillHooks: SkillHookEntry[] = [];

/**
 * 注册进程内技能 hook。
 * 与 shell 命令式 hooks 并存：shell hooks 先执行（可阻断），进程内 hooks 后执行（注入内容）。
 *
 * @param event 触发事件
 * @param handler hook 处理器
 * @param skill 技能名（用于日志）
 */
export function registerSkillHook(event: HookEvent, handler: SkillHookHandler, skill = 'unknown'): void {
  skillHooks.push({ event, handler, skill });
  logger.info('skill hook registered', { event, skill, total: skillHooks.length });
}

/** 移除指定技能的所有 hooks（用于测试/卸载） */
export function unregisterSkillHooks(skill: string): void {
  const before = skillHooks.length;
  for (let i = skillHooks.length - 1; i >= 0; i--) {
    if (skillHooks[i].skill === skill) skillHooks.splice(i, 1);
  }
  if (before !== skillHooks.length) {
    logger.info('skill hooks unregistered', { skill, removed: before - skillHooks.length });
  }
}

/**
 * 执行进程内技能 hooks，返回合并后的注入内容。
 * 多个 hook 的注入按注册顺序拼接。
 */
export async function runSkillHooks(event: HookEvent, ctx: HookCtx): Promise<SkillHookResult> {
  const matched = skillHooks.filter((h) => h.event === event);
  if (matched.length === 0) return {};

  const systemParts: string[] = [];
  const outputParts: string[] = [];

  for (const entry of matched) {
    try {
      const result = await entry.handler(ctx);
      if (result?.systemInjection) systemParts.push(result.systemInjection);
      if (result?.outputInjection) outputParts.push(result.outputInjection);
    } catch (e) {
      logger.warn('skill hook execution failed', {
        event,
        skill: entry.skill,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    systemInjection: systemParts.length > 0 ? systemParts.join('\n') : undefined,
    outputInjection: outputParts.length > 0 ? outputParts.join('\n') : undefined,
  };
}

/** 获取已注册的技能 hooks 数量（用于调试/测试） */
export function getSkillHookCount(): number {
  return skillHooks.length;
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

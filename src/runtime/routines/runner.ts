/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ③ 自动化任务真实执行（v8.6.3）：
 * 真实 runner —— 把 RoutineScheduler 的抽象动作落成「会真正执行的任务」。
 *
 *   noop  → 直接跳过（保持占位/默认成功）
 *   command → run_shell 经三级规则引擎判定：
 *             deny（红线）→ 硬拦截；allow → 直接执行；
 *             ask → 有审批收件箱则提交挂起（autonomous 模式则直接执行）
 *   goal  → AI 目标型任务，动作串 `automation:<goal>` 过同套三级门控后由 executeTask 真实执行
 *
 * 安全基座：三级规则引擎（security/rules-engine）+ 审批收件箱（security/approval-inbox）
 * 红线（改密码/转账/永久删除/外发）任何用户规则不可放行，命中即 deny。
 * ask 判定：requireApproval=true（CLI 交互/人工在环）时提交收件箱挂起；autonomous=false（serve 7x24）时直接执行。
 */
import { runCommand } from '../../tools/shell/exec';
import { executeTask } from '../../core/task-executor';
import { evaluateRules, type UserRule, type RuleDecision } from '../../security/rules-engine';
import { ApprovalInbox } from '../../security/approval-inbox';
import type { RoutineRunner } from './scheduler';
import type { ComputeTier } from '../../shared/types';

export interface RoutineRunnerOptions {
  /** 家目录（审批收件箱落盘目录推导用） */
  homeDir: string;
  /** 任务执行工作区（goal/command 的 cwd），缺省 process.cwd() */
  workspaceDir?: string;
  /** 三级规则引擎用户规则集（红线由引擎内置，无需传入） */
  rules?: UserRule[];
  /** 审批收件箱（ask 判定挂起用）；未传则 ask 默认按 autonomous 直接执行 */
  inbox?: ApprovalInbox;
  /** 是否要求人工审批：true 时 ask 动作提交收件箱并挂起；false 时（云端 7x24）直接执行 */
  requireApproval?: boolean;
  /** 默认算力档位（goal 型未指定 tier 时采用） */
  defaultTier?: ComputeTier;
}

const OUTPUT_LIMIT = 800;

function truncate(s: string | undefined, limit = OUTPUT_LIMIT): string | undefined {
  if (!s) return s;
  return s.length > limit ? s.slice(0, limit) + `…(截断 ${s.length - limit} 字)` : s;
}

/**
 * 构造真实 runner。
 * @returns RoutineRunner，供 RoutineScheduler({ runner }) 注入。
 */
export function createRoutineRunner(opts: RoutineRunnerOptions): RoutineRunner {
  const rules = opts.rules ?? [];
  const cwd = opts.workspaceDir || process.cwd();

  return async (def, trigger) => {
    const action = def.action;

    // 1) noop：占位/默认成功
    if (action.type === 'noop') {
      return { ok: true, output: 'noop 跳过' };
    }

    // 2) command：run_shell 真实执行（经三级门控）
    if (action.type === 'command') {
      const label = `run_shell:${action.command}`;
      const decision: RuleDecision = evaluateRules(rules, label);
      if (decision.effect === 'deny') {
        return { ok: false, error: `🚫 被三级规则引擎拦截：${decision.reason}` };
      }
      if (decision.effect === 'ask') {
        if (opts.requireApproval === true && opts.inbox) {
          opts.inbox.submit(label, `routine(${def.id}/${trigger}) 命中默认 ask，已挂起待审批`);
          return { ok: true, output: '已提交审批收件箱，等待人工批准（挂起未执行）' };
        }
        // autonomous（serve 7x24 / requireApproval=false）：直接执行
      }
      try {
        const r = await runCommand(action.command, cwd, 120_000);
        const ok = r.code === 0;
        return {
          ok,
          output: truncate(r.stdout),
          error: ok ? undefined : truncate(`${r.stderr || '命令非零退出'} (code=${r.code})`),
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    // 3) goal：AI 目标型任务真实执行（经三级门控）
    if (action.type === 'goal') {
      const label = `automation:${action.goal}`;
      const decision: RuleDecision = evaluateRules(rules, label);
      if (decision.effect === 'deny') {
        return { ok: false, error: `🚫 被三级规则引擎拦截：${decision.reason}` };
      }
      if (decision.effect === 'ask' && opts.requireApproval === true && opts.inbox) {
        opts.inbox.submit(label, `routine(${def.id}/${trigger}) 命中默认 ask，已挂起待审批`);
        return { ok: true, output: '已提交审批收件箱，等待人工批准（挂起未执行）' };
      }
      // allow 或 autonomous-ask：真实执行
      try {
        const res = await executeTask(action.goal, {
          tier: action.tier ?? opts.defaultTier,
          workspaceDir: cwd,
          // 云端 7x24 无交互审批通道：关闭编排器内部交互审批，由外层三级规则引擎统一门控
          security: { requireApproval: false },
        });
        return {
          ok: res.ok,
          output: truncate(res.finalAnswer),
          error: res.ok ? undefined : 'AI 任务未返回成功状态',
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    return { ok: false, error: `未知动作类型：${(action as { type: string }).type}` };
  };
}

/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M4 守卫：把「策略判定 → 人工审批 → 审计留痕」串成工具执行前置钩子。
 *
 * 设计原则：
 *  - 向后兼容：未注入 guard 时，工具链行为与 M3 完全一致（社区版无感）。
 *  - 审计优先：审计写入失败 = 拒绝执行（宁可不做，不可无痕）。
 *  - deny 优先：策略拒绝的动作，任何审批通道都无法放行。
 */
import type { ToolGuard, ToolGuardVerdict } from '../tools/tool.interface';
import type { AuditLog } from './audit';
import { evaluate, type Policy } from './policy';
import type { TenantContext } from './tenant';
import { logger } from '../shared/logger';

export interface EnterpriseGuardDeps {
  tenant: TenantContext;
  policy: Policy;
  audit: AuditLog;
  runId: string;
  cwd: string;
  shellAllowlist: string[];
  /** 人工审批通道（TTY 交互 / 白名单兜底）；缺省视为拒绝 */
  approve?: (action: string) => Promise<boolean>;
}

/** 从入参提炼一段可读的 resource 描述，便于审计检索 */
function describe(tool: string, args: Record<string, unknown>): string {
  if (tool === 'run_shell') return String(args.command ?? args.cmd ?? '');
  const p = args.path ?? args.dir ?? args.file ?? args.target;
  if (typeof p === 'string') return p;
  return JSON.stringify(args).slice(0, 200);
}

export function createEnterpriseGuard(deps: EnterpriseGuardDeps): ToolGuard {
  const { tenant, policy, audit, runId, cwd, shellAllowlist, approve } = deps;

  const write = (
    action: string,
    resource: string,
    decision: 'allow' | 'deny' | 'approved' | 'rejected',
    reason: string,
  ): void => {
    audit.record({
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      role: tenant.role,
      runId,
      action,
      resource,
      decision,
      reason,
    });
  };

  return {
    async check(tool: string, args: Record<string, unknown>): Promise<ToolGuardVerdict> {
      const resource = describe(tool, args);
      const action = `tool:${tool}`;
      const verdict = evaluate(policy, { role: tenant.role, tool, args, cwd, shellAllowlist });

      if (verdict.effect === 'deny') {
        write(action, resource, 'deny', `${verdict.rule} — ${verdict.reason}`);
        logger.warn('策略拒绝工具调用', { tool, rule: verdict.rule });
        return { allowed: false, reason: `[策略拒绝/${verdict.rule}] ${verdict.reason}` };
      }

      if (verdict.effect === 'approval') {
        if (!approve) {
          write(action, resource, 'rejected', '无可用审批通道');
          return {
            allowed: false,
            reason: `[需审批] ${verdict.reason}，但当前无审批通道（配置 FH_SHELL_ALLOW 或在 TTY 下运行）`,
          };
        }
        const ok = await approve(`${tool}: ${resource}`);
        write(action, resource, ok ? 'approved' : 'rejected', verdict.reason);
        return ok
          ? { allowed: true, reason: '人工审批通过' }
          : { allowed: false, reason: '[审批拒绝] 用户未批准该操作' };
      }

      write(action, resource, 'allow', `${verdict.rule} — ${verdict.reason}`);
      return { allowed: true, reason: verdict.reason };
    },
  };
}

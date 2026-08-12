/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M4 企业能力聚合装配：租户 → 策略 → 审计 → 配额 → 守卫。
 * CLI 只需要调用 createEnterpriseRuntime() 一次即可拿到全部企业上下文。
 */
import { resolveHomeDir } from '../shared/config';
import { AppError } from '../shared/errors';
import { AuditLog } from './audit';
import { loadPolicy, type Policy } from './policy';
import { checkQuota, type QuotaStatus } from './quota';
import { resolveTenantContext, type TenantContext } from './tenant';
import { createEnterpriseGuard } from './guard';
import type { ToolGuard } from '../tools/tool.interface';

export * from './tenant';
export * from './policy';
export * from './audit';
export * from './quota';
export * from './guard';

export interface EnterpriseRuntime {
  tenant: TenantContext;
  policy: Policy;
  audit: AuditLog;
  quota: QuotaStatus;
  /** 当前角色的单任务成本上限（0 = 不限） */
  maxCostUsd: number;
  makeGuard(opts: {
    runId: string;
    cwd: string;
    shellAllowlist: string[];
    approve?: (action: string) => Promise<boolean>;
  }): ToolGuard;
}

/**
 * 是否启用企业模式。
 * 默认启用（安全基线应当默认在位）；显式 FH_ENTERPRISE=false 可关闭，退化为 M3 行为。
 */
export function isEnterpriseEnabled(): boolean {
  return process.env.FH_ENTERPRISE !== 'false';
}

export function createEnterpriseRuntime(baseHome = resolveHomeDir()): EnterpriseRuntime {
  const tenant = resolveTenantContext(baseHome);
  const policy = loadPolicy(baseHome, tenant.root);
  const audit = new AuditLog(tenant.auditDir);
  const quota = checkQuota(tenant, policy);
  const maxCostUsd = policy.roles[tenant.role].maxCostUsd;

  return {
    tenant,
    policy,
    audit,
    quota,
    maxCostUsd,
    makeGuard: ({ runId, cwd, shellAllowlist, approve }) =>
      createEnterpriseGuard({ tenant, policy, audit, runId, cwd, shellAllowlist, approve }),
  };
}

/** 配额超限时抛出（fail-fast，任务启动前拦截，不产生任何模型费用） */
export function assertQuota(rt: EnterpriseRuntime): void {
  // M14 修复：每次实时复核配额，而非依赖运行时创建时的快照。
  // 否则会话内累计成本越过预算后，rt.quota.exceeded 仍为 false，冻结失效。
  const live = checkQuota(rt.tenant, rt.policy);
  rt.quota = live;
  if (!live.exceeded) return;
  rt.audit.record({
    tenantId: rt.tenant.tenantId,
    userId: rt.tenant.userId,
    role: rt.tenant.role,
    runId: '-',
    action: 'quota:block',
    resource: `today=$${rt.quota.usedUsd.toFixed(6)} limit=$${rt.quota.limitUsd}`,
    decision: 'deny',
    reason: '租户日成本预算已耗尽',
  });
  throw new AppError(
    `租户 ${rt.tenant.tenantId} 今日成本 $${rt.quota.usedUsd.toFixed(6)} 已达上限 $${rt.quota.limitUsd}，任务被拒绝。` +
      `（调整 FH_TENANT_BUDGET_USD 或 policy.json 的 tenantDailyBudgetUsd）`,
    'QUOTA_EXCEEDED',
    429,
  );
}

/** 渲染当前身份（fhcode whoami） */
export function renderWhoami(rt: EnterpriseRuntime): string {
  return [
    `租户 (tenant): ${rt.tenant.tenantId}`,
    `用户 (user)  : ${rt.tenant.userId}`,
    `角色 (role)  : ${rt.tenant.role}`,
    `隔离目录     : ${rt.tenant.root}`,
    `  会话       : ${rt.tenant.sessionDir}`,
    `  审计       : ${rt.tenant.auditDir}`,
    `  目标       : ${rt.tenant.goalDir}`,
    `单任务上限   : ${rt.maxCostUsd > 0 ? `$${rt.maxCostUsd}` : '不限'}`,
    `今日已用     : $${rt.quota.usedUsd.toFixed(6)}${rt.quota.limitUsd > 0 ? ` / $${rt.quota.limitUsd}` : ' （日预算不限）'}`,
    `审计记录数   : ${rt.audit.count}`,
    `企业模式     : ${isEnterpriseEnabled() ? '开启' : '关闭 (FH_ENTERPRISE=false)'}`,
  ].join('\n');
}

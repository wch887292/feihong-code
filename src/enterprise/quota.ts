/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M4 配额：租户级日成本预算。
 * 统计口径 = 该租户 sessions 目录下 updatedAt 为「今天(UTC)」的检查点 costUsd 之和。
 * 超限则在任务启动前拒绝（fail-fast，不产生任何模型调用费用）。
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { TenantContext } from './tenant';
import type { Policy } from './policy';

export interface QuotaStatus {
  usedUsd: number;
  limitUsd: number;
  exceeded: boolean;
  sessionsToday: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 统计租户当日已用成本 */
export function tenantSpendToday(sessionDir: string, day = todayUtc()): {
  usedUsd: number;
  sessions: number;
} {
  if (!existsSync(sessionDir)) return { usedUsd: 0, sessions: 0 };
  let usedUsd = 0;
  let sessions = 0;
  for (const f of readdirSync(sessionDir)) {
    if (!f.endsWith('.session.json')) continue;
    try {
      const cp: { updatedAt?: string; costUsd?: number } = JSON.parse(readFileSync(join(sessionDir, f), 'utf8'));
      if (!cp.updatedAt?.startsWith(day)) continue;
      sessions++;
      usedUsd += Number(cp.costUsd ?? 0);
    } catch {
      /* 跳过损坏文件 */
    }
  }
  return { usedUsd, sessions };
}

/** 环境变量 FH_TENANT_BUDGET_USD 优先于策略中的 tenantDailyBudgetUsd */
export function resolveDailyLimit(policy: Policy): number {
  const env = Number(process.env.FH_TENANT_BUDGET_USD ?? NaN);
  if (Number.isFinite(env) && env >= 0) return env;
  return policy.tenantDailyBudgetUsd;
}

export function checkQuota(ctx: TenantContext, policy: Policy): QuotaStatus {
  const limitUsd = resolveDailyLimit(policy);
  const { usedUsd, sessions } = tenantSpendToday(ctx.sessionDir);
  return {
    usedUsd,
    limitUsd,
    sessionsToday: sessions,
    exceeded: limitUsd > 0 && usedUsd >= limitUsd,
  };
}

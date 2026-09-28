/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 企业管理命令（whoami / policy / audit / tenants，M4）
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { t } from '../../shared/i18n';
import { AppError } from '../../shared/errors';
import { renderWhoami, renderPolicy, readAudit, verifyAudit, listTenants, type EnterpriseRuntime } from '../../enterprise';
import { getEnterprise } from '../../core/task-executor';

function requireEnterprise(): EnterpriseRuntime {
  const rt = getEnterprise();
  if (!rt) {
    throw new AppError(
      t('err.enterpriseDisabled'),
      'ENTERPRISE_DISABLED',
      400,
    );
  }
  return rt;
}

/** fhcode whoami：展示当前租户/用户/角色/隔离目录/配额 */
export function runWhoami(): void {
  console.log(renderWhoami(requireEnterprise()));
}

/** fhcode policy：展示生效策略与角色矩阵 */
export function runPolicyCmd(): void {
  const rt = requireEnterprise();
  console.log(renderPolicy(rt.policy, rt.tenant.role));
}

/** fhcode audit [--limit N]：查看审计记录（默认最近 20 条） */
export function runAudit(limit = 20): void {
  const rt = requireEnterprise();
  const all = readAudit(rt.tenant.auditDir);
  if (all.length === 0) {
    console.log(t('audit.empty', { tenant: rt.tenant.tenantId, dir: rt.tenant.auditDir }));
    return;
  }
  const rows = all.slice(-limit);
  console.log(t('audit.header', { rows: rows.length, all: all.length, tenant: rt.tenant.tenantId }));
  for (const r of rows) {
    console.log(
      t('audit.row', {
        seq: String(r.seq).padStart(4, '0'),
        ts: r.ts,
        decision: r.decision.toUpperCase(),
        action: r.action,
        user: r.userId,
        role: r.role,
        run: String(r.runId).slice(0, 8),
      }),
    );
    console.log(t('audit.resource', { resource: r.resource }));
    if (r.reason) console.log(t('audit.reason', { reason: r.reason }));
  }
  console.log(t('audit.chainTail', { hash: all[all.length - 1].hash.slice(0, 16) }));
}

/** fhcode audit verify：校验哈希链完整性 */
export function runAuditVerify(): void {
  const rt = requireEnterprise();
  const res = verifyAudit(rt.tenant.auditDir);
  if (res.ok) {
    console.log(t('audit.verifyOk', { total: res.total }));
    return;
  }
  console.log(t('audit.verifyFail', { total: res.total, brokenAt: res.brokenAt ?? 0 }));
  console.log(`   ${res.detail}`);
  process.exitCode = 2;
}

/** fhcode tenants：列出全部租户与用量 */
export function runTenants(): void {
  requireEnterprise();
  const list = listTenants();
  if (list.length === 0) {
    console.log(t('tenants.empty'));
    return;
  }
  console.log(t('tenants.header'));
  console.log(t('tenants.tableHeader'));
  for (const tenant of list) {
    console.log(
      t('tenants.row', {
        id: tenant.tenantId.padEnd(20),
        sessions: String(tenant.sessions).padStart(5),
        cost: '$' + tenant.costUsd.toFixed(6).padStart(10),
        audit: String(tenant.auditRecords).padStart(7),
        last: tenant.lastActiveAt,
      }),
    );
  }
}

/* ===================== M6：自我进化 ===================== */

/** 探测 baseURL 连通性：任何 HTTP 响应（含 4xx/5xx）都视为可达，连接失败视为不可达 */

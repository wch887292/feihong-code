/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 会话管理命令（resume / diff / rollback，M3）
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { t } from '../../shared/i18n';
import { loadConfig } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { ModelRouter } from '../../models/model-router';
import { ScriptedMockProvider } from '../../models/providers/mock.provider';
import { createDefaultRegistry } from '../../tools';
import { EventLog } from '../../runtime/event-log';
import { SessionStore } from '../../runtime/session-store';
import { saveCheckpoint, loadCheckpoint, listCheckpoints, updateStatus, type SessionCheckpoint } from '../../runtime/session-persist';
import { gitDiff, gitRollback } from '../../runtime/git';
import { assertQuota } from '../../enterprise';
import { Orchestrator, type OrchestratorSecurity } from '../../agent/orchestrator';
import { getEnterprise, isOfflineByDefault, getSessionHome, buildDemoSteps, interactiveApprover, defaultApproverFor, resolveMaxCostUsd } from '../../core/task-executor';

async function resolveCheckpoint(home: string, id: string): Promise<SessionCheckpoint> {
  const exact = await loadCheckpoint(home, id);
  if (exact) return exact;
  const all = await listCheckpoints(home);
  const matches = all.filter((c) => c.runId.startsWith(id));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new AppError(`会话前缀 ${id} 匹配到多个会话，请使用完整 runId`, 'SESSION_AMBIGUOUS', 400);
  }
  throw new AppError(`未找到会话检查点: ${id}`, 'SESSION_NOT_FOUND', 404);
}

/** 列出历史会话检查点 */
export async function runSessions(): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  const cps = await listCheckpoints(home);
  if (cps.length === 0) {
    console.log(t('run.noSessions'));
    return;
  }
  console.log(t('run.sessionList', { mode: offline ? t('mode.offline') : t('mode.live'), home }));
  for (const cp of cps) {
    console.log(
      t('run.sessionItem', {
        id: cp.runId.slice(0, 8),
        status: cp.status,
        iter: cp.iterations,
        cost: '$' + cp.costUsd.toFixed(6),
        files: cp.touchedFiles.length,
        time: cp.updatedAt,
      }),
    );
    console.log(t('run.sessionGoal', { goal: cp.goal }));
  }
}

/** 从检查点恢复中断的会话并续跑 */
export async function runResume(runId: string): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  const cp = await resolveCheckpoint(home, runId);
  if (cp.status === 'done') {
    console.log(t('run.resumeDone', { id: runId.slice(0, 8) }));
    return;
  }
  console.log(t('run.resumeStart', { id: runId.slice(0, 8), status: cp.status, iter: cp.iterations }));

  const security: OrchestratorSecurity = { shellAllowlist: [], requireApproval: true };
  let router: ModelRouter;
  if (offline) {
    router = new ModelRouter([new ScriptedMockProvider(buildDemoSteps())], 'cost', 0);
  } else {
    const cfg = loadConfig();
    router = ModelRouter.fromConfig(cfg);
    security.shellAllowlist = cfg.security.shellAllowlist;
    security.requireApproval = cfg.security.requireApproval;
  }

  const tools = createDefaultRegistry();
  // 用完整 runId 建日志（入参可能只是 8 位前缀），保证事件与检查点同名可对齐
  const eventLog = new EventLog(cp.runId, home);
  const session = SessionStore.restore(cp);
  const approve = process.stdin.isTTY ? interactiveApprover() : defaultApproverFor(security);

  const rt = getEnterprise();
  if (rt) assertQuota(rt);
  const guard = rt
    ? rt.makeGuard({
        runId: cp.runId,
        cwd: cp.cwd,
        shellAllowlist: security.shellAllowlist,
        approve,
      })
    : undefined;

  const orchestrator = new Orchestrator({
    router,
    tools,
    eventLog,
    session,
    cwd: cp.cwd,
    security,
    approve,
    guard,
    maxCostUsd: resolveMaxCostUsd(rt?.maxCostUsd),
    persist: (c: SessionCheckpoint) => saveCheckpoint(home, c),
  });

  const result = await orchestrator.run(cp.goal, {
    messages: cp.messages,
    iterations: cp.iterations,
    costUsd: cp.costUsd,
    touchedFiles: cp.touchedFiles,
  });

  if (result.finalAnswer.trim()) {
    console.log('');
    console.log(result.finalAnswer.trim());
    console.log('');
  }
}

/** 展示会话作用域的 diff（缺省为本工作区全量 diff） */
export async function runDiff(id?: string): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  if (id) {
    const cp = await resolveCheckpoint(home, id);
    console.log(t('run.diffSession', { id: id.slice(0, 8), cwd: cp.cwd }));
    console.log(await gitDiff(cp.cwd, cp.touchedFiles));
  } else {
    console.log(t('run.diffCwd', { cwd: process.cwd() }));
    console.log(await gitDiff(process.cwd()));
  }
}

/** 回滚会话 touchedFiles（破坏性，需 --yes） */
export async function runRollback(id: string, yes: boolean): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  const cp = await resolveCheckpoint(home, id);

  // M4：回滚是破坏性动作，viewer 角色一律禁止，且无论成败都留痕
  const rt = getEnterprise();
  if (rt) {
    const allowed = rt.tenant.role !== 'viewer';
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId: cp.runId,
      action: 'session:rollback',
      resource: cp.touchedFiles.join(', ') || '(无文件)',
      decision: allowed ? (yes ? 'allow' : 'rejected') : 'deny',
      reason: allowed ? (yes ? '已确认 --yes' : '缺少 --yes 确认') : '角色 viewer 无回滚权限',
    });
    if (!allowed) {
      throw new AppError('角色 viewer 无权执行回滚操作', 'RBAC_DENIED', 403);
    }
  }

  console.log(t('run.rollbackStart', { id: id.slice(0, 8), n: cp.touchedFiles.length, cwd: cp.cwd }));
  const res = await gitRollback(cp.cwd, cp.touchedFiles, { yes });
  if (res.reverted.length) console.log(t('run.rollbackReverted', { files: res.reverted.join(', ') }));
  if (res.removed.length) console.log(t('run.rollbackRemoved', { files: res.removed.join(', ') }));
  if (res.errors.length) console.log(t('run.rollbackNote', { errors: res.errors.join('; ') }));
  if (yes) await updateStatus(home, id, 'done');
}

/* ===================== M4：企业管理命令 ===================== */


/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 运行装配：把模型路由、工具、运行时、编排器组装成一次任务执行。
 * 无 API key 时自动进入离线模式（ScriptedMockProvider 驱动闭环验证）。
 *
 * M3 增强：会话检查点持久化 + resume/diff/rollback 管理命令 + 交互式审批。
 */
import { randomUUID } from 'crypto';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, dirname } from 'path';
import { createInterface } from 'readline';
import { setRunId, logger } from '../shared/logger';
import { loadConfig } from '../shared/config';
import { AppError } from '../shared/errors';
import { ModelRouter } from '../models/model-router';
import { ScriptedMockProvider, type MockStep } from '../models/providers/mock.provider';
import { createDefaultRegistry } from '../tools';
import { runCommand } from '../tools/shell/exec';
import { EventLog } from '../runtime/event-log';
import { SessionStore } from '../runtime/session-store';
import {
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  updateStatus,
  type SessionCheckpoint,
} from '../runtime/session-persist';
import { gitDiff, gitRollback } from '../runtime/git';
import {
  createEnterpriseRuntime,
  isEnterpriseEnabled,
  assertQuota,
  renderWhoami,
  renderPolicy,
  readAudit,
  verifyAudit,
  listTenants,
  type EnterpriseRuntime,
} from '../enterprise';
import { startWebServer } from '../web/server';
import { Orchestrator, type OrchestratorSecurity } from '../agent/orchestrator';
import { runParallel, defaultParallelMock } from '../agent/parallel-orchestrator';
import { runPlan } from '../skills/plan';
import { runGrill } from '../skills/grill';
import { decomposeGoalToGoal, saveGoal, renderGoal } from '../skills/goal';
import { listExperiences, type Experience } from '../agent/experience';
import { createCodeWriter } from '../agent/code-writer';
import { createQualityGate } from '../agent/quality-gate';
import { createSelfImprover } from '../agent/self-improver';

export interface RunOptions {
  offline?: boolean;
  approve?: (action: string) => Promise<boolean>;
}

/** 离线演示脚本：写文件 → 总结，跑通完整链路 */
function buildDemoSteps(): MockStep[] {
  return [
    {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'write_file',
            arguments: {
              path: 'demo-output.txt',
              content:
                '飞虹 Code 离线闭环验证成功。\n需求 → 模型 → 工具执行 → 结果回填 → 总结，全程无需任何 API key。\n',
            },
          },
        ],
      },
    },
    {
      message: {
        role: 'assistant',
        content:
          '已完成：在工作区写入 demo-output.txt，内容为离线闭环验证成功的确认文本。' +
          '本次任务在未配置任何大模型的情况下，跑通了「模型请求 → 工具执行 → 结果回填 → 总结」的完整链路，' +
          '验证 Agent 编排、工具系统、运行时事件日志均已就绪。配置 FH_PROVIDERS 后即可接入真实模型。',
      },
    },
  ];
}

/* ===================== M4：企业运行时（惰性单例） ===================== */

let enterpriseRt: EnterpriseRuntime | null = null;

/** 获取企业运行时（租户/策略/审计/配额）。FH_ENTERPRISE=false 时返回 null（退化为 M3 行为） */
export function getEnterprise(): EnterpriseRuntime | null {
  if (!isEnterpriseEnabled()) return null;
  if (!enterpriseRt) enterpriseRt = createEnterpriseRuntime();
  return enterpriseRt;
}

/**
 * 会话家目录：与 EventLog 同目录，便于 list/load/resume 统一定位。
 * M4 起按租户隔离；离线且未显式设置 FH_HOME 时仍走临时目录，避免污染用户环境。
 */
function getSessionHome(offline: boolean): string {
  if (offline && !process.env.FH_HOME) return join(tmpdir(), 'fhcode-demo-logs');
  const rt = getEnterprise();
  if (rt) return rt.tenant.sessionDir;
  const home = process.env.FH_HOME ? expandHome(process.env.FH_HOME) : joinHome();
  return join(home, 'sessions');
}

export async function runGoal(goal: string, opts: RunOptions = {}): Promise<void> {
  const runId = randomUUID();
  setRunId(runId);

  const security: OrchestratorSecurity = { shellAllowlist: [], requireApproval: true };
  const offline = opts.offline ?? isOfflineByDefault();

  // M4：企业上下文（租户隔离 / RBAC / 审计 / 配额），配额超限在此 fail-fast
  const rt = getEnterprise();
  if (rt) assertQuota(rt);

  // 离线模式用临时工作区，避免污染用户目录；并 git init 以支持 diff/rollback 演示
  const cwd = offline ? mkdtempSync(join(tmpdir(), 'fhcode-demo-')) : process.cwd();
  if (offline) {
    await runCommand('git init -q', cwd).catch(() => undefined);
  }

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
  const logDir = getSessionHome(offline);
  const eventLog = new EventLog(runId, logDir);
  const session = new SessionStore(runId, cwd);

  const approve =
    opts.approve ??
    (process.stdin.isTTY ? interactiveApprover() : defaultApproverFor(security));

  const guard = rt
    ? rt.makeGuard({ runId, cwd, shellAllowlist: security.shellAllowlist, approve })
    : undefined;

  const orchestrator = new Orchestrator({
    router,
    tools,
    eventLog,
    session,
    cwd,
    security,
    approve,
    guard,
    maxCostUsd: rt?.maxCostUsd ?? 0,
    persist: (cp: SessionCheckpoint) => saveCheckpoint(logDir, cp),
  });

  if (rt) {
    console.log(
      `[飞虹 Code] 身份 tenant=${rt.tenant.tenantId} user=${rt.tenant.userId} role=${rt.tenant.role}`,
    );
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId,
      action: 'session:start',
      resource: goal,
      decision: 'info',
      reason: offline ? '离线模式' : '真实模式',
    });
  }

  console.log(`[飞虹 Code] 开始任务 (runId=${runId.slice(0, 8)}${offline ? ', 离线模式' : ''})`);
  const result = await orchestrator.run(goal);

  if (rt) {
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId,
      action: 'session:end',
      resource: `iterations=${result.iterations}`,
      decision: 'info',
      reason: `cost=$${result.costUsd.toFixed(6)}`,
    });
  }

  console.log('\n===== 执行结果 =====');
  console.log(result.finalAnswer);
  console.log(
    `\n迭代 ${result.iterations} 次 · 成本 $${result.costUsd.toFixed(6)} · 日志 ${result.logFile}`,
  );
  console.log(`会话检查点: ${join(logDir, `${runId}.session.json`)}（可用 fhcode sessions / resume / diff 管理）`);
  if (offline) {
    // 演示文件可能因策略拒绝而未生成，据实播报，避免误导
    const demoFile = join(cwd, 'demo-output.txt');
    logger.info('offline-run done', { cwd, demoFile });
    console.log(
      existsSync(demoFile)
        ? `(离线模式演示文件已写入: ${demoFile})`
        : `(离线模式未产生演示文件，工作区: ${cwd}；如为策略拒绝可用 fhcode audit 查看原因)`,
    );
  }
}

/** 默认是否离线：未配置 FH_PROVIDERS 或为空数组时离线 */
export function isOfflineByDefault(): boolean {
  const raw = process.env.FH_PROVIDERS;
  if (process.env.FH_OFFLINE === 'true') return true;
  if (!raw) return true;
  try {
    return Array.isArray(JSON.parse(raw)) && (JSON.parse(raw) as unknown[]).length === 0;
  } catch {
    return true;
  }
}

/* ===================== M2：技能与并行入口 ===================== */

/** /plan 技能：生成结构化实现计划（只读，不修改代码） */
export function runPlanSkill(goal: string): string {
  const out = runPlan(goal);
  const lines = [
    `【/plan】目标: ${out.goal}`,
    `预计并行工作树: ${out.estimatedWorktrees}`,
    `步骤:`,
    ...out.items.map((it) => `  ${it.step}. ${it.action}\n     目标: ${it.target} | 风险: ${it.risk}`),
    `备注: ${out.note}`,
  ];
  return lines.join('\n');
}

/** /grill 技能：红队式代码审查（只读） */
export function runGrillSkill(target: string): string {
  const result = runGrill(process.cwd(), target || '.');
  const lines = [
    `【/grill】${result.summary}`,
    ...result.findings.map(
      (f) => `  [${f.severity.toUpperCase()}] ${f.file}:${f.line} (${f.rule}) ${f.detail}`,
    ),
    result.findings.length === 0 ? '  未发现明显问题。' : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** /goal 技能：分解并保存高层目标（M4 起写入租户隔离目录 tenants/<id>/goals） */
export function runGoalSkill(title: string): string {
  const goal = decomposeGoalToGoal(title);
  const rt = getEnterprise();
  // saveGoal 内部会拼接 goals 子目录，这里给它租户根目录
  const home = rt
    ? dirname(rt.tenant.goalDir)
    : process.env.FH_HOME
      ? expandHome(process.env.FH_HOME)
      : joinHome();
  const file = saveGoal(goal, home);
  if (rt) {
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId: goal.id,
      action: 'skill:goal',
      resource: title,
      decision: 'info',
      reason: `保存至 ${file}`,
    });
  }
  return `【/goal】已保存\n${renderGoal(goal)}\n文件: ${file}`;
}

/** --parallel 并行多子代理执行（离线用 Mock；真实模式接入 FH_PROVIDERS 路由） */
export async function runParallelGoal(goal: string): Promise<void> {
  const offline = isOfflineByDefault();
  console.log(`[飞虹 Code] 并行模式 (offline=${offline})`);

  if (!offline) {
    const cfg = loadConfig();
    const router = ModelRouter.fromConfig(cfg);
    const security: OrchestratorSecurity = {
      shellAllowlist: cfg.security.shellAllowlist,
      requireApproval: cfg.security.requireApproval,
    };
    const result = await runParallel(goal, {
      offline: false,
      router,
      approve: defaultApproverFor(security),
    });
    console.log('\n===== 并行执行结果 =====');
    console.log(result.summary);
    console.log(`仓库根: ${result.repoRoot} · 工作树已清理: ${result.worktrees.length}`);
    return;
  }

  const result = await runParallel(goal, {
    offline: true,
    mockFor: (task) => defaultParallelMock(task),
  });
  console.log('\n===== 并行执行结果 =====');
  console.log(result.summary);
  console.log(`仓库根: ${result.repoRoot} · 工作树已清理: ${result.worktrees.length}`);
}

/* ===================== M3：会话管理（resume / diff / rollback） ===================== */

/** 按完整 id 或前缀解析会话检查点（sessions 列表默认展示 8 位前缀，便于直接引用） */
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
    console.log('（无历史会话）');
    return;
  }
  console.log(`历史会话（${offline ? '离线' : '真实'}模式，目录 ${home}）:`);
  for (const cp of cps) {
    console.log(
      `- ${cp.runId.slice(0, 8)} | ${cp.status} | 迭代${cp.iterations} | $${cp.costUsd.toFixed(6)} | 文件${cp.touchedFiles.length} | ${cp.updatedAt}`,
    );
    console.log(`    目标: ${cp.goal}`);
  }
}

/** 从检查点恢复中断的会话并续跑 */
export async function runResume(runId: string): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  const cp = await resolveCheckpoint(home, runId);
  if (cp.status === 'done') {
    console.log(`会话 ${runId.slice(0, 8)} 已完成，无需恢复。`);
    return;
  }
  console.log(`[飞虹 Code] 恢复会话 ${runId.slice(0, 8)} (状态: ${cp.status}, 已迭代 ${cp.iterations} 次)`);

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
    maxCostUsd: rt?.maxCostUsd ?? 0,
    persist: (c: SessionCheckpoint) => saveCheckpoint(home, c),
  });

  const result = await orchestrator.run(cp.goal, {
    messages: cp.messages,
    iterations: cp.iterations,
    costUsd: cp.costUsd,
    touchedFiles: cp.touchedFiles,
  });

  console.log('\n===== 恢复执行结果 =====');
  console.log(result.finalAnswer);
  console.log(`迭代 ${result.iterations} 次 · 成本 $${result.costUsd.toFixed(6)} · 日志 ${result.logFile}`);
}

/** 展示会话作用域的 diff（缺省为本工作区全量 diff） */
export async function runDiff(id?: string): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  if (id) {
    const cp = await resolveCheckpoint(home, id);
    console.log(`[飞虹 Code] 会话 ${id.slice(0, 8)} 的变更 (cwd=${cp.cwd}):`);
    console.log(await gitDiff(cp.cwd, cp.touchedFiles));
  } else {
    console.log(`[飞虹 Code] 当前目录 (${process.cwd()}) 工作区变更:`);
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

  console.log(`[飞虹 Code] 回滚会话 ${id.slice(0, 8)} 的 ${cp.touchedFiles.length} 个文件 (cwd=${cp.cwd})`);
  const res = await gitRollback(cp.cwd, cp.touchedFiles, { yes });
  if (res.reverted.length) console.log(`已还原(已跟踪): ${res.reverted.join(', ')}`);
  if (res.removed.length) console.log(`已删除(未跟踪): ${res.removed.join(', ')}`);
  if (res.errors.length) console.log(`注意: ${res.errors.join('; ')}`);
  if (yes) await updateStatus(home, id, 'done');
}

/* ===================== M4：企业管理命令 ===================== */

function requireEnterprise(): EnterpriseRuntime {
  const rt = getEnterprise();
  if (!rt) {
    throw new AppError(
      '企业模式已关闭（FH_ENTERPRISE=false），该命令不可用。',
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
    console.log(`（租户 ${rt.tenant.tenantId} 暂无审计记录，目录 ${rt.tenant.auditDir}）`);
    return;
  }
  const rows = all.slice(-limit);
  console.log(`审计记录 ${rows.length}/${all.length} 条（租户 ${rt.tenant.tenantId}）:`);
  for (const r of rows) {
    console.log(
      `#${String(r.seq).padStart(4, '0')} ${r.ts} [${r.decision.toUpperCase()}] ${r.action}` +
        ` by ${r.userId}(${r.role}) run=${String(r.runId).slice(0, 8)}`,
    );
    console.log(`      资源: ${r.resource}`);
    if (r.reason) console.log(`      理由: ${r.reason}`);
  }
  console.log(`链尾哈希: ${all[all.length - 1].hash.slice(0, 16)}…`);
}

/** fhcode audit verify：校验哈希链完整性 */
export function runAuditVerify(): void {
  const rt = requireEnterprise();
  const res = verifyAudit(rt.tenant.auditDir);
  if (res.ok) {
    console.log(`✅ 审计链完整：${res.total} 条记录，哈希链自洽未被篡改。`);
    return;
  }
  console.log(`❌ 审计链校验失败：共 ${res.total} 条，断点在第 ${res.brokenAt} 条`);
  console.log(`   ${res.detail}`);
  process.exitCode = 2;
}

/** fhcode tenants：列出全部租户与用量 */
export function runTenants(): void {
  requireEnterprise();
  const list = listTenants();
  if (list.length === 0) {
    console.log('（暂无租户数据，执行一次任务后自动创建）');
    return;
  }
  console.log('租户用量汇总:');
  console.log('  租户ID                会话数   累计成本      审计条数   最近活跃');
  for (const t of list) {
    console.log(
      `  ${t.tenantId.padEnd(20)} ${String(t.sessions).padStart(5)}   $${t.costUsd.toFixed(6).padStart(10)}   ${String(t.auditRecords).padStart(7)}   ${t.lastActiveAt}`,
    );
  }
}

/* ===================== M6：自我进化 ===================== */

/** fhcode model-stats：显示各模型性能统计 */
export function runModelStats(): void {
  const homeDir = join(homedir(), '.feihong-code');
  const statsFile = join(homeDir, 'model-stats.jsonl');
  if (!existsSync(statsFile)) {
    console.log('（暂无模型性能数据，执行任务后自动生成）');
    return;
  }
  const { ModelRouter } = require('../dist/models/model-router');
  const router = new ModelRouter([], 'cost', 0, statsFile);
  router.loadStats(homeDir).then(() => {
    const stats = router.getStats();
    if (stats.length === 0) {
      console.log('（无模型统计记录）');
      return;
    }
    console.log('模型性能统计（M6）:');
    console.log('  提供者ID          模型               总调用  成功  失败  成功率  平均延迟  总成本');
    for (const s of stats) {
      console.log(
        `  ${s.providerId.padEnd(16)} ${s.model.padEnd(18)} ${String(s.totalCalls).padStart(5)} ${String(s.successfulCalls).padStart(5)} ${String(s.failedCalls).padStart(5)} ${s.successRate.toFixed(2).padStart(6)} ${s.avgLatencyMs.toFixed(0).padStart(8)}ms $${s.totalCostUsd.toFixed(6)}`,
      );
    }
  });
}

/** fhcode experiences [路径]：列出经验库 */
export function runExperiences(path?: string): void {
  const experienceDir = path || join(require('os').homedir(), '.feihong-code', 'experiences');
  listExperiences(experienceDir).then((experiences: Experience[]) => {
    if (experiences.length === 0) {
      console.log('（暂无经验记录，完成任务后自动积累）');
      return;
    }
    console.log(`经验库 (${experiences.length} 条，来源: ${experienceDir}):`);
    console.log('  ID                              类型                 标题                    成功率  使用次数');
    for (const exp of experiences.slice(0, 10)) {
      console.log(
        `  ${exp.id.padEnd(30)} ${exp.type.padEnd(16)} ${exp.title.slice(0, 25).padEnd(25)} ${(exp.metadata.successRate * 100).toFixed(0).padStart(4)}%    ${String(exp.metadata.sessionCount).padStart(4)}`,
      );
    }
    if (experiences.length > 10) {
      console.log(`  ... 共 ${experiences.length} 条，显示前 10 条`);
    }
  });
}

/* ===================== M5：Web 控制台（serve） ===================== */

/** fhcode serve：启动 Web 管理控制台。无 FH_WEB_PORT 用 8080；无 FH_WEB_TOKEN 自动生成。 */
export function runServe(port?: number): void {
  const handle = startWebServer({ port });
  console.log(`[飞虹 Code] Web 控制台: ${handle.url}`);
  console.log(`[飞虹 Code] 访问令牌 (FH_WEB_TOKEN): ${handle.token}`);
  console.log(`[飞虹 Code] 按 Ctrl+C 停止`);
  // 注意：app.listen 保持事件循环运行，进程持续存活直到收到 SIGINT；本函数返回后 main() 结束不影响服务。
}

/* ===================== M8：自主编程能力 ===================== */

/** fhcode code-write <目标>：自主编写代码（规划→编写→测试→审查→修复） */
export function runCodeWrite(goal: string): void {
  const writer = createCodeWriter(process.cwd());
  // 离线演示：生成一个简单的工具函数
  const sampleCode = `/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 示例：M8 自主编写演示
 */
export function calculateCommission(base: number, rate: number): number {
  if (rate < 0 || rate > 1) {
    throw new Error('佣金比率必须在 0-1 之间');
  }
  return Math.round(base * rate * 100) / 100;
}

export interface CommissionPlan {
  name: string;
  baseRate: number;
  tierRates: Array<{ min: number; rate: number }>;
}

export function calculateTieredCommission(plan: CommissionPlan, amount: number): number {
  let total = 0;
  let remaining = amount;
  for (const tier of plan.tierRates.sort((a, b) => b.min - a.min)) {
    if (remaining <= 0) break;
    const tierAmount = Math.min(remaining, amount - tier.min);
    if (tierAmount > 0) {
      total += tierAmount * tier.rate;
      remaining -= tierAmount;
    }
  }
  total += Math.max(0, amount - plan.tierRates[0]?.min || 0) * plan.baseRate;
  return Math.round(total * 100) / 100;
}
`;
  writer.run(goal, sampleCode, 'generated/commission.ts');
  const result = writer.summary();
  console.log(`\n===== M8 自主编写结果 =====`);
  console.log(result.content);
  console.log(`生成文件: ${writer['filesCreated'].join(', ')}`);
}

/** fhcode quality-gate [路径]：质量门禁审查 */
export function runQualityGate(path?: string): void {
  const targetPath = path || process.cwd();
  const gate = createQualityGate();
  const results = gate.gateDirectory(targetPath, 10);
  console.log(gate.report(results));
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log(`\n⚠️ ${failed.length} 个文件未通过门禁，请修复后再提交`);
  }
}

/** fhcode self-improve：自我改进统计 */
export function runSelfImprove(): void {
  const improver = createSelfImprover();
  const records = improver.loadImprovements();
  const stats = improver.getStats();
  console.log('===== M8 自我改进统计 =====');
  console.log(`总反思次数: ${stats.totalReflections}`);
  console.log(`成功率: ${(stats.successRate * 100).toFixed(1)}%`);
  console.log(`平均耗时: ${stats.avgDurationMs.toFixed(0)}ms`);
  if (records.length > 0) {
    console.log(`\n最近改进记录:`);
    for (const rec of records.slice(-5).reverse()) {
      console.log(`  ${rec.timestamp.slice(0, 19)} | ${rec.success ? '✅' : '❌'} | 模式: ${rec.patterns.length} 条`);
      for (const imp of rec.improvements.slice(0, 3)) {
        console.log(`    → ${imp}`);
      }
    }
  } else {
    console.log('\n（暂无改进记录，完成任务后自动生成）');
  }
}

/* ===================== 审批器 ===================== */

function expandHome(p: string): string {
  if (p.startsWith('~')) return join(process.env.HOME || process.cwd(), p.slice(1));
  return p;
}

function joinHome(): string {
  return join(homedir(), '.feihong-code');
}

/**
 * 非交互默认审批器：CLI 无交互审批通道时，命中 shell 白名单的命令自动通过，
 * 其余一律拒绝（安全优先，由日志留痕）。配合 FH_SHELL_ALLOW 使用。
 */
export function defaultApproverFor(security: {
  shellAllowlist: string[];
  requireApproval: boolean;
}): (action: string) => Promise<boolean> {
  return async (action: string): Promise<boolean> => {
    if (!security.requireApproval) return true;
    const cmd = action.replace(/^run_shell:\s*/, '').trim();
    const head = cmd.split(/\s+/)[0] || '';
    if (security.shellAllowlist.includes(head)) {
      logger.info('审批自动通过（命中白名单）', { action });
      return true;
    }
    logger.warn('审批拒绝（无交互审批通道且未命中白名单）', { action });
    return false;
  };
}

/**
 * 交互式审批器：TTY 环境下向用户发起 yes/no 确认。
 * 命中白名单时直接通过；其它高危操作（shell/写文件）须经用户显式批准。
 */
export function interactiveApprover(): (action: string) => Promise<boolean> {
  return (action: string) =>
    new Promise<boolean>((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = () =>
        rl.question(`[审批] 是否允许执行: ${action}\n  输入 y/yes 允许，其他拒绝: `, (ans) => {
          rl.close();
          resolve(/^(y|yes|是)$/i.test(ans.trim()));
        });
      ask();
    });
}

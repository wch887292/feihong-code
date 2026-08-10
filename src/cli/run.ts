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
import { mkdtempSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
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
import { Orchestrator, type OrchestratorSecurity } from '../agent/orchestrator';
import { runParallel, defaultParallelMock } from '../agent/parallel-orchestrator';
import { runPlan } from '../skills/plan';
import { runGrill } from '../skills/grill';
import { decomposeGoalToGoal, saveGoal, renderGoal } from '../skills/goal';

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

/** 会话家目录：与 EventLog 同目录，便于 list/load/resume 统一定位 */
function getSessionHome(offline: boolean): string {
  if (offline) return join(tmpdir(), 'fhcode-demo-logs');
  const home = process.env.FH_HOME ? expandHome(process.env.FH_HOME) : joinHome();
  return join(home, 'sessions');
}

export async function runGoal(goal: string, opts: RunOptions = {}): Promise<void> {
  const runId = randomUUID();
  setRunId(runId);

  const security: OrchestratorSecurity = { shellAllowlist: [], requireApproval: true };
  const offline = opts.offline ?? isOfflineByDefault();

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

  const approve = opts.approve ?? (offline ? undefined : process.stdin.isTTY ? interactiveApprover() : defaultApproverFor(security));

  const orchestrator = new Orchestrator({
    router,
    tools,
    eventLog,
    session,
    cwd,
    security,
    approve,
    persist: (cp: SessionCheckpoint) => saveCheckpoint(logDir, cp),
  });

  console.log(`[飞虹 Code] 开始任务 (runId=${runId.slice(0, 8)}${offline ? ', 离线模式' : ''})`);
  const result = await orchestrator.run(goal);

  console.log('\n===== 执行结果 =====');
  console.log(result.finalAnswer);
  console.log(
    `\n迭代 ${result.iterations} 次 · 成本 $${result.costUsd.toFixed(6)} · 日志 ${result.logFile}`,
  );
  console.log(`会话检查点: ${join(logDir, `${runId}.session.json`)}（可用 fhcode sessions / resume / diff 管理）`);
  if (offline) {
    logger.info('offline-run done', { cwd, demoFile: join(cwd, 'demo-output.txt') });
    console.log(`(离线模式演示文件已写入: ${join(cwd, 'demo-output.txt')})`);
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

/** /goal 技能：分解并保存高层目标（只读，写入 ~/.feihong-code/goals） */
export function runGoalSkill(title: string): string {
  const goal = decomposeGoalToGoal(title);
  const home = process.env.FH_HOME ? expandHome(process.env.FH_HOME) : joinHome();
  const file = saveGoal(goal, home);
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
  const eventLog = new EventLog(runId, home);
  const session = SessionStore.restore(cp);
  const approve = offline ? undefined : defaultApproverFor(security);

  const orchestrator = new Orchestrator({
    router,
    tools,
    eventLog,
    session,
    cwd: cp.cwd,
    security,
    approve,
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
  console.log(`[飞虹 Code] 回滚会话 ${id.slice(0, 8)} 的 ${cp.touchedFiles.length} 个文件 (cwd=${cp.cwd})`);
  const res = await gitRollback(cp.cwd, cp.touchedFiles, { yes });
  if (res.reverted.length) console.log(`已还原(已跟踪): ${res.reverted.join(', ')}`);
  if (res.removed.length) console.log(`已删除(未跟踪): ${res.removed.join(', ')}`);
  if (res.errors.length) console.log(`注意: ${res.errors.join('; ')}`);
  if (yes) await updateStatus(home, id, 'done');
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

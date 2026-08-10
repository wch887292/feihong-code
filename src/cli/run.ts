/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 运行装配：把模型路由、工具、运行时、编排器组装成一次任务执行。
 * 无 API key 时自动进入离线模式（ScriptedMockProvider 驱动闭环验证）。
 */
import { randomUUID } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { setRunId, logger } from '../shared/logger';
import { loadConfig } from '../shared/config';
import { ModelRouter } from '../models/model-router';
import { ScriptedMockProvider, type MockStep } from '../models/providers/mock.provider';
import { createDefaultRegistry } from '../tools';
import { EventLog } from '../runtime/event-log';
import { SessionStore } from '../runtime/session-store';
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
              content: '飞虹 Code 离线闭环验证成功。\n需求 → 模型 → 工具执行 → 结果回填 → 总结，全程无需任何 API key。\n',
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

export async function runGoal(goal: string, opts: RunOptions = {}): Promise<void> {
  const runId = randomUUID();
  setRunId(runId);

  const security: OrchestratorSecurity = { shellAllowlist: [], requireApproval: true };
  const offline = opts.offline ?? isOfflineByDefault();

  // 离线模式用临时工作区，避免污染用户目录
  const cwd = offline ? mkdtempSync(join(tmpdir(), 'fhcode-demo-')) : process.cwd();

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
  const logDir = offline ? join(tmpdir(), 'fhcode-demo-logs') : '~/.feihong-code/sessions';
  const eventLog = new EventLog(runId, logDir);
  const session = new SessionStore(runId, cwd);

  const orchestrator = new Orchestrator({
    router,
    tools,
    eventLog,
    session,
    cwd,
    security,
    approve: opts.approve,
  });

  console.log(`[飞虹 Code] 开始任务 (runId=${runId}${offline ? ', 离线模式' : ''})`);
  const result = await orchestrator.run(goal);

  console.log('\n===== 执行结果 =====');
  console.log(result.finalAnswer);
  console.log(
    `\n迭代 ${result.iterations} 次 · 成本 $${result.costUsd.toFixed(6)} · 日志 ${result.logFile}`,
  );
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

/** --parallel 并行多子代理执行 */
export async function runParallelGoal(goal: string): Promise<void> {
  const offline = isOfflineByDefault();
  console.log(`[飞虹 Code] 并行模式 (offline=${offline})`);
  const result = await runParallel(goal, {
    offline,
    mockFor: (task) => defaultParallelMock(task),
  });
  console.log('\n===== 并行执行结果 =====');
  console.log(result.summary);
  console.log(`仓库根: ${result.repoRoot} · 工作树已清理: ${result.worktrees.length}`);
}

function expandHome(p: string): string {
  if (p.startsWith('~')) return join(process.env.HOME || process.cwd(), p.slice(1));
  return p;
}

function joinHome(): string {
  return join(homedir(), '.feihong-code');
}

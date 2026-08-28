/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M9 全自动软件工程 Agent（SWE Agent）：
 *  - 读取整个（大型）代码仓库 → 任务拆解规划 → 逐任务（实现 + 验证 + 自愈重试）→ 产出报告
 *  - 实现阶段委托 runSubTask（内部用 Orchestrator 的 ReAct 循环 + 工具系统 + 自愈）
 *  - 验证阶段用 swe-verifier（构建/测试），失败时把错误摘要注入下一轮实现（自我修复闭环）
 *  - 支持 plan-only / verify-only / max-tasks / max-retries 模式
 */
import { readRepository, type RepoSnapshot } from './repo-reader';
import { planSweTask, type SwePlan, type SweSubTask } from './swe-planner';
import { verifyTask, type VerifyResult } from './swe-verifier';

/** 实现单个子任务的回调（由 run.ts 注入，内含 Orchestrator 装配） */
export interface SubTaskOutcome {
  ok: boolean;
  finalAnswer: string;
  iterations: number;
  touchedFiles: string[];
}

export interface SweAgentDeps {
  cwd: string;
  runSubTask: (focusedGoal: string) => Promise<SubTaskOutcome>;
  maxTasks?: number;
  maxRetries?: number;
  verifyOnly?: boolean;
  planOnly?: boolean;
  includePreviews?: boolean;
  maxFiles?: number;
  onPhase?: (phase: string, info: Record<string, unknown>) => void;
  /** 可选事件日志（结构兼容 EventLog，用于审计追踪） */
  eventLog?: { append(type: string, payload: Record<string, unknown>): Promise<void> } | null;
}

export interface SweTaskResult {
  task: SweSubTask;
  implemented: boolean;
  verify: VerifyResult;
  retriesUsed: number;
  finalAnswer?: string;
  touchedFiles: string[];
}

export type SweOverall = 'success' | 'partial' | 'failed';

export interface SweReport {
  goal: string;
  repository: string;
  plannedTasks: number;
  executedTasks: number;
  completedTasks: number;
  overall: SweOverall;
  durationMs: number;
  tasks: SweTaskResult[];
  summary: string;
  repoContext: string;
}

interface EventLogLike {
  append(type: string, payload: Record<string, unknown>): Promise<void>;
}

export async function runSweAgent(goal: string, deps: SweAgentDeps): Promise<SweReport> {
  const {
    cwd,
    runSubTask,
    maxTasks = 8,
    maxRetries = 2,
    verifyOnly = false,
    planOnly = false,
    includePreviews = false,
    maxFiles,
    onPhase,
    eventLog,
  } = deps;
  const log = eventLog as EventLogLike | undefined;
  const started = Date.now();

  const phase = (p: string, info: Record<string, unknown> = {}) => {
    onPhase?.(p, info);
    log?.append('swe.' + p.replace(/[^a-z]/g, '.'), info).catch(() => undefined);
  };

  // 阶段 1：读取整个仓库
  phase('repo.read', { cwd });
  const snapshot: RepoSnapshot = readRepository(cwd, { includePreviews, maxFiles });
  phase('repo.read.done', { fileCount: snapshot.fileCount, truncated: snapshot.truncated });

  // 阶段 2：任务拆解规划
  phase('plan', { goal });
  const plan: SwePlan = planSweTask(goal, snapshot);
  let tasks = plan.tasks;
  if (tasks.length > maxTasks) {
    tasks = tasks.slice(0, maxTasks);
    phase('plan.capped', { original: plan.tasks.length, capped: maxTasks });
  }
  phase('plan.done', { taskCount: tasks.length });

  const taskResults: SweTaskResult[] = [];

  if (planOnly) {
    return finalize(goal, snapshot, tasks, taskResults, started, 'partial');
  }

  // 阶段 3：逐任务实现 + 验证（含自愈重试）
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    phase('task.start', { index: i + 1, total: tasks.length, id: task.id, title: task.title });

    if (verifyOnly) {
      const v = await verifyTask(snapshot, task, cwd);
      taskResults.push({ task, implemented: false, verify: v, retriesUsed: 0, touchedFiles: [] });
      phase('task.verify.only', { id: task.id, overall: v.overall });
      continue;
    }

    let implemented = false;
    let finalAnswer: string | undefined;
    let touchedFiles: string[] = [];
    let verify: VerifyResult = emptyVerify();
    let retriesUsed = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 构建聚焦目标：仓库上下文 + 计划 + 当前子任务 + (失败时的错误反馈)
      let focusedGoal = buildFocusedGoal(plan, task, snapshot);
      if (attempt > 0 && verify.overall === 'fail') {
        const tail = (verify.log || verify.errorSummary).slice(-1500);
        focusedGoal +=
          `\n\n# 上一轮验证失败，请自我修复\n` +
          `以下是验证命令的真实输出（请据此定位根因）：\n\`\`\`\n${tail}\n\`\`\`\n` +
          `请分析根因、就地修改代码，然后重新运行验证命令确认通过。不要编造成功。`;
        phase('task.selfheal', { id: task.id, attempt });
      }

      const outcome = await runSubTask(focusedGoal);
      implemented = true;
      finalAnswer = outcome.finalAnswer;
      touchedFiles = outcome.touchedFiles;

      verify = await verifyTask(snapshot, task, cwd);
      if (verify.overall === 'pass' || verify.overall === 'skipped') {
        break;
      }
      retriesUsed = attempt + 1;
    }

    taskResults.push({ task, implemented, verify, retriesUsed, finalAnswer, touchedFiles });
    phase('task.done', {
      id: task.id,
      implemented,
      verify: verify.overall,
      retries: retriesUsed,
      files: touchedFiles.length,
    });
  }

  // 阶段 4：汇总
  phase('finalize', { taskCount: tasks.length });
  return finalize(goal, snapshot, tasks, taskResults, started, computeOverall(taskResults));
}

function buildFocusedGoal(plan: SwePlan, task: SweSubTask, snapshot: RepoSnapshot): string {
  const lines = [
    plan.modelPrompt,
    '',
    `# 当前执行子任务 [${task.id}] ${task.title}`,
    `描述: ${task.description}`,
    `验收标准: ${task.acceptance}`,
    `目标文件: ${task.targetFiles.join(', ') || '（自动定位）'}`,
    snapshot.buildCommand ? `仓库构建命令: ${snapshot.buildCommand}` : '',
    snapshot.testCommand ? `仓库测试命令: ${snapshot.testCommand}` : '',
    task.verifyCommand ? `本任务专属验证命令: ${task.verifyCommand}` : '',
    '',
    '## 本轮聚焦纪律',
    `- 本轮回合只专注完成上方子任务 [${task.id}]，不要提前做其他子任务。`,
    '- 必须通过工具实际修改/创建文件；描述代码不算完成。',
    '- 完成后务必运行对应验证命令，并依据真实输出判断，禁止谎报通过。',
    '- 完成后用一句话说明：做了什么、验证了什么、结果如何。',
  ];
  return lines.filter(Boolean).join('\n');
}

function computeOverall(results: SweTaskResult[]): SweOverall {
  if (results.length === 0) return 'failed';
  const passed = results.filter(
    (r) => r.verify.overall === 'pass' || r.verify.overall === 'skipped',
  );
  if (passed.length === results.length) return 'success';
  if (passed.length === 0) return 'failed';
  return 'partial';
}

function finalize(
  goal: string,
  snapshot: RepoSnapshot,
  tasks: SweSubTask[],
  results: SweTaskResult[],
  started: number,
  overall: SweOverall,
): SweReport {
  const durationMs = Date.now() - started;
  const executed = results.length;
  const completed = results.filter(
    (r) => r.verify.overall === 'pass' || r.verify.overall === 'skipped',
  ).length;

  const lines: string[] = [];
  lines.push(`== 全自动软件工程 Agent 报告 ==`);
  lines.push(`目标: ${goal}`);
  lines.push(`仓库: ${snapshot.root} (索引 ${snapshot.fileCount} 文件, ${snapshot.truncated ? '已截断' : '完整'})`);
  lines.push(`任务: 规划 ${tasks.length} 个, 执行 ${executed} 个, 通过 ${completed} 个`);
  lines.push(`总耗时: ${(durationMs / 1000).toFixed(1)}s · 总体: ${overall.toUpperCase()}`);
  lines.push('');
  for (const r of results) {
    const status = !r.implemented
      ? '未实现'
      : r.verify.overall === 'pass'
        ? '✅ 通过'
        : r.verify.overall === 'skipped'
          ? '⚠️ 跳过验证'
          : `❌ 失败(重试${r.retriesUsed}次)`;
    lines.push(`[${r.task.id}] ${r.task.title} → ${status}`);
    if (r.touchedFiles.length) lines.push(`    改动: ${r.touchedFiles.join(', ')}`);
    if (r.verify.overall === 'fail') lines.push(`    错误: ${r.verify.errorSummary.slice(0, 300)}`);
  }

  return {
    goal,
    repository: snapshot.root,
    plannedTasks: tasks.length,
    executedTasks: executed,
    completedTasks: completed,
    overall,
    durationMs,
    tasks: results,
    summary: lines.join('\n'),
    repoContext: snapshot.contextString,
  };
}

function emptyVerify(): VerifyResult {
  return { overall: 'skipped', steps: [], errorSummary: '', durationMs: 0, log: '' };
}

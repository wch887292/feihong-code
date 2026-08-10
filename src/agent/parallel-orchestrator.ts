/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 并行编排器（M2 核心）：把大目标拆成子任务，为每个子任务创建 git worktree 隔离工作区，
 * 并行启动子代理，最后汇总各工作区结果。失败隔离：单个子代理出错不影响其他。
 */
import { logger } from '../shared/logger';
import { ModelRouter } from '../models/model-router';
import { decomposeGoal, type SubTask } from './planner';
import { runSubAgent, type SubAgentResult } from './subagent';
import {
  createWorktree,
  removeWorktree,
  getRepoRoot,
  type Worktree,
} from '../runtime/worktree';
import type { MockStep } from '../models/providers/mock.provider';

export interface ParallelOptions {
  offline?: boolean;
  router?: ModelRouter;
  repoRoot?: string;
  approve?: (action: string) => Promise<boolean>;
  /** 离线模式：自定义每个子任务的脚本（默认写一份产物文件） */
  mockFor?: (task: SubTask, index: number) => MockStep[];
  /** 任务完成后是否清理 worktree（默认 true，子代理产物不进主仓库） */
  cleanup?: boolean;
}

export interface ParallelResult {
  ok: boolean;
  summary: string;
  subResults: Array<SubAgentResult & { task: SubTask }>;
  worktrees: Worktree[];
  repoRoot: string;
}

export async function runParallel(goal: string, opts: ParallelOptions = {}): Promise<ParallelResult> {
  const offline = opts.offline ?? true;
  const repoRoot = opts.repoRoot ?? (await getRepoRoot(process.cwd()));
  const cleanup = opts.cleanup ?? true;

  const tasks = decomposeGoal(goal);
  const router = opts.router ?? new ModelRouter([], 'cost', 0); // 离线时子代理自带 mock

  logger.info('parallel start', { repoRoot, tasks: tasks.length, offline });

  const worktrees: Worktree[] = [];
  const subResults: Array<SubAgentResult & { task: SubTask }> = [];

  // 为每个子任务建隔离 worktree
  for (const task of tasks) {
    worktrees.push(await createWorktree(repoRoot, task.id));
  }

  try {
    const runs = tasks.map((task, i) =>
      runSubAgent({
        worktree: worktrees[i],
        goal: task.goal,
        router,
        offline,
        approve: opts.approve,
        mockSteps: offline ? (opts.mockFor ? opts.mockFor(task, i) : undefined) : undefined,
      }).then((r) => ({ ...r, task })),
    );

    const settled = await Promise.allSettled(runs);
    for (const s of settled) {
      if (s.status === 'fulfilled') subResults.push(s.value);
      else logger.error('subagent failed', { error: String(s.reason) });
    }
  } finally {
    if (cleanup) {
      for (const wt of worktrees) {
        try {
          await removeWorktree(repoRoot, wt.path);
        } catch (e) {
          logger.warn('worktree cleanup failed', {
            path: wt.path,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  const okCount = subResults.filter((r) => r.ok).length;
  const summary =
    `并行执行完成：${okCount}/${tasks.length} 个子任务成功。` +
    subResults
      .map((r) => `\n- [${r.ok ? 'OK' : 'FAIL'}] ${r.task.title} → ${r.worktree.branch}`)
      .join('');

  return { ok: okCount === tasks.length, summary, subResults, worktrees, repoRoot };
}

/** 默认离线脚本生成：每个子任务在其 worktree 写一份独立产物文件 */
export function defaultParallelMock(task: SubTask): MockStep[] {
  const fname = `subtask-${task.id}.txt`;
  return [
    {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: { path: fname, content: `子任务 ${task.id} 完成：${task.goal}\n` },
          },
        ],
      },
    },
    {
      message: {
        role: 'assistant',
        content: `已在隔离工作区写入 ${fname}，完成子任务：${task.goal}`,
      },
    },
  ];
}

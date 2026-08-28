/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 子代理：单个隔离工作区内的执行单元（M2 多子代理并行）。
 * 复用 Orchestrator，但绑定自己的 worktree 目录（cwd）与单一子目标，
 * 因此天然与其他子代理物理隔离（工具沙箱基于 cwd）。
 */
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { setRunId, logger } from '../shared/logger';
import type { CapabilityTag } from '../shared/types';
import { ModelRouter } from '../models/model-router';
import { ScriptedMockProvider, type MockStep } from '../models/providers/mock.provider';
import { createDefaultRegistry } from '../tools';
import { EventLog } from '../runtime/event-log';
import { SessionStore } from '../runtime/session-store';
import { Orchestrator, type OrchestratorSecurity, type RunResult } from './orchestrator';
import type { Worktree } from '../runtime/worktree';
import { decomposeGoal } from './planner';
import { summarizeSubTaskAnswer } from './subagent-summary';

/** P3-4：子代理最大嵌套深度（对齐 Claude subagents，默认 3 层） */
export const MAX_SUBAGENT_DEPTH = 3;

export interface SubAgentDeps {
  worktree: Worktree;
  goal: string;
  /** 在线模式共享的模型路由（真实模型） */
  router: ModelRouter;
  offline?: boolean;
  security?: OrchestratorSecurity;
  approve?: (action: string) => Promise<boolean>;
  /** 离线模式脚本（不传则用默认：写一份子任务产物文件） */
  mockSteps?: MockStep[];
  /** P1-1：子代理模型标签路由（缺省 ['code-gen','cheap']，低成本模型优先） */
  tags?: CapabilityTag[];
  /** P3-4：当前嵌套深度（1 = 顶层子代理） */
  depth?: number;
  /** P3-4：最大嵌套深度（默认 3） */
  maxDepth?: number;
}

export interface SubAgentResult extends RunResult {
  worktree: Worktree;
  subGoal: string;
}

export async function runSubAgent(deps: SubAgentDeps): Promise<SubAgentResult> {
  const { worktree, goal, router, offline, security, approve, mockSteps, tags } = deps;
  const depth = deps.depth ?? 1;
  const maxDepth = deps.maxDepth ?? MAX_SUBAGENT_DEPTH;
  const runId = randomUUID();
  setRunId(runId);

  // P3-4：深度未达上限且目标可拆解 → 递归派生子代理（子目录隔离，不建 git worktree）
  if (depth < maxDepth) {
    const subtasks = decomposeGoal(goal);
    if (subtasks.length > 1) {
      logger.info('subagent nesting', { runId, depth, children: subtasks.length, goal });
      const parts: string[] = [];
      let okAll = true;
      let iterations = 0;
      for (const st of subtasks) {
        const subDir = join(worktree.path, `.sub-${st.id}`);
        mkdirSync(subDir, { recursive: true });
        const child: SubAgentResult = await runSubAgent({
          worktree: { path: subDir, branch: `${worktree.branch}/${st.id}` },
          goal: st.goal,
          router,
          offline,
          security,
          approve,
          mockSteps,
          tags,
          depth: depth + 1,
          maxDepth,
        });
        iterations += child.iterations;
        okAll = okAll && child.ok;
        // 逐层摘要：只把子代理的摘要结果带回上层上下文，隔离中间大输出
        const s = summarizeSubTaskAnswer(child.finalAnswer);
        parts.push(`[${st.id}] ${s.text}`);
      }
      const finalAnswer = parts.join('\n');
      const result: RunResult = {
        ok: okAll,
        finalAnswer,
        iterations,
        costUsd: 0,
        logFile: '',
        runId,
      };
      return { ...result, worktree, subGoal: goal };
    }
  }

  const effectiveRouter = offline
    ? new ModelRouter([new ScriptedMockProvider(mockSteps ?? defaultSubMock(goal))], 'cost', 0)
    : router;

  const sec: OrchestratorSecurity = security ?? {
    shellAllowlist: [],
    requireApproval: true,
  };
  const tools = createDefaultRegistry();
  const eventLog = new EventLog(runId, join(worktree.path, '.fhcode-logs'));
  const session = new SessionStore(runId, worktree.path);

  const orch = new Orchestrator({
    router: effectiveRouter,
    tools,
    eventLog,
    session,
    cwd: worktree.path,
    security: sec,
    approve,
    tags,
  });

  logger.info('subagent start', { runId, worktree: worktree.path, goal, depth });
  const result = await orch.run(goal);
  return { ...result, worktree, subGoal: goal };
}

/** 离线兜底脚本：在 worktree 内写一份以子目标命名的产物文件 */
function defaultSubMock(goal: string): MockStep[] {
  const fname = `${slug(goal)}.txt`;
  return [
    {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'write_file',
            arguments: { path: fname, content: `子任务完成：${goal}\n` },
          },
        ],
      },
    },
    { message: { role: 'assistant', content: `已在 ${fname} 完成子任务：${goal}` } },
  ];
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'task'
  );
}

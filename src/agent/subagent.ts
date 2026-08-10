/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 子代理：单个隔离工作区内的执行单元（M2 多子代理并行）。
 * 复用 Orchestrator，但绑定自己的 worktree 目录（cwd）与单一子目标，
 * 因此天然与其他子代理物理隔离（工具沙箱基于 cwd）。
 */
import { randomUUID } from 'crypto';
import { join } from 'path';
import { setRunId, logger } from '../shared/logger';
import { ModelRouter } from '../models/model-router';
import { ScriptedMockProvider, type MockStep } from '../models/providers/mock.provider';
import { createDefaultRegistry } from '../tools';
import { EventLog } from '../runtime/event-log';
import { SessionStore } from '../runtime/session-store';
import { Orchestrator, type OrchestratorSecurity, type RunResult } from './orchestrator';
import type { Worktree } from '../runtime/worktree';

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
}

export interface SubAgentResult extends RunResult {
  worktree: Worktree;
  subGoal: string;
}

export async function runSubAgent(deps: SubAgentDeps): Promise<SubAgentResult> {
  const { worktree, goal, router, offline, security, approve, mockSteps } = deps;
  const runId = randomUUID();
  setRunId(runId);

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
  });

  logger.info('subagent start', { runId, worktree: worktree.path, goal });
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

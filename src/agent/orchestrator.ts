/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 编排器：ReAct 循环（模型 → 工具调用 → 结果回填 → 完成）。
 * 依赖注入 ModelRouter / ToolRegistry / EventLog / SessionStore，便于测试与替换。
 *
 * M3 增强：
 *  - run(goal, resume?) 支持从检查点续跑（中断任务恢复）
 *  - 每轮迭代后通过 persist 回调落盘检查点（含完整对话、迭代数、成本、被改动文件）
 */
import type { ModelRouter } from '../models/model-router';
import type { ToolRegistry } from '../tools/tool.registry';
import type { ChatMessage, ChatResponse } from '../models/model.interface';
import type { EventLog } from '../runtime/event-log';
import type { SessionStore } from '../runtime/session-store';
import type { SessionCheckpoint, SessionStatus } from '../runtime/session-persist';
import { SYSTEM_PROMPT } from './prompts';
import { planTask } from './planner';
import { logger } from '../shared/logger';

export interface OrchestratorSecurity {
  shellAllowlist: string[];
  requireApproval: boolean;
}

export interface OrchestratorDeps {
  router: ModelRouter;
  tools: ToolRegistry;
  eventLog: EventLog;
  session: SessionStore;
  cwd: string;
  security: OrchestratorSecurity;
  approve?: (action: string) => Promise<boolean>;
  maxIterations?: number;
  /** M3：每轮迭代后落盘检查点（resume/diff/rollback 依赖） */
  persist?: (cp: SessionCheckpoint) => Promise<void>;
}

/** M3 resume 上下文：携带已完成的对话与计数，避免重复执行 */
export interface ResumeContext {
  messages: ChatMessage[];
  iterations: number;
  costUsd: number;
  touchedFiles: string[];
}

export interface RunResult {
  ok: boolean;
  finalAnswer: string;
  iterations: number;
  costUsd: number;
  logFile: string;
  runId: string;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async run(goal: string, resume?: ResumeContext): Promise<RunResult> {
    const { router, tools, eventLog, session, cwd, security, approve, persist } = this.deps;
    const maxIter = this.deps.maxIterations ?? 12;

    let messages: ChatMessage[];
    let baselineIterations = 0;
    let carryCost = 0;
    const touchedFiles: string[] = resume ? [...resume.touchedFiles] : [];

    if (resume && resume.messages.length > 0) {
      messages = resume.messages;
      baselineIterations = resume.iterations;
      carryCost = resume.costUsd;
      await eventLog.append('session.resume', { fromIterations: baselineIterations });
    } else {
      const { messages: initMessages, plan } = planTask(goal);
      messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...initMessages];
      session.append(messages[0]);
      session.append(messages[1]);
      await eventLog.append('plan', { steps: plan.steps });
      await eventLog.append('session.start', { goal, cwd });
    }

    let finalAnswer = '';
    let cost = carryCost;
    let calls = 0;

    // 检查点落盘（闭包引用最新 calls/cost/touchedFiles）
    const emitCheckpoint = async (status: SessionStatus): Promise<void> => {
      if (!persist) return;
      const snap = session.snapshot();
      await persist({
        runId: snap.runId,
        goal,
        cwd,
        createdAt: snap.createdAt,
        updatedAt: new Date().toISOString(),
        status,
        iterations: baselineIterations + calls,
        costUsd: cost,
        messages: snap.messages,
        touchedFiles,
      });
    };

    if (!resume) await emitCheckpoint('running');

    for (; calls < maxIter; calls++) {
      const resp: ChatResponse = await router.chat(
        { messages, tools: tools.definitions(), temperature: 0, timeoutMs: 180000 },
        ['code-gen'],
      );
      cost += resp.costUsd;
      const msg = resp.message;
      messages.push(msg);
      session.append(msg);

      // 记录被文件类工具改动的文件路径
      for (const tc of msg.toolCalls ?? []) {
        const p = (tc.arguments as { path?: unknown } | undefined)?.path;
        if (
          (tc.name === 'write_file' || tc.name === 'edit_file') &&
          typeof p === 'string' &&
          !touchedFiles.includes(p)
        ) {
          touchedFiles.push(p);
        }
      }

      await eventLog.append('model.response', {
        provider: resp.providerId,
        model: resp.model,
        toolCalls: (msg.toolCalls ?? []).map((t) => t.name),
      });
      await emitCheckpoint('running');

      // 无工具调用 → 视为任务完成
      if (!msg.toolCalls || msg.toolCalls.length === 0) {
        finalAnswer = msg.content;
        break;
      }

      // 执行本轮所有工具调用，并将结果以 tool 消息回填
      for (const tc of msg.toolCalls) {
        await eventLog.append('tool.call', { name: tc.name, args: tc.arguments });
        const result = await tools.execute(tc.name, tc.arguments, {
          runId: session.runId,
          cwd,
          security,
          approve,
        });
        await eventLog.append('tool.result', {
          name: tc.name,
          ok: result.ok,
          output: result.output.slice(0, 500),
        });
        const content = result.ok ? result.output : `错误: ${result.error}`;
        const toolMsg: ChatMessage = { role: 'tool', content, toolCallId: tc.id };
        messages.push(toolMsg);
        session.append(toolMsg);
      }
      await emitCheckpoint('running');
    }

    if (baselineIterations + calls >= maxIter && !finalAnswer) {
      finalAnswer = '已达到最大迭代次数，任务可能未完全完成，请检查工作区与日志。';
      await eventLog.append('error', { reason: 'max-iterations-reached' });
      logger.warn('orchestrator reached max iterations', { runId: session.runId });
    }

    await emitCheckpoint('done');
    await eventLog.append('session.end', { iterations: baselineIterations + calls, costUsd: cost });
    return {
      ok: finalAnswer.length > 0,
      finalAnswer,
      iterations: baselineIterations + calls,
      costUsd: cost,
      logFile: eventLog.filePath,
      runId: session.runId,
    };
  }
}

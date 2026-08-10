/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 编排器：ReAct 循环（模型 → 工具调用 → 结果回填 → 完成）。
 * 依赖注入 ModelRouter / ToolRegistry / EventLog / SessionStore，便于测试与替换。
 *
 * M3 增强：
 *  - run(goal, resume?) 支持从检查点续跑（中断任务恢复）
 *  - 每轮迭代后通过 persist 回调落盘检查点（含完整对话、迭代数、成本、被改文件）
 *
 * M6 增强：
 *  - 自我修复循环：错误自动识别 + 反思重试（最多 FH_MAX_RETRY_ERRORS 次）
 *  - 上下文压缩：长时任务自动压缩早期消息（每 FH_CONTEXT_COMPACT_EVERY 次迭代）
 *  - 经验学习：会话完成后提取经验并保存
 *  - 模型性能追踪：自动记录各 provider 成功率，影响后续路由选择
 */
import type { ModelRouter } from '../models/model-router';
import type { ToolRegistry } from '../tools/tool.registry';
import type { ChatMessage, ChatResponse } from '../models/model.interface';
import type { EventLog } from '../runtime/event-log';
import type { ToolGuard } from '../tools/tool.interface';
import type { SessionStore } from '../runtime/session-store';
import type { SessionCheckpoint, SessionStatus } from '../runtime/session-persist';
import { SYSTEM_PROMPT } from './prompts';
import { planTask } from './planner';
import { logger } from '../shared/logger';
import {
  classifyError,
  injectReflection,
  countConsecutiveErrors,
  logRecoveryAttempt,
  type ErrorAnalysis,
} from './self-heal';
import { compactContext, shouldCompact, getCompactionThreshold } from './context-compactor';
import {
  extractExperience,
  saveExperience,
  loadExperiences,
  generateExperiencePrompt,
  updateExperienceUsage,
} from './experience';

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
  /** M4：企业守卫（RBAC 策略 + 审批 + 审计），未注入时行为同 M3 */
  guard?: ToolGuard;
  /** M4：单任务成本上限（USD），超出即中止，0/undefined 表示不限 */
  maxCostUsd?: number;
  /** M6：错误自动重试上限（默认 3） */
  maxRetryErrors?: number;
  /** M6：上下文压缩触发阈值（默认 30 条消息） */
  contextCompactEvery?: number;
  /** M6：经验目录 */
  experienceDir?: string;
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
  /** M6: 是否触发自愈循环 */
  selfHealed?: boolean;
  /** M6: 经验提取数量 */
  experiencesExtracted?: number;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async run(goal: string, resume?: ResumeContext): Promise<RunResult> {
    const {
      router, tools, eventLog, session, cwd, security, approve, persist, guard,
      maxRetryErrors = 3,
      contextCompactEvery,
      experienceDir,
    } = this.deps;
    const maxIter = this.deps.maxIterations ?? 12;
    const maxCost = this.deps.maxCostUsd ?? 0;
    const compactThreshold = getCompactionThreshold({ compactEvery: contextCompactEvery });

    let messages: ChatMessage[];
    let baselineIterations = 0;
    let carryCost = 0;
    const touchedFiles: string[] = resume ? [...resume.touchedFiles] : [];
    let selfHealed = false;
    const errorHistory: ErrorAnalysis[] = [];

    if (resume && resume.messages.length > 0) {
      messages = resume.messages;
      baselineIterations = resume.iterations;
      carryCost = resume.costUsd;
      await eventLog.append('session.resume', { fromIterations: baselineIterations });
    } else {
      // M6: 加载历史经验
      const experiences = experienceDir ? await loadExperiences(experienceDir, [goal]) : [];
      const experiencePrompt = generateExperiencePrompt(experiences);
      const systemPrompt = experiencePrompt ? `${SYSTEM_PROMPT}\n\n${experiencePrompt}` : SYSTEM_PROMPT;

      const { messages: initMessages, plan } = planTask(goal);
      messages = [{ role: 'system', content: systemPrompt }, ...initMessages];
      session.append(messages[0]);
      session.append(messages[1]);
      await eventLog.append('plan', { steps: plan.steps });
      await eventLog.append('session.start', { goal, cwd });
    }

    let finalAnswer = '';
    let cost = carryCost;
    let calls = 0;
    let consecutiveErrors = 0;

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
      const startTime = Date.now();
      const resp: ChatResponse = await router.chat(
        { messages, tools: tools.definitions(), temperature: 0, timeoutMs: 180000 },
        ['code-gen'],
      );
      const latency = Date.now() - startTime;
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
        latencyMs: latency,
      });
      await emitCheckpoint('running');

      // 无工具调用 → 视为任务完成
      if (!msg.toolCalls || msg.toolCalls.length === 0) {
        finalAnswer = msg.content;
        break;
      }

      // M4：单任务成本熔断（超预算立即停手，避免失控烧钱）
      if (maxCost > 0 && cost >= maxCost) {
        finalAnswer = `已达单任务成本上限 $${maxCost}（当前 $${cost.toFixed(6)}），任务中止。可调高角色策略 maxCostUsd 后用 resume 续跑。`;
        await eventLog.append('error', { reason: 'cost-limit-reached', costUsd: cost, maxCost });
        logger.warn('orchestrator hit cost limit', { runId: session.runId, cost, maxCost });
        calls++;
        break;
      }

      // 执行本轮所有工具调用，并将结果以 tool 消息回填
      let roundErrors = 0;
      for (const tc of msg.toolCalls) {
        await eventLog.append('tool.call', { name: tc.name, args: tc.arguments });
        const result = await tools.execute(tc.name, tc.arguments, {
          runId: session.runId,
          cwd,
          security,
          approve,
          guard,
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

        if (!result.ok) {
          roundErrors++;
        }
      }

      // M6: 错误检测与自愈循环
      if (roundErrors > 0) {
        const { failed, errors: consecutiveErrorsCount } = countConsecutiveErrors(messages, maxRetryErrors);
        if (consecutiveErrorsCount > consecutiveErrors) {
          // 新增错误，分类并记录
          const lastToolMsg = messages[messages.length - 1];
          const errorAnalysis = classifyError(lastToolMsg.content || '', '');
          if (errorAnalysis) {
            errorHistory.push(errorAnalysis);
            await logRecoveryAttempt({ append: eventLog.append.bind(eventLog) } as any, calls, errorAnalysis, false);
            consecutiveErrors = consecutiveErrorsCount;

            if (failed) {
              // 达到重试上限，生成最终答案
              finalAnswer = `任务执行遇到连续 ${maxRetryErrors} 次错误，已尝试自动修复但未能成功。错误类型: ${errorHistory.map(e => e.category).join(', ')}。请检查工作区与日志，或使用 resume 续跑。`;
              await eventLog.append('error', { reason: 'max-retry-errors', errors: errorHistory });
              logger.warn('orchestrator hit max retry errors', { runId: session.runId, errors: errorHistory });
              calls++;
              break;
            }

            // 触发自愈：注入反思消息
            selfHealed = true;
            messages = injectReflection(messages, errorAnalysis, goal);
            await eventLog.append('self-heal', { category: errorAnalysis.category, iteration: calls });
            logger.info('self-heal: injected reflection', { iteration: calls, category: errorAnalysis.category });
            continue; // 跳过本轮计数，直接进入下一轮
          }
        }
      } else {
        // 本轮无错误，重置连续错误计数
        consecutiveErrors = 0;
      }

      await emitCheckpoint('running');

      // M6: 上下文压缩
      if (shouldCompact(messages, compactThreshold)) {
        const { messages: compacted, stats } = compactContext(messages, 10);
        messages = compacted;
        await eventLog.append('context.compact', { ...stats } as Record<string, unknown>);
        logger.info('context compaction applied', {
          originalLength: stats.originalLength,
          compressedLength: stats.compressedLength,
        });
      }
    }

    if (baselineIterations + calls >= maxIter && !finalAnswer) {
      finalAnswer = '已达到最大迭代次数，任务可能未完全完成，请检查工作区与日志。';
      await eventLog.append('error', { reason: 'max-iterations-reached' });
      logger.warn('orchestrator reached max iterations', { runId: session.runId });
    }

    // M6: 提取经验并保存
    let experiencesExtracted = 0;
    if (experienceDir && finalAnswer) {
      const experiences = extractExperience(messages, session.runId);
      for (const exp of experiences) {
        await saveExperience(experienceDir, exp);
      }
      // 更新已使用经验的统计
      for (const exp of experiences) {
        await updateExperienceUsage(experienceDir, exp.id);
      }
      experiencesExtracted = experiences.length;
      await eventLog.append('experience.extracted', { count: experiencesExtracted });
    }

    await emitCheckpoint('done');
    await eventLog.append('session.end', {
      iterations: baselineIterations + calls,
      costUsd: cost,
      selfHealed,
      experiencesExtracted,
    });

    return {
      ok: finalAnswer.length > 0,
      finalAnswer,
      iterations: baselineIterations + calls,
      costUsd: cost,
      logFile: eventLog.filePath,
      runId: session.runId,
      selfHealed,
      experiencesExtracted,
    };
  }
}

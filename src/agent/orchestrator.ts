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
import type { CapabilityTag } from '../shared/types';
import type { EventLog } from '../runtime/event-log';
import type { ToolGuard } from '../tools/tool.interface';
import type { SandboxMode, SandboxRules } from '../tools/sandbox';
import type { HookConfig } from '../runtime/hooks';
import type { SessionStore } from '../runtime/session-store';
import type { SessionCheckpoint, SessionStatus } from '../runtime/session-persist';
import { SYSTEM_PROMPT } from './prompts';
import { planTask } from './planner';
import { buildRepoInstructionsPrompt, scopedInstructionsFor } from './repo-context';
import { discoverSkills, buildSkillIndexPrompt } from '../skills/skill-loader';
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
  upsertExperience,
  retrieveRelevantExperiences,
  generateExperiencePrompt,
  updateExperienceUsage,
  extractFixPattern,
  type Experience,
} from './experience';

export interface OrchestratorSecurity {
  shellAllowlist: string[];
  requireApproval: boolean;
  /** P0-2：沙箱模式（缺省 workspace-write） */
  sandboxMode?: SandboxMode;
  /** P0-2：网络域名规则 */
  networkRules?: SandboxRules;
  /** P2-1：hooks 确定性控制 */
  hooks?: HookConfig[];
}

/**
 * P0-1 流式事件：编排器关键节点的实时事件流，CLI 可据此增量打印到 stdout。
 * 不引入任何渲染逻辑，事件与展示解耦（后续 TUI 可复用同一事件流）。
 */
export type OrchestratorEvent =
  | { type: 'model.response'; provider: string; model: string; content: string; toolCalls: string[] }
  | { type: 'tool.call'; name: string; args: Record<string, unknown> }
  | { type: 'tool.result'; name: string; ok: boolean; output: string }
  | { type: 'self-heal'; category: string; iteration: number }
  | { type: 'context.compact'; originalLength: number; compressedLength: number }
  | { type: 'session.end'; iterations: number; costUsd: number; ok: boolean };

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
  /** P0-1：流式事件回调（实时输出进度，可选） */
  onEvent?: (ev: OrchestratorEvent) => void;
  /** P1-1：模型能力标签路由（缺省 ['code-gen']；子任务可传 ['code-gen','cheap'] 让低成本模型分担） */
  tags?: CapabilityTag[];
  /** P3-3：插件技能目录（合并进技能发现） */
  pluginSkillDirs?: string[];
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
    const maxIter = this.deps.maxIterations ?? 25;
    const maxCost = this.deps.maxCostUsd ?? 0;
    const compactThreshold = getCompactionThreshold({ compactEvery: contextCompactEvery });

    let messages: ChatMessage[];
    let loadedExperiences: Experience[] = [];
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
      // M6: 加权检索相关历史经验（强化学习召回）
      loadedExperiences = experienceDir ? await retrieveRelevantExperiences(experienceDir, goal) : [];
      const experiencePrompt = generateExperiencePrompt(loadedExperiences);
      // P0-4: 仓库级 AGENTS.md 指令自动注入（存在时）
      const repoPrompt = buildRepoInstructionsPrompt(cwd);
      // P1-2: 技能索引渐进式披露（name+description 常驻，正文由 load_skill 按需加载）
      const skillIndex = buildSkillIndexPrompt(discoverSkills(cwd, this.deps.pluginSkillDirs ?? []));
      let systemPrompt = experiencePrompt ? `${SYSTEM_PROMPT}\n\n${experiencePrompt}` : SYSTEM_PROMPT;
      if (repoPrompt) systemPrompt += repoPrompt;
      if (skillIndex) systemPrompt += skillIndex;

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
        this.deps.tags ?? ['code-gen'],
      );
      const latency = Date.now() - startTime;
      cost += resp.costUsd;
      const msg = resp.message;
      messages.push(msg);
      session.append(msg);

      this.recordTouchedFiles(msg, touchedFiles);

      await eventLog.append('model.response', {
        provider: resp.providerId,
        model: resp.model,
        toolCalls: (msg.toolCalls ?? []).map((t) => t.name),
        latencyMs: latency,
      });
      this.deps.onEvent?.({
        type: 'model.response',
        provider: resp.providerId,
        model: resp.model,
        content: msg.content || '',
        toolCalls: (msg.toolCalls ?? []).map((t) => t.name),
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

      const roundErrors = await this.executeToolRound(msg, { tools, eventLog, session, cwd, security, approve, guard }, messages);

      // M6: 错误检测与自愈循环
      if (roundErrors > 0) {
        const rec = await this.handleRecovery(msg, {
          iteration: calls,
          consecutiveErrors,
          maxRetryErrors,
          eventLog,
          goal,
          errorHistory,
          messages,
          sessionRunId: session.runId,
        });
        if (rec.signal === 'break') {
          finalAnswer = rec.finalAnswer;
          calls++;
          break;
        }
        if (rec.signal === 'continue') {
          messages = rec.messages;
          consecutiveErrors = rec.consecutiveErrors;
          selfHealed = rec.selfHealed;
          continue; // 跳过本轮计数，直接进入下一轮
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
        this.deps.onEvent?.({
          type: 'context.compact',
          originalLength: stats.originalLength,
          compressedLength: stats.compressedLength,
        });
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

    // M6: 提取经验并以 upsert 强化写入（同一模式多次验证会累积权重，而非无限追加）
    let experiencesExtracted = 0;
    if (experienceDir && finalAnswer) {
      const experiences = extractExperience(messages, session.runId);
      for (const exp of experiences) {
        await upsertExperience(experienceDir, exp);
      }
      // 自愈成功：额外固化一条「修复经验」，强化后续同类错误的闭环
      if (selfHealed) {
        const fixExp = extractFixPattern(messages);
        if (fixExp) {
          await upsertExperience(experienceDir, fixExp);
          experiences.push(fixExp);
        }
      }
      // 更新「被加载并用于本次任务」的经验的统计（强化其权重）
      for (const exp of loadedExperiences) {
        await updateExperienceUsage(experienceDir, exp.id);
      }
      experiencesExtracted = experiences.length;
      await eventLog.append('experience.extracted', { count: experiencesExtracted, selfHealed });
    }

    await emitCheckpoint('done');
    await eventLog.append('session.end', {
      iterations: baselineIterations + calls,
      costUsd: cost,
      selfHealed,
      experiencesExtracted,
    });
    this.deps.onEvent?.({
      type: 'session.end',
      iterations: baselineIterations + calls,
      costUsd: cost,
      ok: finalAnswer.length > 0,
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

  /** 记录被 write/edit 类工具改动的文件路径（用于检查点与 diff） */
  private recordTouchedFiles(msg: ChatMessage, touchedFiles: string[]): void {
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
  }

  /** 执行本轮所有工具调用，将结果以 tool 消息回填，返回本轮失败次数 */
  private async executeToolRound(
    msg: ChatMessage,
    ctx: {
      tools: ToolRegistry;
      eventLog: EventLog;
      session: SessionStore;
      cwd: string;
      security: OrchestratorSecurity;
      approve?: (action: string) => Promise<boolean>;
      guard?: ToolGuard;
    },
    messages: ChatMessage[],
  ): Promise<number> {
    let roundErrors = 0;
    for (const tc of msg.toolCalls ?? []) {
      // P2-3：JIT 注入路径级规则——工具操作涉及的文件命中 AGENTS.md 的
      // paths frontmatter 时，把对应规则作为 system 消息注入（按文件去重）
      const fileArg = (tc.arguments as { path?: unknown } | undefined)?.path;
      if (typeof fileArg === 'string') {
        const scoped = scopedInstructionsFor(ctx.cwd, fileArg);
        if (scoped && !messages.some((m) => m.role === 'system' && m.content.includes(`匹配 ${fileArg}`))) {
          const ruleMsg: ChatMessage = { role: 'system', content: scoped };
          messages.push(ruleMsg);
          ctx.session.append(ruleMsg);
        }
      }
      await ctx.eventLog.append('tool.call', { name: tc.name, args: tc.arguments });
      this.deps.onEvent?.({ type: 'tool.call', name: tc.name, args: tc.arguments });
      const result = await ctx.tools.execute(tc.name, tc.arguments, {
        runId: ctx.session.runId,
        cwd: ctx.cwd,
        security: ctx.security,
        approve: ctx.approve,
        guard: ctx.guard,
      });
      await ctx.eventLog.append('tool.result', {
        name: tc.name,
        ok: result.ok,
        output: result.output.slice(0, 500),
      });
      this.deps.onEvent?.({ type: 'tool.result', name: tc.name, ok: result.ok, output: result.output.slice(0, 500) });
      const content = result.ok ? result.output : `错误: ${result.error}`;
      const toolMsg: ChatMessage = { role: 'tool', content, toolCallId: tc.id };
      messages.push(toolMsg);
      ctx.session.append(toolMsg);
      if (!result.ok) roundErrors++;
    }
    return roundErrors;
  }

  /** 错误检测与自愈：返回 'break'（达重试上限）/ 'continue'（已注入反思）/ 'none'（未触发） */
  private async handleRecovery(
    _msg: ChatMessage,
    input: {
      iteration: number;
      consecutiveErrors: number;
      maxRetryErrors: number;
      eventLog: EventLog;
      goal: string;
      errorHistory: ErrorAnalysis[];
      messages: ChatMessage[];
      sessionRunId: string;
    },
  ): Promise<{ signal: 'break' | 'continue' | 'none'; messages: ChatMessage[]; consecutiveErrors: number; selfHealed: boolean; finalAnswer: string }> {
    const { messages } = input;
    const { failed, errors } = countConsecutiveErrors(messages, input.maxRetryErrors);
    if (errors <= input.consecutiveErrors) {
      return { signal: 'none', messages, consecutiveErrors: input.consecutiveErrors, selfHealed: false, finalAnswer: '' };
    }
    const lastToolMsg = messages[messages.length - 1];
    const errorAnalysis = classifyError(lastToolMsg.content || '', '');
    if (!errorAnalysis) {
      return { signal: 'none', messages, consecutiveErrors: input.consecutiveErrors, selfHealed: false, finalAnswer: '' };
    }
    input.errorHistory.push(errorAnalysis);
    await logRecoveryAttempt(input.eventLog, input.iteration, errorAnalysis, false);
    const consecutiveErrors = errors;
    if (failed) {
      const finalAnswer = `任务执行遇到连续 ${input.maxRetryErrors} 次错误，已尝试自动修复但未能成功。错误类型: ${input.errorHistory.map((e) => e.category).join(', ')}。请检查工作区与日志，或使用 resume 续跑。`;
      await input.eventLog.append('error', { reason: 'max-retry-errors', errors: input.errorHistory });
      logger.warn('orchestrator hit max retry errors', { runId: input.sessionRunId, errors: input.errorHistory });
      return { signal: 'break', messages, consecutiveErrors, selfHealed: false, finalAnswer };
    }
    const selfHealed = true;
    const newMessages = injectReflection(messages, errorAnalysis, input.goal);
    await input.eventLog.append('self-heal', { category: errorAnalysis.category, iteration: input.iteration });
    this.deps.onEvent?.({ type: 'self-heal', category: errorAnalysis.category, iteration: input.iteration });
    logger.info('self-heal: injected reflection', { iteration: input.iteration, category: errorAnalysis.category });
    return { signal: 'continue', messages: newMessages, consecutiveErrors, selfHealed, finalAnswer: '' };
  }
}

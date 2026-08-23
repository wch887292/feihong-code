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
  /** P9：外部中断信号（任务停止按钮），触发后中断编排循环与进行中的模型请求 */
  signal?: AbortSignal;
  /** P9：模型调用失败重试上限（默认 3 次，指数退避应对 429 限流） */
  maxModelRetries?: number;
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

  /** 成功工具调用结果缓存：key = toolName + JSON.stringify(args)，防止模型重复调用相同工具 */
  private toolResultCache = new Map<string, { ok: boolean; output: string; error?: string }>();

  async run(goal: string, resume?: ResumeContext): Promise<RunResult> {
    const {
      router, tools, eventLog, session, cwd, security, approve, persist, guard,
      maxRetryErrors = 3,
      contextCompactEvery,
      experienceDir,
    } = this.deps;
    const maxIter = this.deps.maxIterations ?? 50;
    const maxCost = this.deps.maxCostUsd ?? 0;
    const compactThreshold = getCompactionThreshold({ compactEvery: contextCompactEvery });
    // 每次 run 重置工具结果缓存
    this.toolResultCache.clear();

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
      // P9：任务停止——检查外部中断信号，触发即终止编排循环
      if (this.deps.signal?.aborted) {
        await emitCheckpoint('crashed');
        return {
          ok: false,
          finalAnswer: '任务已被用户中断',
          iterations: baselineIterations + calls,
          costUsd: cost,
          logFile: '',
          runId: session.snapshot().runId,
          selfHealed,
        };
      }
      const startTime = Date.now();
      // P9：模型调用失败轮询重试（应对 429 限流 / 瞬时网络抖动），最多 maxModelRetries 次，指数退避
      let resp: ChatResponse | undefined;
      let lastChatErr: unknown;
      const maxModelRetries = this.deps.maxModelRetries ?? 3;
      for (let attempt = 0; attempt <= maxModelRetries; attempt++) {
        // 重试前再次检查中断信号
        if (this.deps.signal?.aborted) {
          await emitCheckpoint('crashed');
          return {
            ok: false,
            finalAnswer: '任务已被用户中断',
            iterations: baselineIterations + calls,
            costUsd: cost,
            logFile: '',
            runId: session.snapshot().runId,
            selfHealed,
          };
        }
        try {
          resp = await router.chat(
            { messages, tools: tools.definitions(), temperature: 0, timeoutMs: 180000, signal: this.deps.signal },
            this.deps.tags ?? ['code-gen'],
          );
          break; // 成功，跳出重试
        } catch (e) {
          lastChatErr = e;
          logger.warn('model call failed, will retry', {
            attempt: attempt + 1,
            maxRetries: maxModelRetries,
            error: e instanceof Error ? e.message : String(e),
          });
          if (attempt < maxModelRetries) {
            // 指数退避：1s, 2s, 4s...
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          }
        }
      }
      if (!resp) {
        throw lastChatErr instanceof Error ? lastChatErr : new Error('模型调用失败');
      }
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
      const hint = touchedFiles.length > 0
        ? `可在对话区继续发送"继续"二字，让任务以 resume 方式接着跑（已生成/修改的文件位于工作区）。`
        : `可点击「继续」按钮让任务接着执行，或在对话区细化任务目标重新提交。`;
      finalAnswer = `已达到最大迭代次数 ${maxIter} 轮，任务可能未完全完成。${hint}`;
      await eventLog.append('error', { reason: 'max-iterations-reached', maxIter, touchedFiles });
      logger.warn('orchestrator reached max iterations', { runId: session.runId, maxIter });
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

      // 去重检测：相同工具+相同参数如果之前已成功，直接返回缓存结果并警告模型不要重复调用
      const cacheKey = tc.name + '::' + JSON.stringify(tc.arguments ?? {});
      const cached = this.toolResultCache.get(cacheKey);
      let result: { ok: boolean; output: string; error?: string };
      if (cached && cached.ok) {
        const warning = `[重复调用警告] 工具 ${tc.name} 用相同参数之前已成功执行过，以下是缓存的结果。请不要重复调用相同工具，直接利用已有信息推进任务。\n`;
        result = { ok: true, output: warning + cached.output };
        await ctx.eventLog.append('tool.result', { name: tc.name, ok: true, output: result.output.slice(0, 500) });
        this.deps.onEvent?.({ type: 'tool.result', name: tc.name, ok: true, output: result.output.slice(0, 500) });
      } else {
        result = await ctx.tools.execute(tc.name, tc.arguments, {
          runId: ctx.session.runId,
          cwd: ctx.cwd,
          security: ctx.security,
          approve: ctx.approve,
          guard: ctx.guard,
        });
        // 成功结果写入缓存（失败的不缓存，允许模型重试修复）
        if (result.ok) {
          this.toolResultCache.set(cacheKey, { ok: result.ok, output: result.output, error: result.error });
        }
        await ctx.eventLog.append('tool.result', {
          name: tc.name,
          ok: result.ok,
          output: result.output.slice(0, 500),
        });
        this.deps.onEvent?.({ type: 'tool.result', name: tc.name, ok: result.ok, output: result.output.slice(0, 500) });
      }
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
    // classifyError 现在对未匹配错误返回 'unknown' 兜底，永不返回 null，
    // 确保达到 maxRetryErrors 时 failed 分支一定能 break，不会被绕过。
    const errorAnalysis = classifyError(lastToolMsg.content || '', '');
    // 从消息历史中提取最后一次工具调用（工具名+参数），用于生成更精准的反思提示
    let lastToolCall: { name: string; args: Record<string, unknown> } | undefined;
    for (let i = messages.length - 2; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const tc = m.toolCalls[m.toolCalls.length - 1];
        lastToolCall = { name: tc.name, args: tc.arguments ?? {} };
        break;
      }
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
    const newMessages = injectReflection(messages, errorAnalysis, input.goal, lastToolCall);
    await input.eventLog.append('self-heal', { category: errorAnalysis.category, iteration: input.iteration });
    this.deps.onEvent?.({ type: 'self-heal', category: errorAnalysis.category, iteration: input.iteration });
    logger.info('self-heal: injected reflection', { iteration: input.iteration, category: errorAnalysis.category });
    return { signal: 'continue', messages: newMessages, consecutiveErrors, selfHealed, finalAnswer: '' };
  }
}

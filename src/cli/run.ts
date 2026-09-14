/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 运行装配：把模型路由、工具、运行时、编排器组装成一次任务执行。
 * 无 API key 时自动进入离线模式（ScriptedMockProvider 驱动闭环验证）。
 *
 * M3 增强：会话检查点持久化 + resume/diff/rollback 管理命令 + 交互式审批。
 */
import { randomUUID, createHmac } from 'crypto';
import { Agent as HttpsAgent } from 'https';
import { spawn, execFile } from 'child_process';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, readdirSync, type Dirent } from 'fs';
import { tmpdir, homedir, platform, release, arch, uptime, totalmem, freemem, cpus } from 'os';
import { join, dirname, sep } from 'path';
import { createInterface } from 'readline';
import { setRunId, logger } from '../shared/logger';
import { t } from '../shared/i18n';
import { loadConfig, loadConfigFile, resolveHomeDir } from '../shared/config';
import { AppError } from '../shared/errors';
import { ModelRouter } from '../models/model-router';
import { ScriptedMockProvider, type MockStep } from '../models/providers/mock.provider';
import { OpenAICompatibleProvider } from '../models/providers/openai-compatible.provider';
import { OllamaProvider } from '../models/providers/ollama.provider';
import { createDefaultRegistry } from '../tools';
import { attachMcpTools, closeMcpClients } from '../tools/mcp';
import { attachDesktopTools } from '../tools/desktop';
import type { McpClient } from '../tools/mcp/mcp-client';
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
import {
  createEnterpriseRuntime,
  isEnterpriseEnabled,
  assertQuota,
  renderWhoami,
  renderPolicy,
  readAudit,
  verifyAudit,
  listTenants,
  type EnterpriseRuntime,
} from '../enterprise';
import { startWebServer } from '../web/server';
import { scheduleDailySummary } from '../memory/auto-summarize';
import { scheduleSelfHeal, runSelfHealIfDue } from '../self-evolve/self-heal-scheduler';
import { installPlugin, listPlugins } from '../plugins/plugin-loader';
import { runTeam } from '../agent/team';
import { fetchMarketIndex, searchMarket, installMarketSkill, isSchemaSupported } from '../skills/skill-market';
import { discoverSkills } from '../skills/skill-loader';
import { registerPuaHooks } from '../skills/pua-hooks';
import { runSkillHooks } from '../runtime/hooks';
import { Orchestrator, type OrchestratorSecurity, type OrchestratorEvent, type ResumeContext } from '../agent/orchestrator';
import type { ChatMessage } from '../models/model.interface';
import { runParallel, defaultParallelMock } from '../agent/parallel-orchestrator';
import { runPlan } from '../skills/plan';
import { runGrill } from '../skills/grill';
import { decomposeGoalToGoal, saveGoal, renderGoal } from '../skills/goal';
import { runSelfHeal } from '../skills/self-heal';
import { listExperiences, type Experience } from '../agent/experience';
import { createCodeWriter } from '../agent/code-writer';
import { createQualityGate } from '../agent/quality-gate';
import { createSelfImprover } from '../agent/self-improver';
import { runSweAgent, type SweReport, type SubTaskOutcome } from '../agent/swe-agent';
import { summarizeSubTaskAnswer } from '../agent/subagent-summary';
import { Harness } from '../harness/harness';
import { SwebenchLoader } from '../harness/loader';
import { MockOrchestratorExecutor, RealModelExecutor } from '../harness/executor';
import { FileExistsVerifier, TestVerifier } from '../harness/verifier';
import { MarkdownReporter, JsonReporter } from '../harness/reporter';

export interface RunOptions {
  offline?: boolean;
  approve?: (action: string) => Promise<boolean>;
  /** P0-1：流式输出（编排器事件增量渲染到 stdout） */
  stream?: boolean;
  /** P3-1：自定义事件渲染器（TUI 用），优先于 stream */
  renderer?: (ev: OrchestratorEvent) => void;
  /** 指定模型列表（由 Web 控制台传入，直接构建 ModelRouter，绕过 loadConfig 缓存） */
  modelProviders?: Array<{ id: string; type: 'openai-compatible' | 'ollama'; baseURL: string; apiKey?: string; model?: string }>;
  /** 指定模型名（如 deepseek-ai/DeepSeek-V4-Flash），覆盖默认模型选择 */
  model?: string;
  /** 安全配置（Web 控制台可覆盖默认值） */
  security?: Partial<OrchestratorSecurity>;
  /** M3 多轮续接：携带上一轮完整对话与计数，在同一任务内继续对话（Web 控制台任务续接用） */
  resume?: ResumeContext;
  /** Web 控制台：指定任务的工作目录（不传则用 process.cwd()） */
  workspaceDir?: string;
  /** P9：外部中断信号（任务停止按钮），触发即终止编排循环与进行中的模型请求 */
  signal?: AbortSignal;
  /** 用户本轮上传的附件路径列表（截图/文件/图片），执行层可读取 */
  attachments?: string[];
  /** P3-1：文件写入暂存回调（注入 change-manager.stageChange），AI 生成的修改自动记录到变更面板 */
  stageChange?: (path: string, content: string) => void;
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

/* ===================== M4：企业运行时（惰性单例） ===================== */

let enterpriseRt: EnterpriseRuntime | null = null;

/** 获取企业运行时（租户/策略/审计/配额）。FH_ENTERPRISE=false 时返回 null（退化为 M3 行为） */
export function getEnterprise(): EnterpriseRuntime | null {
  if (!isEnterpriseEnabled()) return null;
  if (!enterpriseRt) enterpriseRt = createEnterpriseRuntime();
  return enterpriseRt;
}

/**
 * 会话家目录：与 EventLog 同目录，便于 list/load/resume 统一定位。
 * M4 起按租户隔离；离线且未显式设置 FH_HOME 时仍走临时目录，避免污染用户环境。
 */
function getSessionHome(offline: boolean): string {
  if (offline && !process.env.FH_HOME) return join(tmpdir(), 'fhcode-demo-logs');
  const rt = getEnterprise();
  if (rt) return rt.tenant.sessionDir;
  const home = process.env.FH_HOME ? expandHome(process.env.FH_HOME) : joinHome();
  return join(home, 'sessions');
}

/** 流式输出：只展示模型的思考内容，不展示工具调用等技术细节，让普通人看懂。 */
function renderStreamEvent(ev: OrchestratorEvent): void {
  switch (ev.type) {
    case 'model.response':
      // 有思考内容就完整打印，这是用户最关心的部分
      if (ev.content.trim()) {
        console.log(ev.content.trim());
        console.log('');
      }
      // 纯工具调用没有思考文本时，不输出任何东西，避免噪音
      break;
    case 'tool.call':
    case 'tool.result':
      // 工具调用和结果不展示，用户不需要知道内部在调什么工具
      break;
    case 'self-heal':
      console.log('刚才遇到点小问题，我调整一下思路再试试。');
      console.log('');
      break;
    case 'context.compact':
      // 上下文压缩是内部机制，不打扰用户
      break;
    case 'session.end':
      // 结束状态不单独打印，最终答案会在 runGoal 里输出
      break;
  }
}

/** 流式输出事件渲染器（供 runGoal / runSwe 复用） */
export function streamRenderer(): (ev: OrchestratorEvent) => void {
  return renderStreamEvent;
}

/**
 * P4-1 服务端可复用执行函数：装配编排器并执行目标，返回结构化结果。
 * 不打印任何 console 输出（供 Web 任务队列等非 CLI 场景调用）。
 * runGoal 在其上叠加展示层。
 */
export async function executeTask(goal: string, opts: RunOptions = {}): Promise<{
  ok: boolean;
  finalAnswer: string;
  iterations: number;
  costUsd: number;
  logFile: string;
  runId: string;
  selfHealed?: boolean;
  experiencesExtracted?: number;
  /** M3 多轮续接：本轮执行后的完整消息历史（供下一轮 resume 使用） */
  messages?: ChatMessage[];
}> {
  const runId = randomUUID();
  setRunId(runId);

  const security: OrchestratorSecurity = { shellAllowlist: [], requireApproval: true };
  const offline = opts.offline ?? isOfflineByDefault();

  // Web 控制台可传入安全配置覆盖默认值
  if (opts.security) {
    security.shellAllowlist = opts.security.shellAllowlist ?? security.shellAllowlist;
    security.requireApproval = opts.security.requireApproval ?? security.requireApproval;
    security.sandboxMode = opts.security.sandboxMode ?? security.sandboxMode;
  }

  // M4：企业上下文（租户隔离 / RBAC / 审计 / 配额），配额超限在此 fail-fast
  const rt = getEnterprise();
  if (rt) assertQuota(rt);

  // 离线模式用临时工作区，避免污染用户目录；并 git init 以支持 diff/rollback 演示
  const targetCwd = opts.workspaceDir || process.cwd();
  const cwd = offline ? mkdtempSync(join(tmpdir(), 'fhcode-demo-')) : targetCwd;
  if (offline) {
    await runCommand('git init -q', cwd).catch(() => undefined);
  }
  // 注意：不再使用 process.chdir(targetCwd) —— 所有工具通过 ctx.cwd 显式传参，
  // 全局切换 cwd 会导致并发任务互相覆盖工作目录。移除后可安全提高并发数。

  let router: ModelRouter;
  let pluginSkillDirs: string[] = [];
  // Web 控制台直接注入模型配置（绕过 loadConfig 缓存）
  if (opts.modelProviders && opts.modelProviders.length > 0) {
    const providers = opts.modelProviders.map((p) =>
      p.type === 'ollama' ? new OllamaProvider({ id: p.id, type: 'ollama', baseURL: p.baseURL, model: p.model || 'default', tags: ['code-gen', 'reasoning'] }) : new OpenAICompatibleProvider({ id: p.id, type: 'openai-compatible', baseURL: p.baseURL, model: p.model || 'gpt-4o', apiKey: p.apiKey, tags: ['code-gen', 'reasoning'] }),
    );
    router = new ModelRouter(providers, 'cost', 0);
  } else if (offline) {
    router = new ModelRouter([new ScriptedMockProvider(buildDemoSteps())], 'cost', 0);
  } else {
    const cfg = loadConfig();
    // --model 覆盖：只保留指定模型对应的 provider，其余一律排除（用户显式指定时不做自动轮换）
    if (opts.model) {
      const matched = cfg.models.providers.filter((p) => p.model === opts.model);
      if (matched.length === 0) {
        throw new AppError(
          `未找到模型 ${opts.model}，请检查 FH_PROVIDERS / fhcode.config.json 中的 model 配置`,
          'MODEL_NOT_FOUND',
          400,
        );
      }
      router = ModelRouter.fromConfig({ ...cfg, models: { ...cfg.models, providers: matched } });
    } else {
      router = ModelRouter.fromConfig(cfg);
    }
    security.shellAllowlist = cfg.security.shellAllowlist;
    security.requireApproval = cfg.security.requireApproval;
    security.sandboxMode = cfg.security.sandboxMode;
    security.networkRules = { networkAllow: cfg.security.networkAllow, networkDeny: cfg.security.networkDeny };
    security.hooks = cfg.hooks;
    pluginSkillDirs = cfg.plugins.skillDirs;
  }

  const tools = createDefaultRegistry();
  // P0-3：附加 MCP 外部工具（真实模式且有配置时）
  let mcpClients: McpClient[] = [];
  if (!offline) {
    const cfg = loadConfig();
    mcpClients = await attachMcpTools(tools, cfg.mcp.servers);
    attachDesktopTools(tools, mcpClients);
  }
  const logDir = getSessionHome(offline);
  const eventLog = new EventLog(runId, logDir);
  const session = new SessionStore(runId, cwd);

  // M3 多轮续接：把上一轮历史消息补入会话，使 session.snapshot() 返回完整对话（供下一轮 resume 持久化）
  if (opts.resume && opts.resume.messages.length > 0) {
    for (const m of opts.resume.messages) session.append(m);
  }

  // 用户附件上下文：把本轮附件路径以系统提示形式注入到本次目标的前缀，
  // 让模型知道有哪些文件可读取；具体处理由 LLM 决定（如读取图片/读文件等）。
  let effectiveGoal = goal;
  if (opts.attachments && opts.attachments.length > 0) {
    const list = opts.attachments.map((p, i) => `  ${i + 1}. ${p}`).join('\n');
    effectiveGoal =
      `[用户附件] 本轮上传了 ${opts.attachments.length} 个文件，请按需读取：\n${list}\n\n` +
      goal;
  }

  const approve =
    opts.approve ??
    (process.stdin.isTTY ? interactiveApprover() : defaultApproverFor(security));

  const guard = rt
    ? rt.makeGuard({ runId, cwd, shellAllowlist: security.shellAllowlist, approve })
    : undefined;

  // P2-1：SessionStart hooks（注册 pua-ext 等技能 hooks，获取系统提示注入）
  registerPuaHooks();
  const sessionStartResult = await runSkillHooks('SessionStart', {
    cwd,
    runId,
    goal: effectiveGoal,
  });
  const extraSystemPrompt = sessionStartResult.systemInjection;
  if (extraSystemPrompt) {
    logger.info('session start hooks injected system prompt', { chars: extraSystemPrompt.length });
  }

  const orchestrator = new Orchestrator({
    router,
    tools,
    eventLog,
    session,
    cwd,
    security,
    approve,
    guard,
    maxCostUsd: rt?.maxCostUsd ?? 0,
    persist: (cp: SessionCheckpoint) => saveCheckpoint(logDir, cp),
    onEvent: opts.renderer ?? (opts.stream ? streamRenderer() : undefined),
    pluginSkillDirs,
    signal: opts.signal,
    stageChange: opts.stageChange,
    extraSystemPrompt,
  });

  if (rt) {
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId,
      action: 'session:start',
      resource: goal,
      decision: 'info',
      reason: offline ? '离线模式' : '真实模式',
    });
  }

  try {
    const result = await orchestrator.run(effectiveGoal, opts.resume);
    if (rt) {
      rt.audit.record({
        tenantId: rt.tenant.tenantId,
        userId: rt.tenant.userId,
        role: rt.tenant.role,
        runId,
        action: 'session:end',
        resource: `iterations=${result.iterations}`,
        decision: 'info',
        reason: `cost=$${result.costUsd.toFixed(6)}`,
      });
    }
    // M3 多轮续接：把本轮完整消息历史带回调用方（任务队列持久化后供下一轮 resume）
    const history = session.snapshot().messages;
    return { ...result, messages: history };
  } finally {
    // P0-3：任务结束关闭 MCP 子进程
    await closeMcpClients(mcpClients);
  }
}

export async function runGoal(goal: string, opts: RunOptions = {}): Promise<void> {
  const result = await executeTask(goal, opts);
  const offline = opts.offline ?? isOfflineByDefault();

  // 只输出最终答案，不打印迭代数、成本、日志路径等技术信息
  if (result.finalAnswer.trim()) {
    console.log('');
    console.log(result.finalAnswer.trim());
    console.log('');
  }

  if (offline) {
    const demoFile = join(process.cwd(), 'demo-output.txt');
    logger.info('offline-run done', { cwd: process.cwd(), demoFile });
    if (existsSync(demoFile)) {
      console.log(t('run.offlineFileYes', { file: demoFile }));
    }
  }
}

/** 默认是否离线：未配置 FH_PROVIDERS 或为空数组时离线 */
export function isOfflineByDefault(): boolean {
  // M9.1 实测修复：此前仅看 FH_PROVIDERS，导致文档示例「单环境变量快速接入」
  // （FH_MODEL_NAME=... FH_MODEL_TYPE=ollama）实际仍落入离线 mock，真实模型接不进来。
  if (process.env.FH_OFFLINE === 'true') return true;
  if (process.env.FH_OFFLINE === 'false') return false;
  // 任一真实模型接入方式存在即进入真实模式
  if (process.env.FH_PROVIDERS || process.env.FH_MODEL_NAME) return false;
  try {
    const cfg = loadConfigFile();
    if (cfg?.models?.providers && cfg.models.providers.length > 0) return false;
  } catch {
    /* 配置文件缺失/损坏忽略 */
  }
  return true;
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

/**
 * M1.1a `fhcode review [路径] [--json]`：红队式代码审查的结构化版本。
 *  - 文本模式：与 /grill 输出一致（人类可读）
 *  - --json 模式：输出完整结构（scanned/findings/summary），供 IDE 内联评审等消费
 */
export function runReviewCmd(path: string, asJson: boolean): void {
  const result = runGrill(process.cwd(), path || '.');
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`【review】${result.summary}`);
  for (const f of result.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.file}:${f.line} (${f.rule}) ${f.detail}`);
  }
  if (result.findings.length === 0) console.log('  未发现明显问题。');
}

/** /goal 技能：分解并保存高层目标（M4 起写入租户隔离目录 tenants/<id>/goals） */
export function runGoalSkill(title: string): string {
  const goal = decomposeGoalToGoal(title);
  const rt = getEnterprise();
  // saveGoal 内部会拼接 goals 子目录，这里给它租户根目录
  const home = rt
    ? dirname(rt.tenant.goalDir)
    : process.env.FH_HOME
      ? expandHome(process.env.FH_HOME)
      : joinHome();
  const file = saveGoal(goal, home);
  if (rt) {
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId: goal.id,
      action: 'skill:goal',
      resource: title,
      decision: 'info',
      reason: `保存至 ${file}`,
    });
  }
  return `【/goal】已保存\n${renderGoal(goal)}\n文件: ${file}`;
}

/** /self-heal 技能：系统化自我修复错误（分类 → 根因 → 修复建议 → 验证步骤） */
export function runSelfHealSkill(errorText: string): string {
  const out = runSelfHeal(errorText);
  if (getEnterprise()) {
    // 审计留痕（脱敏由 audit.ts 处理），便于追溯自愈诊断过程
    try {
      const rt = getEnterprise();
      if (rt) {
        rt.audit.record({
          tenantId: rt.tenant.tenantId,
          userId: rt.tenant.userId,
          role: rt.tenant.role,
          runId: randomUUID(),
          action: 'skill:self-heal',
          resource: out.category,
          decision: out.known ? 'info' : 'deny',
          reason: out.known ? '自动分类完成' : '未能自动分类，需人工介入',
        });
      }
    } catch {
      /* 审计失败不阻断技能输出 */
    }
  }
  return out.text;
}

/** --parallel 并行多子代理执行（离线用 Mock；真实模式接入 FH_PROVIDERS 路由） */
export async function runParallelGoal(goal: string): Promise<void> {
  const offline = isOfflineByDefault();
  console.log(t('run.parallelMode', { offline: offline ? t('run.modeOffline') : t('run.modeLive') }));

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
    console.log('\n' + t('run.parallelResult'));
    console.log(result.summary);
    console.log(t('run.parallelRepo', { root: result.repoRoot, trees: result.worktrees.length }));
    return;
  }

  const result = await runParallel(goal, {
    offline: true,
    mockFor: (task) => defaultParallelMock(task),
  });
  console.log('\n' + t('run.parallelResult'));
  console.log(result.summary);
  console.log(t('run.parallelRepo', { root: result.repoRoot, trees: result.worktrees.length }));
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
    console.log(t('run.noSessions'));
    return;
  }
  console.log(t('run.sessionList', { mode: offline ? t('mode.offline') : t('mode.live'), home }));
  for (const cp of cps) {
    console.log(
      t('run.sessionItem', {
        id: cp.runId.slice(0, 8),
        status: cp.status,
        iter: cp.iterations,
        cost: '$' + cp.costUsd.toFixed(6),
        files: cp.touchedFiles.length,
        time: cp.updatedAt,
      }),
    );
    console.log(t('run.sessionGoal', { goal: cp.goal }));
  }
}

/** 从检查点恢复中断的会话并续跑 */
export async function runResume(runId: string): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  const cp = await resolveCheckpoint(home, runId);
  if (cp.status === 'done') {
    console.log(t('run.resumeDone', { id: runId.slice(0, 8) }));
    return;
  }
  console.log(t('run.resumeStart', { id: runId.slice(0, 8), status: cp.status, iter: cp.iterations }));

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
  // 用完整 runId 建日志（入参可能只是 8 位前缀），保证事件与检查点同名可对齐
  const eventLog = new EventLog(cp.runId, home);
  const session = SessionStore.restore(cp);
  const approve = process.stdin.isTTY ? interactiveApprover() : defaultApproverFor(security);

  const rt = getEnterprise();
  if (rt) assertQuota(rt);
  const guard = rt
    ? rt.makeGuard({
        runId: cp.runId,
        cwd: cp.cwd,
        shellAllowlist: security.shellAllowlist,
        approve,
      })
    : undefined;

  const orchestrator = new Orchestrator({
    router,
    tools,
    eventLog,
    session,
    cwd: cp.cwd,
    security,
    approve,
    guard,
    maxCostUsd: rt?.maxCostUsd ?? 0,
    persist: (c: SessionCheckpoint) => saveCheckpoint(home, c),
  });

  const result = await orchestrator.run(cp.goal, {
    messages: cp.messages,
    iterations: cp.iterations,
    costUsd: cp.costUsd,
    touchedFiles: cp.touchedFiles,
  });

  if (result.finalAnswer.trim()) {
    console.log('');
    console.log(result.finalAnswer.trim());
    console.log('');
  }
}

/** 展示会话作用域的 diff（缺省为本工作区全量 diff） */
export async function runDiff(id?: string): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  if (id) {
    const cp = await resolveCheckpoint(home, id);
    console.log(t('run.diffSession', { id: id.slice(0, 8), cwd: cp.cwd }));
    console.log(await gitDiff(cp.cwd, cp.touchedFiles));
  } else {
    console.log(t('run.diffCwd', { cwd: process.cwd() }));
    console.log(await gitDiff(process.cwd()));
  }
}

/** 回滚会话 touchedFiles（破坏性，需 --yes） */
export async function runRollback(id: string, yes: boolean): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  const cp = await resolveCheckpoint(home, id);

  // M4：回滚是破坏性动作，viewer 角色一律禁止，且无论成败都留痕
  const rt = getEnterprise();
  if (rt) {
    const allowed = rt.tenant.role !== 'viewer';
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId: cp.runId,
      action: 'session:rollback',
      resource: cp.touchedFiles.join(', ') || '(无文件)',
      decision: allowed ? (yes ? 'allow' : 'rejected') : 'deny',
      reason: allowed ? (yes ? '已确认 --yes' : '缺少 --yes 确认') : '角色 viewer 无回滚权限',
    });
    if (!allowed) {
      throw new AppError('角色 viewer 无权执行回滚操作', 'RBAC_DENIED', 403);
    }
  }

  console.log(t('run.rollbackStart', { id: id.slice(0, 8), n: cp.touchedFiles.length, cwd: cp.cwd }));
  const res = await gitRollback(cp.cwd, cp.touchedFiles, { yes });
  if (res.reverted.length) console.log(t('run.rollbackReverted', { files: res.reverted.join(', ') }));
  if (res.removed.length) console.log(t('run.rollbackRemoved', { files: res.removed.join(', ') }));
  if (res.errors.length) console.log(t('run.rollbackNote', { errors: res.errors.join('; ') }));
  if (yes) await updateStatus(home, id, 'done');
}

/* ===================== M4：企业管理命令 ===================== */

function requireEnterprise(): EnterpriseRuntime {
  const rt = getEnterprise();
  if (!rt) {
    throw new AppError(
      t('err.enterpriseDisabled'),
      'ENTERPRISE_DISABLED',
      400,
    );
  }
  return rt;
}

/** fhcode whoami：展示当前租户/用户/角色/隔离目录/配额 */
export function runWhoami(): void {
  console.log(renderWhoami(requireEnterprise()));
}

/** fhcode policy：展示生效策略与角色矩阵 */
export function runPolicyCmd(): void {
  const rt = requireEnterprise();
  console.log(renderPolicy(rt.policy, rt.tenant.role));
}

/** fhcode audit [--limit N]：查看审计记录（默认最近 20 条） */
export function runAudit(limit = 20): void {
  const rt = requireEnterprise();
  const all = readAudit(rt.tenant.auditDir);
  if (all.length === 0) {
    console.log(t('audit.empty', { tenant: rt.tenant.tenantId, dir: rt.tenant.auditDir }));
    return;
  }
  const rows = all.slice(-limit);
  console.log(t('audit.header', { rows: rows.length, all: all.length, tenant: rt.tenant.tenantId }));
  for (const r of rows) {
    console.log(
      t('audit.row', {
        seq: String(r.seq).padStart(4, '0'),
        ts: r.ts,
        decision: r.decision.toUpperCase(),
        action: r.action,
        user: r.userId,
        role: r.role,
        run: String(r.runId).slice(0, 8),
      }),
    );
    console.log(t('audit.resource', { resource: r.resource }));
    if (r.reason) console.log(t('audit.reason', { reason: r.reason }));
  }
  console.log(t('audit.chainTail', { hash: all[all.length - 1].hash.slice(0, 16) }));
}

/** fhcode audit verify：校验哈希链完整性 */
export function runAuditVerify(): void {
  const rt = requireEnterprise();
  const res = verifyAudit(rt.tenant.auditDir);
  if (res.ok) {
    console.log(t('audit.verifyOk', { total: res.total }));
    return;
  }
  console.log(t('audit.verifyFail', { total: res.total, brokenAt: res.brokenAt ?? 0 }));
  console.log(`   ${res.detail}`);
  process.exitCode = 2;
}

/** fhcode tenants：列出全部租户与用量 */
export function runTenants(): void {
  requireEnterprise();
  const list = listTenants();
  if (list.length === 0) {
    console.log(t('tenants.empty'));
    return;
  }
  console.log(t('tenants.header'));
  console.log(t('tenants.tableHeader'));
  for (const tenant of list) {
    console.log(
      t('tenants.row', {
        id: tenant.tenantId.padEnd(20),
        sessions: String(tenant.sessions).padStart(5),
        cost: '$' + tenant.costUsd.toFixed(6).padStart(10),
        audit: String(tenant.auditRecords).padStart(7),
        last: tenant.lastActiveAt,
      }),
    );
  }
}

/* ===================== M6：自我进化 ===================== */

/** 探测 baseURL 连通性：任何 HTTP 响应（含 4xx/5xx）都视为可达，连接失败视为不可达 */
async function probeUrl(base: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(base.replace(/\/+$/, ''), { method: 'GET', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fhcode doctor：环境自检（版本 / git / 配置 / provider / 路径可写 / 网络连通）。
 * 全部通过输出 ✅，异常项以 ⚠️ 列明，帮助快速定位接入问题。
 */
export async function runDoctor(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. Node 版本（engines >= 18）
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: t('doctor.node'),
    ok: nodeMajor >= 18,
    detail: `Node ${process.version}（要求 >=18）`,
  });

  // 2. git 可用性（diff/rollback/并行 worktree 依赖）
  const git = await runCommand('git --version', process.cwd(), 5000).catch(() => null);
  checks.push({
    name: t('doctor.git'),
    ok: !!git && git.code === 0,
    detail: git && git.code === 0 ? (git.stdout || git.stderr).trim() : t('doctor.gitMissing'),
  });

  // 3. 配置加载 + provider 明细 + 网络连通
  try {
    const cfg = loadConfig();
    if (cfg.models.providers.length === 0) {
      checks.push({ name: t('doctor.config'), ok: true, detail: t('doctor.configEmpty') });
    } else {
      checks.push({ name: t('doctor.config'), ok: true, detail: `${cfg.models.providers.length} providers` });
      for (const p of cfg.models.providers) {
        checks.push({
          name: `${t('doctor.provider')} ${p.id}`,
          ok: !!p.baseURL,
          detail: `${p.type} @ ${p.baseURL || '（缺 baseURL）'}${p.model ? ` · model=${p.model}` : ''}`,
        });
      }
    }
    // 网络探测：仅真实模式且有 provider 时执行；离线模式直接跳过
    if (!isOfflineByDefault() && cfg.models.providers.length > 0) {
      const base = cfg.models.providers[0].baseURL;
      if (base) {
        const reachable = await probeUrl(base);
        checks.push({
          name: t('doctor.network'),
          ok: reachable,
          detail: reachable ? `${base} 可达` : `${base} 不可达`,
        });
      }
    } else {
      checks.push({ name: t('doctor.network'), ok: true, detail: t('doctor.networkOffline') });
    }
  } catch (e) {
    checks.push({
      name: t('doctor.config'),
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. 主目录可写（会话/审计/经验/统计落盘依赖）
  const homeDir = resolveHomeDir();
  let homeOk = true;
  let homeDetail = homeDir;
  try {
    mkdirSync(homeDir, { recursive: true });
    const probe = join(homeDir, '.doctor-probe');
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
  } catch (e) {
    homeOk = false;
    homeDetail = `${homeDir}（${e instanceof Error ? e.message : String(e)}）`;
  }
  checks.push({ name: t('doctor.home'), ok: homeOk, detail: homeDetail });

  // 5. 沙箱模式（P0-2）
  try {
    const cfg = loadConfig();
    const sandboxDetail =
      `${cfg.security.sandboxMode}` +
      (cfg.security.networkDeny.length > 0 ? ` · deny: ${cfg.security.networkDeny.join(',')}` : '') +
      (cfg.security.networkAllow.length > 0 ? ` · allow: ${cfg.security.networkAllow.join(',')}` : '');
    checks.push({ name: t('doctor.sandbox'), ok: true, detail: sandboxDetail });
  } catch {
    checks.push({ name: t('doctor.sandbox'), ok: false, detail: t('doctor.sandboxUnavailable') });
  }

  // 6. Docker 沙箱档位探测（P5-4 container 模式执行层依赖）
  try {
    const docker = await runCommand('docker --version', process.cwd(), 5000).catch(() => null);
    const dockerOk = !!docker && docker.code === 0;
    const cfg6 = loadConfig();
    const mode = cfg6.security.sandboxMode;
    checks.push({
      name: t('doctor.docker'),
      ok: mode !== 'container' || dockerOk, // container 模式下必须可用；其他模式仅为提示
      detail: dockerOk
        ? `${(docker?.stdout || docker?.stderr || 'docker 可用').trim()} · sandbox=${mode}`
        : `docker 不可用（container 沙箱模式无法执行）· sandbox=${mode}`,
    });
  } catch {
    checks.push({ name: t('doctor.docker'), ok: true, detail: 'docker 探测跳过' });
  }

  // 输出
  console.log(t('doctor.title'));
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`  ${c.ok ? '✅' : '⚠️'} ${c.name}: ${c.detail}`);
  }
  console.log(failed.length === 0 ? t('doctor.allOk') : t('doctor.issues', { n: failed.length }));
}

/** `fhcode skill-new <name> [--template <id>] [--global]`：从官方模板脚手架生成 Skill（P0-3 生态） */
export async function runSkillNewCmd(name: string, opts: { template?: string; global?: boolean } = {}): Promise<void> {
  const templateId = opts.template ?? 'code-review';
  const templateDir = join(__dirname, '../../templates/skills', templateId);
  if (!existsSync(templateDir)) {
    console.error(`模板不存在: ${templateId}（可选：code-review/git-flow/api-design/refactor/test-gen/doc-gen/security-audit/performance/dependency-upgrade/onboarding）`);
    process.exitCode = 1;
    return;
  }
  if (!name || /[\\/:*?"<>|]/.test(name)) {
    console.error('Skill 名称非法（不能含 \\/:*?"<>| 且不能为空）');
    process.exitCode = 1;
    return;
  }
  const base = opts.global
    ? join(resolveHomeDir(), '.feihong-code', 'skills')
    : join(process.cwd(), '.fhcode', 'skills');
  const target = join(base, name);
  if (existsSync(target)) {
    console.error(`已存在: ${target}`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(target, { recursive: true });
  const src = readFileSync(join(templateDir, 'SKILL.md'), 'utf8');
  const rendered = src.replace(/{{SKILL_NAME}}/g, name);
  writeFileSync(join(target, 'SKILL.md'), rendered, 'utf8');
  console.log(`✓ 已创建 Skill: ${target}`);
  console.log(`  模板: ${templateId}（可直接编辑 SKILL.md 定制）`);
}

/* ===================== P3-3：插件管理 ===================== */
/** fhcode plugin install <source> / plugin list：插件打包分发管理 */
export async function runPluginCmd(action: 'install' | 'list', source?: string): Promise<void> {
  if (action === 'install') {
    if (!source) {
      console.error(t('plugin.installUsage'));
      return;
    }
    try {
      const { name, dir } = await installPlugin(source);
      console.log(t('plugin.installed', { name, dir }));
    } catch (e) {
      console.error(t('plugin.installFailed') + (e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
    }
    return;
  }
  // list
  const plugins = listPlugins(process.cwd());
  if (plugins.length === 0) {
    console.log(t('plugin.empty'));
    return;
  }
  console.log(t('plugin.listTitle'));
  for (const p of plugins) {
    console.log(`  ${p.name.padEnd(24)} v${p.version}  ${p.description ?? ''}`);
  }
}

/* ===================== P4-2：Agent teams ===================== */

/** fhcode team "<目标>"：多 agent 协作执行（共享任务清单 + 消息总线） */
export async function runTeamCmd(goal: string): Promise<void> {
  const offline = isOfflineByDefault();
  console.log(t('team.start', { mode: offline ? t('run.modeOffline') : t('run.modeLive') }));

  // 目标拆解为任务清单（复用 planner 的并列连词拆分；拆不开则单任务）
  const { decomposeGoal } = await import('../agent/planner');
  const tasks = decomposeGoal(goal).map((t) => t.goal);
  if (tasks.length === 0) tasks.push(goal);

  const report = await runTeam(tasks, {
    runSubTask: async (focusedGoal) => {
      const result = await executeTask(focusedGoal, { offline });
      return { ok: result.ok, finalAnswer: result.finalAnswer, iterations: result.iterations };
    },
    pollIntervalMs: offline ? 0 : 100,
  });

  console.log('\n' + t('team.reportTitle'));
  console.log(report.summary);
}

/* ===================== Skills 市场 ===================== */

/** 默认市场源（agentskills.io 官方规范端点；可用 --repo 或 FH_SKILL_MARKET 覆盖） */
const DEFAULT_MARKET = process.env.FH_SKILL_MARKET || 'https://agentskills.io';

/** fhcode skill-market search <关键词> | install <技能名> | list */
export async function runSkillMarketCmd(action: 'search' | 'install' | 'list', query?: string, market?: string): Promise<void> {
  const base = market || DEFAULT_MARKET;

  if (action === 'list') {
    // 列出本地已安装技能（复用技能发现，含打包/仓库/用户级）
    const skills = discoverSkills(process.cwd());
    if (skills.length === 0) {
      console.log(t('skillMarket.localEmpty'));
      return;
    }
    console.log(t('skillMarket.localTitle', { n: skills.length }));
    for (const s of skills) {
      console.log(`  ${s.name.padEnd(24)} ${s.description.slice(0, 60)}`);
    }
    return;
  }

  // search / install 需拉索引；网络不可达时回退本地种子源（P4-3）
  let index;
  try {
    index = await fetchMarketIndex(base);
  } catch (e) {
    const localSeed = join(__dirname, '../../templates/market/index.json');
    if (existsSync(localSeed)) {
      try {
        index = JSON.parse(readFileSync(localSeed, 'utf8'));
        index.source = 'local:seed';
        console.log(t('skillMarket.localSeed'));
      } catch {
        console.error(t('skillMarket.fetchFailed', { base }) + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
        return;
      }
    } else {
      console.error(t('skillMarket.fetchFailed', { base }) + (e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
      return;
    }
  }
  if (!isSchemaSupported(index.schema)) {
    console.warn(t('skillMarket.schemaWarn', { schema: index.schema ?? '?' }));
  }

  if (action === 'search') {
    const results = searchMarket(index, query ?? '');
    if (results.length === 0) {
      console.log(t('skillMarket.searchEmpty', { q: query ?? '' }));
      return;
    }
    console.log(t('skillMarket.searchTitle', { q: query ?? '', n: results.length, base }));
    for (const s of results) {
      console.log(`  ${s.name.padEnd(28)} [${s.type}] ${s.description.slice(0, 70)}`);
    }
    console.log(t('skillMarket.installHint'));
    return;
  }

  // install
  if (!query) {
    console.error(t('skillMarket.installUsage'));
    process.exitCode = 1;
    return;
  }
  const skill = index.skills.find((s: { name: string }) => s.name === query);
  if (!skill) {
    console.error(t('skillMarket.notFound', { name: query }));
    process.exitCode = 1;
    return;
  }
  const destDir = join(resolveHomeDir(), 'skills');
  try {
    // P4-3: 本地种子源（url 以 local: 开头）→ 直接从官方模板复制，不依赖网络
    if (skill.url.startsWith('local:')) {
      const tid = skill.url.slice('local:'.length);
      const tdir = join(__dirname, '../../templates/skills', tid);
      if (!existsSync(tdir)) {
        console.error(t('skillMarket.notFound', { name: skill.name }));
        process.exitCode = 1;
        return;
      }
      const target = join(destDir, skill.name);
      mkdirSync(target, { recursive: true });
      copyFileSync(join(tdir, 'SKILL.md'), join(target, 'SKILL.md'));
      console.log(t('skillMarket.installed', { name: skill.name, dir: target }));
    } else {
      const target = await installMarketSkill(index, skill, destDir);
      console.log(t('skillMarket.installed', { name: skill.name, dir: target }));
    }
    // P5-3: 自动注册闭环——安装后立即用 discoverSkills 验证已被本地索引发现
    const discovered = discoverSkills(process.cwd());
    const expectedFile = join(destDir, skill.name, 'SKILL.md');
    const registered = discovered.some((s) => s.file === expectedFile);
    console.log(registered
      ? t('skillMarket.registered', { name: skill.name, n: discovered.length })
      : t('skillMarket.notRegisteredWarn', { name: skill.name }));
  } catch (e) {
    console.error(t('skillMarket.installFailed') + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  }
}

/** fhcode model-stats：显示各模型性能统计 */
export function runModelStats(): void {
  const homeDir = resolveHomeDir();
  const statsFile = join(homeDir, 'model-stats.jsonl');
  if (!existsSync(statsFile)) {
    console.log(t('modelStats.empty'));
    return;
  }
  const router = new ModelRouter([], 'cost', 0, statsFile);
  router.loadStats(homeDir).then(() => {
    const stats = router.getStats();
    if (stats.length === 0) {
      console.log(t('modelStats.noRecords'));
      return;
    }
    console.log(t('modelStats.title'));
    console.log(t('modelStats.tableHeader'));
    for (const s of stats) {
      console.log(
        `  ${s.providerId.padEnd(16)} ${s.model.padEnd(18)} ${String(s.totalCalls).padStart(5)} ${String(s.successfulCalls).padStart(5)} ${String(s.failedCalls).padStart(5)} ${s.successRate.toFixed(2).padStart(6)} ${s.avgLatencyMs.toFixed(0).padStart(8)}ms $${s.totalCostUsd.toFixed(6)}`,
      );
    }
  });
}

/** fhcode experiences [路径]：列出经验库 */
export function runExperiences(path?: string): void {
  const experienceDir = path || join(resolveHomeDir(), 'experiences');
  listExperiences(experienceDir).then((experiences: Experience[]) => {
    if (experiences.length === 0) {
      console.log(t('exp.empty'));
      return;
    }
    console.log(t('exp.header', { n: experiences.length, dir: experienceDir }));
    console.log(t('exp.tableHeader'));
    for (const exp of experiences.slice(0, 10)) {
      console.log(
        `  ${exp.id.padEnd(30)} ${exp.type.padEnd(16)} ${exp.title.slice(0, 25).padEnd(25)} ${(exp.metadata.successRate * 100).toFixed(0).padStart(4)}%    ${String(exp.metadata.sessionCount).padStart(4)}`,
      );
    }
    if (experiences.length > 10) {
      console.log(t('exp.more', { n: experiences.length }));
    }
  });
}

/* ===================== M5：Web 控制台（serve） ===================== */

/** fhcode serve：启动 Web 管理控制台。无 FH_WEB_PORT 用 8080；无 FH_WEB_TOKEN 自动生成。 */
export function runServe(port?: number): void {
  const handle = startWebServer({ port });
  console.log(t('serve.url', { url: handle.url }));
  console.log(t('serve.token', { token: handle.token }));
  console.log(t('serve.stop'));
  // 启动每日记忆总结定时器（每天 00:00 UTC）
  scheduleDailySummary();
  // 自我修复调度：每天 00:00 统一执行；常驻进程启动时若今日未做则补做（"第二天第一次开机修复"）
  scheduleSelfHeal();
  void runSelfHealIfDue().catch(() => {});
  // 注意：app.listen 保持事件循环运行，进程持续存活直到收到 SIGINT；本函数返回后 main() 结束不影响服务。
}

/* ===================== M8：自主编程能力 ===================== */

/** fhcode code-write <目标>：自主编写代码（规划→编写→测试→审查→修复） */
export async function runCodeWrite(goal: string): Promise<void> {
  const writer = createCodeWriter(process.cwd());
  // 离线演示：生成一个简单的工具函数
  const sampleCode = `/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 示例：M8 自主编写演示
 */
export function calculateCommission(base: number, rate: number): number {
  if (rate < 0 || rate > 1) {
    throw new Error('佣金比率必须在 0-1 之间');
  }
  return Math.round(base * rate * 100) / 100;
}

export interface CommissionPlan {
  name: string;
  baseRate: number;
  tierRates: Array<{ min: number; rate: number }>;
}

export function calculateTieredCommission(plan: CommissionPlan, amount: number): number {
  let total = 0;
  let remaining = amount;
  for (const tier of plan.tierRates.sort((a, b) => b.min - a.min)) {
    if (remaining <= 0) break;
    const tierAmount = Math.min(remaining, amount - tier.min);
    if (tierAmount > 0) {
      total += tierAmount * tier.rate;
      remaining -= tierAmount;
    }
  }
  total += Math.max(0, amount - plan.tierRates[0]?.min || 0) * plan.baseRate;
  return Math.round(total * 100) / 100;
}
`;
  const result = await writer.run(goal, sampleCode, 'generated/commission.ts');
  console.log('\n' + t('codewrite.resultTitle'));
  console.log(result.summary);
  console.log(t('codewrite.files', { files: result.finalFiles.join(', ') }));
}

/** fhcode quality-gate [路径]：质量门禁审查 */
export function runQualityGate(path?: string): void {
  const targetPath = path || process.cwd();
  const gate = createQualityGate();
  const results = gate.gateDirectory(targetPath, 10);
  console.log(gate.report(results));
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log('\n' + t('quality.failed', { n: failed.length }));
  }
}

/** fhcode self-improve：自我改进统计 + 经验库概览 + 学习提示预览 */
export async function runSelfImprove(): Promise<void> {
  const improver = createSelfImprover();
  const records = improver.loadImprovements();
  const stats = improver.getStats();
  console.log(t('selfimp.title'));
  console.log(t('selfimp.reflections', { n: stats.totalReflections }));
  console.log(t('selfimp.successRate', { p: (stats.successRate * 100).toFixed(1) }));
  console.log(t('selfimp.avgDuration', { ms: stats.avgDurationMs.toFixed(0) }));

  // 经验库概览（与 orchestrator 共用同一库，体现回流闭环）
  const exps = await listExperiences(improver.experienceStoreDir);
  const totalWeight = exps.reduce((s, e) => s + e.metadata.sessionCount, 0);
  console.log('\n' + t('selfimp.expLib', { n: exps.length, w: totalWeight }));
  if (exps.length > 0) {
    console.log('\n' + t('selfimp.topExp'));
    for (const e of exps.slice(0, 6)) {
      console.log(t('selfimp.expItem', { count: e.metadata.sessionCount, type: e.type, title: e.title }));
    }
  }

  if (records.length > 0) {
    console.log('\n' + t('selfimp.recent'));
    for (const rec of records.slice(-5).reverse()) {
      console.log(t('selfimp.record', { ts: rec.timestamp.slice(0, 19), ok: rec.success ? '✅' : '❌', n: rec.patterns.length }));
      for (const imp of rec.improvements.slice(0, 3)) {
        console.log(t('selfimp.improvement', { imp }));
      }
    }
  } else {
    console.log('\n' + t('selfimp.noRecords'));
  }

  // 学习提示预览：模拟一次任务，展示将注入模型的经验
  console.log('\n' + t('selfimp.learnPreview', { goal: '实现一个 REST API 功能' }));
  const learned = await improver.getLearnedPrompt('实现一个 REST API 功能');
  console.log(learned || t('selfimp.noLearned'));
}

/** fhcode self-evolve <子命令>：自我迭代元技能系统（失败记录 / 技能库 / 每日复盘 / 错误模式分析）。
 *  复用 self-evolve-cli.js 的 runCli（自包含零依赖实现），避免重复逻辑。 */
export async function runSelfEvolve(action: string, args: string[]): Promise<void> {
  // 该模块为 CommonJS JS 文件，无类型声明；此处用 createRequire 显式加载。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runCli } = require('../cli/self-evolve-cli.js') as { runCli: (argv: string[]) => void };
  runCli([action, ...args]);
}

/* ===================== M9：全自动软件工程 Agent ===================== */

export interface SweOptions {
  repo?: string;
  maxTasks?: number;
  maxRetries?: number;
  maxIterations?: number;
  verifyOnly?: boolean;
  planOnly?: boolean;
  offline?: boolean;
}

/**
 * fhcode swe "<目标>"：全自动软件工程 Agent
 * 读取整个仓库 → 任务拆解 → 逐任务(实现+验证+自愈) → 产出报告。
 * 实现阶段复用 Orchestrator（ReAct + 工具 + 自愈）；验证阶段跑构建/测试。
 */
export async function runSwe(goal: string, opts: SweOptions = {}): Promise<void> {
  const offline = opts.offline ?? isOfflineByDefault();
  const cwd = opts.repo
    ? require('path').resolve(opts.repo)
    : offline
      ? mkdtempSync(join(tmpdir(), 'fhcode-swe-'))
      : process.cwd();

  const rt = getEnterprise();
  if (rt) assertQuota(rt);
  const security: OrchestratorSecurity = { shellAllowlist: [], requireApproval: true };

  // 真实模式就绪检查：未配置任何模型供应商时给出明确接入指引，避免盲目失败
  if (!offline) {
    const cfg = loadConfig();
    if (!cfg.models.providers.length) {
      console.error(t('swe.noProvider'));
      return;
    }
  }

  /** 实现单个子任务的回调：内部装配一个 Orchestrator 实例并运行 */
  const runSubTask = async (focusedGoal: string): Promise<SubTaskOutcome> => {
    const runId = randomUUID();
    setRunId(runId);
    let router: ModelRouter;
    if (offline) {
      router = new ModelRouter([new ScriptedMockProvider(buildDemoSteps())], 'cost', 0);
    } else {
      const cfg = loadConfig();
      router = ModelRouter.fromConfig(cfg);
      security.shellAllowlist = cfg.security.shellAllowlist;
      security.requireApproval = cfg.security.requireApproval;
      security.sandboxMode = cfg.security.sandboxMode;
      security.networkRules = { networkAllow: cfg.security.networkAllow, networkDeny: cfg.security.networkDeny };
      security.hooks = cfg.hooks;
    }
    const tools = createDefaultRegistry();
    // P0-3：附加 MCP 外部工具（真实模式且有配置时），子任务结束即关闭
    let mcpClients: McpClient[] = [];
    if (!offline) {
      const cfg = loadConfig();
      mcpClients = await attachMcpTools(tools, cfg.mcp.servers);
    }
    const logDir = getSessionHome(offline);
    const eventLog = new EventLog(runId, logDir);
    const session = new SessionStore(runId, cwd);
    const approve = process.stdin.isTTY ? interactiveApprover() : defaultApproverFor(security);
    const guard = rt
      ? rt.makeGuard({ runId, cwd, shellAllowlist: security.shellAllowlist, approve })
      : undefined;
    const orchestrator = new Orchestrator({
      router,
      tools,
      eventLog,
      session,
      cwd,
      security,
      approve,
      guard,
      maxIterations: opts.maxIterations ?? 15,
      maxCostUsd: rt?.maxCostUsd ?? 0,
      // P1-1：子任务用低成本模型分担（编排器主模型保持 code-gen，worker 加 cheap 优先）
      tags: ['code-gen', 'cheap'],
      persist: (cp: import('../runtime/session-persist').SessionCheckpoint) =>
        saveCheckpoint(logDir, cp),
    });
    const result = await orchestrator.run(focusedGoal);
    await closeMcpClients(mcpClients);
    // P2-2：子代理结果摘要化回主上下文（隔离中间大输出）
    const summarized = summarizeSubTaskAnswer(result.finalAnswer);
    return {
      ok: result.ok,
      finalAnswer: summarized.text,
      iterations: result.iterations,
      touchedFiles: [],
    };
  };

  console.log(t('swe.start', { offline: offline ? t('run.modeOffline') : t('run.modeLive'), cwd }));
  const report: SweReport = await runSweAgent(goal, {
    cwd,
    runSubTask,
    maxTasks: opts.maxTasks ?? 8,
    maxRetries: opts.maxRetries ?? 2,
    verifyOnly: !!opts.verifyOnly,
    planOnly: !!opts.planOnly,
  });

  console.log('\n' + t('swe.reportTitle'));
  console.log(report.summary);

  if (rt) {
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId: 'swe',
      action: 'swe:run',
      resource: goal,
      decision: report.overall === 'failed' ? 'deny' : report.overall === 'partial' ? 'info' : 'allow',
      reason: `tasks=${report.executedTasks}/${report.plannedTasks} passed=${report.completedTasks} overall=${report.overall}`,
    });
  }
}

/* ===================== harness 评测命令 ===================== */

export interface HarnessCmdOptions {
  split: string;
  limit: number;
  offset: number;
  mode: 'mock' | 'real';
  /** P7-1: 验证器类型 file=文件存在（默认）/ test=官方测试通过（TestVerifier，跑 FAIL_TO_PASS） */
  verifier?: 'file' | 'test';
  testCommand?: string;
  report?: string;
  json: boolean;
}

/** fhcode harness [--split lite|verified] [--limit N] [--offset N] [--mode mock|real] [--report 路径] [--json] */
export async function runHarness(opts: HarnessCmdOptions): Promise<void> {
  console.log(t('harness.start', { mode: opts.mode, split: opts.split, limit: String(opts.limit) }));

  // 真实模式就绪检查：未配置任何模型供应商时给出明确接入指引
  if (opts.mode === 'real') {
    const cfg = loadConfig();
    if (!cfg.models.providers.length) {
      console.error(t('harness.noProvider'));
      return;
    }
  }

  const loader = new SwebenchLoader({ split: opts.split });
  const executor = opts.mode === 'real' ? new RealModelExecutor() : new MockOrchestratorExecutor();
  // P7-1: 可插拔验证器——--verifier test 用 TestVerifier 跑 FAIL_TO_PASS 官方测试（真实硬指标）
  const verifier = opts.verifier === 'test'
    ? new TestVerifier({ testCommand: opts.testCommand })
    : new FileExistsVerifier();
  const harness = new Harness({
    loader,
    executor,
    verifier,
    reporter: opts.json ? new JsonReporter() : new MarkdownReporter(),
    limit: opts.limit,
    offset: opts.offset,
    onProgress: (r, i, total) => {
      console.log(`  [${i}/${total}] ${r.ok ? '✅' : '❌'} ${r.instance_id} iter=${r.iterations} tools=${r.toolCalls}`);
    },
  });

  const { report, rendered } = await harness.run();
  if (opts.report) {
    writeFileSync(opts.report, rendered, 'utf8');
    console.log(t('harness.reportWritten', { path: opts.report }));
  } else {
    console.log('\n' + rendered);
  }
  console.log(t('harness.summary', {
    completed: String(report.summary.completed),
    total: String(report.summary.total),
    rate: String(Math.round(report.summary.rate * 100)),
  }));
  // 有失败实例 → 退出码非零（供 CI 门禁复用）
  if (report.summary.completed < report.summary.total) process.exitCode = 1;
  console.log(t('app.signature'));
}

/* ===================== computer：命令行直接控制电脑（手机端/终端双通道） ===================== */

const COMPUTER_APP_MAP: Record<string, string> = {
  '微信': 'WeChat',
  wechat: 'WeChat',
  qq: 'QQ',
  '腾讯会议': 'wemeetapp',
  '浏览器': 'msedge',
  chrome: 'chrome',
  edge: 'msedge',
  '记事本': 'notepad',
  '计算器': 'calc',
  '画图': 'mspaint',
  '文件管理器': 'explorer',
  '资源管理器': 'explorer',
  '任务管理器': 'taskmgr',
  cmd: 'cmd',
  '命令行': 'cmd',
  powershell: 'powershell',
  vscode: 'code',
  word: 'winword',
  excel: 'excel',
  powerpnt: 'powerpnt',
  ppt: 'powerpnt',
  outlook: 'outlook',
  '企业微信': 'WXWork',
  '钉钉': 'DingTalk',
  '飞书': 'Feishu',
};

function computerPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => { stdout += d.toString(); });
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `PowerShell exited with code ${code}`));
    });
    ps.on('error', reject);
  });
}

function computerPrintHelp(): void {
  console.log(`fhcode computer — 命令行直接控制电脑（Windows）
用法:
  fhcode computer open <应用名|路径|URL>   打开应用（如: fhcode computer open 微信）
  fhcode computer apps                      列出内置应用别名
  fhcode computer screenshot                截取当前屏幕（base64 PNG 输出到终端）
  fhcode computer click [x y]               点击鼠标（可选坐标，如: click 500 400）
  fhcode computer type "<文字>"              在焦点窗口输入文字
  fhcode computer press <键>                 发送按键/快捷键（如: press enter / ctrl+s）
  fhcode computer nl "<自然语言指令>"         自然语言直达（如: nl 打开微信）
  fhcode computer status                    检查 PowerShell 可用性`);
}

/** fhcode computer：命令行直接控制电脑（复用 Web 端同一套 PowerShell 驱动） */
export async function runComputer(action: string, args: string[]): Promise<void> {
  switch (action) {
    case 'help':
    case '-h':
    case '--help':
      computerPrintHelp();
      return;

    case 'open': {
      const target = args.join(' ').trim();
      if (!target) { console.error('缺少应用名：fhcode computer open <应用名|路径|URL>'); process.exitCode = 1; return; }
      const alias = COMPUTER_APP_MAP[target.toLowerCase()] ?? COMPUTER_APP_MAP[target];
      const resolved = alias ?? target;
      const script = `
        $t = '${resolved.replace(/'/g, "''")}'
        if ($t -match '^https?://' -or $t -match '^shell:') { Start-Process $t }
        elseif (Test-Path $t) { Start-Process $t }
        else {
          try { Start-Process $t -ErrorAction Stop } catch {
            $found = (where.exe $t 2>$null | Select-Object -First 1)
            if ($found) { Start-Process $found } else { throw "应用未找到: $t" }
          }
        }
        Write-Output "opened:$t"
      `;
      try {
        const out = await computerPowerShell(script);
        console.log(out || `已尝试打开 ${target}`);
      } catch (e) {
        console.error('打开应用失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'apps': {
      console.log('内置应用别名:');
      const seen = new Set<string>();
      for (const [k, v] of Object.entries(COMPUTER_APP_MAP)) {
        if (seen.has(v)) continue;
        seen.add(v);
        console.log(`  ${k} → ${v}`);
      }
      return;
    }

    case 'screenshot': {
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $bounds = $screen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $ms = New-Object System.IO.MemoryStream
        $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        [Convert]::ToBase64String($bytes)
      `;
      try {
        const base64 = await computerPowerShell(script);
        console.log('截图已生成（data:image/png;base64,...）长度: ' + base64.length + ' 字符');
        // 不直接打印 base64 到终端（过长），提示可用 Web 端 /api/computer/screenshot 查看
      } catch (e) {
        console.error('截图失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'click': {
      const x = args[0] ? parseInt(args[0], 10) : null;
      const y = args[1] ? parseInt(args[1], 10) : null;
      const movePart = (x !== null && y !== null) ? `[MouseHelper]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -Milliseconds 100;` : '';
      const script = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class MouseHelper {
            [DllImport("user32.dll")]
            public static extern bool SetCursorPos(int X, int Y);
            [DllImport("user32.dll")]
            public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
        }
"@
        ${movePart}
        [MouseHelper]::mouse_event(0x0002, 0, 0, 0, 0)
        [MouseHelper]::mouse_event(0x0004, 0, 0, 0, 0)
        Write-Output "ok"
      `;
      try {
        await computerPowerShell(script);
        console.log(`已点击鼠标${x !== null && y !== null ? ` 坐标(${x}, ${y})` : '（当前光标位置）'}`);
      } catch (e) {
        console.error('点击失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'type': {
      const text = args.join(' ').trim();
      if (!text) { console.error('缺少文字：fhcode computer type "<文字>"'); process.exitCode = 1; return; }
      const escaped = text.replace(/([+^%~(){}])/g, '{$1}');
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
        Write-Output "ok"
      `;
      try {
        await computerPowerShell(script);
        console.log('已输入: ' + text);
      } catch (e) {
        console.error('输入失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'press': {
      const key = args.join(' ').trim();
      if (!key) { console.error('缺少按键：fhcode computer press <键>（如 enter / ctrl+s）'); process.exitCode = 1; return; }
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('${key.replace(/'/g, "''")}')
        Write-Output "ok"
      `;
      try {
        await computerPowerShell(script);
        console.log('已按键: ' + key);
      } catch (e) {
        console.error('按键失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'nl': {
      const text = args.join(' ').trim();
      if (!text) { console.error('缺少指令：fhcode computer nl "<自然语言指令>"（如: nl 打开微信）'); process.exitCode = 1; return; }
      // 自然语言 → 动作：打开/启动/运行 X / 截图 / 输入 X / 按 X / 点击
      const openMatch = /^(打开|启动|运行|开启|open|launch|start|run)\s*[:：]?\s*(.+)$/i.exec(text);
      const isShot = /^(截图|截屏|screenshot)$/i.test(text.trim());
      const typeMatch = /^(输入|键入|type)\s*[:：]?\s*(.+)$/i.exec(text);
      const keyMatch = /^(按下|按|按键|press)\s*[:：]?\s*(.+)$/i.exec(text);
      if (openMatch) {
        await runComputer('open', [openMatch[2].trim()]);
      } else if (isShot) {
        await runComputer('screenshot', []);
      } else if (typeMatch) {
        await runComputer('type', [typeMatch[2].trim()]);
      } else if (keyMatch) {
        await runComputer('press', [keyMatch[2].trim()]);
      } else {
        // 兜底：视为打开项（应用名/路径/URL）
        await runComputer('open', [text]);
      }
      return;
    }

    case 'status': {
      try {
        const out = await computerPowerShell('Write-Output "powershell-ok"');
        console.log(out === 'powershell-ok' ? '✅ PowerShell 可用，电脑控制通道正常' : '⚠️ 异常响应: ' + out);
      } catch (e) {
        console.error('❌ PowerShell 不可用: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    default:
      console.error('未知子命令: ' + action);
      computerPrintHelp();
      process.exitCode = 1;
  }
}

/* ===================== 云桥接代理（fhcode bridge）：电脑端连云端，拉指令→执行→回传 ===================== */

/** 生成稳定的设备 ID：首次运行生成并存盘，之后复用（同一台电脑固定一个 ID） */
function getBridgeDeviceId(): string {
  const idFile = join(homedir(), '.feihong-code', 'bridge-device-id');
  try {
    if (existsSync(idFile)) {
      const saved = readFileSync(idFile, 'utf-8').trim();
      if (saved) return saved;
    }
    const id = 'pc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    mkdirSync(dirname(idFile), { recursive: true });
    writeFileSync(idFile, id, 'utf-8');
    return id;
  } catch (e) {
    return 'pc-' + Date.now().toString(36);
  }
}

interface BridgeResp {
  ok?: boolean;
  command?: { cmdId: string; text: string } | null;
  devices?: Array<{ deviceId: string; name: string; status: string }>;
  error?: string;
  [k: string]: unknown;
}

let _insecureAgent: HttpsAgent | undefined;
function bridgeInsecureAgent(): HttpsAgent | undefined {
  if (!_insecureAgent) _insecureAgent = new HttpsAgent({ rejectUnauthorized: false });
  return _insecureAgent;
}

async function bridgeFetch(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; signSecret?: string } = {}): Promise<BridgeResp> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const bodyRaw = opts.body !== undefined ? JSON.stringify(opts.body) : '';
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  // 请求签名（第二层安全：防重放）。签名密钥与云端 FH_SIGN_SECRET 一致（默认 = FH_WEB_TOKEN）
  const signSecret = opts.signSecret || process.env.FH_BRIDGE_SIGN_SECRET || opts.headers?.Authorization?.replace(/^Bearer\s+/i, '') || '';
  if (signSecret) {
    const timestamp = String(Date.now());
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const sig = createHmac('sha256', signSecret).update(`${timestamp}|${nonce}|${bodyRaw}`).digest('hex');
    headers['x-fh-ts'] = timestamp;
    headers['x-fh-nonce'] = nonce;
    headers['x-fh-sig'] = sig;
  }
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? bodyRaw : undefined,
    // 内网/测试环境可跳过证书校验（生产默认安全，勿开启）
    ...(process.env.FH_BRIDGE_INSECURE === '1' ? { agent: bridgeInsecureAgent() } : {}),
  });
  if (!res.ok) throw new Error(`云端返回 HTTP ${res.status}`);
  return (await res.json()) as BridgeResp;
}

/**
 * fhcode bridge — 电脑端桥接代理（手机 → 云端 → 电脑端执行的关键一跳）
 *
 * 电脑端运行本命令后：注册设备 → 长轮询云端待执行指令 → 用 runComputer 在本机执行 → 回传结果。
 * 手机端把自然语言指令 POST 到云端 /api/bridge/command，即可远程操作这台电脑。
 *
 * 配置：
 *   FH_BRIDGE_URL   云端地址（默认 http://127.0.0.1:18080，腾讯云部署后填 https://api.klai.top）
 *   FH_BRIDGE_TOKEN 云端 FH_WEB_TOKEN
 *   FH_BRIDGE_NAME  设备显示名（默认「本机-<主机名>」）
 */
export async function runBridge(action: string, _args: string[]): Promise<void> {
  const cloudBase = (process.env.FH_BRIDGE_URL || 'http://127.0.0.1:18080').replace(/\/+$/, '');
  const token = process.env.FH_BRIDGE_TOKEN || '';
  const deviceId = getBridgeDeviceId();
  const hostname = process.env.COMPUTERNAME || process.env.HOSTNAME || 'PC';
  const deviceName = process.env.FH_BRIDGE_NAME || `本机-${hostname}`;
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  function log(msg: string): void {
    console.log(`[bridge ${new Date().toISOString()}] ${msg}`);
  }

  if (action === 'id') {
    console.log(deviceId);
    return;
  }

  if (action === 'devices') {
    try {
      const data = await bridgeFetch(`${cloudBase}/api/bridge/devices`, { headers: authHeaders });
      console.log(JSON.stringify(data.devices ?? [], null, 2));
    } catch (e) {
      console.error('查询设备失败: ' + (e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
    }
    return;
  }

  if (action === 'status') {
    console.log(`云端: ${cloudBase}`);
    console.log(`设备ID: ${deviceId}`);
    console.log(`设备名: ${deviceName}`);
    console.log(`鉴权: ${token ? '已配置' : '未配置（FH_BRIDGE_TOKEN）'}`);
    try {
      await bridgeFetch(`${cloudBase}/api/bridge/register`, {
        method: 'POST',
        headers: authHeaders,
        body: { deviceId, name: deviceName },
      });
      console.log('✅ 已注册到云端');
    } catch (e) {
      console.error('❌ 无法连接云端: ' + (e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
    }
    return;
  }

  if (action !== 'start' && action !== 'run' && action !== '') {
    console.error(`未知子命令: ${action}（支持: start / status / id / devices）`);
    process.exitCode = 1;
    return;
  }

  // 注册设备
  try {
    await bridgeFetch(`${cloudBase}/api/bridge/register`, {
      method: 'POST',
      headers: authHeaders,
      body: { deviceId, name: deviceName },
    });
    log(`设备已注册: ${deviceName} (${deviceId})`);
  } catch (e) {
    console.error('❌ 注册失败，请检查 FH_BRIDGE_URL / FH_BRIDGE_TOKEN: ' + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
    return;
  }

  log('桥接代理启动，长轮询云端指令中（Ctrl+C 停止）…');
  let running = true;
  const stop = (): void => { running = false; process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // ===== 本地执行器增强：文件/命令/网页/系统状态（与云端执行体 cloud-agent 指令能力对齐） =====
  const LOCAL_WORK = join(homedir(), 'fhcode-cloud-work');
  const BLOCKED_CMDS = [
    /(^|\s)(rm|rmdir)\s+-[a-z]*[rf][a-z]*\s*(\/\s*|\/\*)/i,
    /(^|\s)mkfs/i, /(^|\s)dd\s+if=/i, /(^|\s)shutdown/i,
    /(^|\s)reboot/i, /(^|\s)halt/i, /(^|\s)poweroff/i,
    /(^|\s)init\s+[06]/i, /(^|\s)killall\s/i, /(^|\s)pkill\s/i,
    /(^|\s)chmod\s+-R\s+777\s+\//i, /(^|\s)chown\s+-R/i,
    /(^|\s):\(\)/i, /(^|\s)wget\s+.*\|\s*sh/i, /(^|\s)curl\s+.*\|\s*(ba)?sh/i,
    /(^|\s)systemctl\s+(stop|disable)\s+(docker|nginx|mysql|php|redis)/i,
  ];
  function safeLocalResolve(rel: string): string {
    const abs = join(LOCAL_WORK, rel);
    if (abs !== LOCAL_WORK && !abs.startsWith(LOCAL_WORK + sep)) throw new Error('路径越界：只允许操作本地工作目录 ' + LOCAL_WORK);
    return abs;
  }
  function runLocalCmd(cmdline: string, timeoutMs = 30000): Promise<string> {
    return new Promise((res, rej) => {
      if (!cmdline.trim()) { rej(new Error('空命令')); return; }
      if (BLOCKED_CMDS.some((re) => re.test(cmdline))) { rej(new Error('指令包含危险操作，已拒绝执行')); return; }
      const isWin = platform() === 'win32';
      execFile(isWin ? 'cmd' : 'bash', isWin ? ['/d', '/s', '/c', cmdline] : ['-c', cmdline],
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, cwd: LOCAL_WORK, env: { ...process.env } },
        (err, stdout, stderr) => {
          if (err) { rej(new Error((stderr || stdout || err.message || '').toString().trim().slice(0, 1000) || '命令执行失败')); return; }
          res(stdout.toString().trim());
        });
    });
  }
  /** 云端式指令解析：命中返回执行结果，未命中返回 null（回退 GUI 操作） */
  async function tryLocalExec(text: string): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string } | null> {
    const t = text.trim();
    const MAX = 8000;
    // 1) 创建/写入文件、新建目录
    let m = /^(?:创建|新建|写|写入|生成)(文件|脚本|目录)\s*[:：]?\s*(.+?)(?:\s+(?:内容|内容为|写入内容)\s*[:：]?\s*(.+))?$/i.exec(t);
    if (m) {
      const kind = m[1].toLowerCase();
      const target = m[2].trim();
      const content = (m[3] ?? '').replace(/^['"`]|['"`]$/g, '');
      if (kind === '目录') {
        const dir = safeLocalResolve(target);
        mkdirSync(dir, { recursive: true });
        return { ok: true, result: { action: 'mkdir', path: dir, text: '已创建目录: ' + dir } };
      }
      const file = safeLocalResolve(target);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, 'utf8');
      return { ok: true, result: { action: 'write', path: file, bytes: Buffer.byteLength(content), text: `已写入 ${file}（${Buffer.byteLength(content)} 字节）` } };
    }
    // 2) 读取文件
    m = /^(?:读取|查看|打开|显示|cat)(文件|脚本)\s*[:：]?\s*(.+)$/i.exec(t);
    if (m) {
      const file = safeLocalResolve(m[2].trim());
      if (!existsSync(file)) return { ok: false, error: '文件不存在: ' + file };
      const content = readFileSync(file, 'utf8');
      return { ok: true, result: { action: 'read', path: file, text: content.length > MAX ? content.slice(0, MAX) + '\n…(截断)' : content } };
    }
    // 3) 列出目录
    m = /^(?:列出|查看|浏览)(目录|文件夹)\s*[:：]?\s*(.*)$/i.exec(t);
    if (m || /^(ls|dir)\b/i.test(t)) {
      const rel = m ? ((m[2] || '').trim() || '.') : ((t.replace(/^(ls|dir)\b/i, '').trim()) || '.');
      const dir = safeLocalResolve(rel);
      if (!existsSync(dir)) return { ok: false, error: '目录不存在: ' + dir };
      const entries = readdirSync(dir, { withFileTypes: true }).map((e) => (e.isDirectory() ? '📁 ' : '📄 ') + e.name + (e.isDirectory() ? '/' : ''));
      return { ok: true, result: { action: 'ls', path: dir, text: entries.length ? entries.join('\n') : '（空目录）' } };
    }
    // 4) 执行命令/脚本
    m = /^(?:执行|运行)(命令|脚本|shell|bash|sh|python|python3|node|npm|pip|git)\s*[:：]?\s*(.+)$/i.exec(t);
    if (m) {
      const runner = m[1].toLowerCase();
      let cmdline = m[2].trim();
      if (runner === 'python' || runner === 'python3') cmdline = 'python ' + cmdline;
      else if (runner === 'node') cmdline = 'node ' + cmdline;
      else if (runner === 'npm') cmdline = 'npm ' + cmdline;
      else if (runner === 'pip') cmdline = 'pip ' + cmdline;
      else if (runner === 'git') cmdline = 'git ' + cmdline;
      const out = await runLocalCmd(cmdline);
      return { ok: true, result: { action: 'exec', command: cmdline, text: out.slice(0, MAX) } };
    }
    // 5) 抓取网页（Node 原生 fetch）
    m = /^(?:抓取|下载|访问|fetch)(网页|页面|url)\s*[:：]?\s*(https?:\/\/\S+)$/i.exec(t);
    if (m) {
      try {
        const res = await fetch(m[2], { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'fhcode-local-bridge/1.0' } });
        const txt = (await res.text()).slice(0, MAX);
        return { ok: true, result: { action: 'fetch', url: m[2], status: res.status, text: txt || '（空响应）' } };
      } catch (e) {
        return { ok: false, error: '抓取失败: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }
    // 5.5) 屏幕截图（回传 base64 图片，手机端直接渲染）
    if (/^(截图|截屏|屏幕截图|screen\s*shot)/i.test(t)) {
      try {
        const script = `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          $screen = [System.Windows.Forms.Screen]::PrimaryScreen
          $bounds = $screen.Bounds
          $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
          $ms = New-Object System.IO.MemoryStream
          $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
          $bytes = $ms.ToArray()
          [Convert]::ToBase64String($bytes)
        `;
        const base64 = (await computerPowerShell(script)).trim();
        if (!base64) return { ok: false, error: '截图失败：未获取到图像数据' };
        return { ok: true, result: { action: 'screenshot', image: 'data:image/png;base64,' + base64, text: '屏幕截图已生成（' + Math.round(base64.length / 1024) + ' KB）' } };
      } catch (e) {
        return { ok: false, error: '截图失败: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }
    // 5.6) 保存文件（手机端上传 base64 → 电脑保存）：保存文件 <路径> base64=<data>
    m = /^(?:保存|上传|接收)(文件)\s*[:：]?\s*(.+?)\s+(?:base64|data)\s*=\s*([A-Za-z0-9+/=]+)$/i.exec(t);
    if (m) {
      const file = safeLocalResolve(m[2].trim().replace(/^['"\`]|['"\`]$/g, ''));
      try {
        const buf = Buffer.from(m[3], 'base64');
        if (!buf.length) return { ok: false, error: 'base64 数据为空或无效' };
        if (buf.length > 8 * 1024 * 1024) return { ok: false, error: '文件过大（>8MB），请压缩后重试' };
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, buf);
        return { ok: true, result: { action: 'save-file', path: file, bytes: buf.length, text: '已保存 ' + file + '（' + buf.length + ' 字节）' } };
      } catch (e) {
        return { ok: false, error: '保存失败: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }
    // 5.7) 查看图片 / 读取图片（回传 base64，手机端直接渲染）
    m = /^(?:查看|读取|打开)(图片|照片|image|img)\s*[:：]?\s*(.+)$/i.exec(t);
    if (m) {
      const file = safeLocalResolve(m[2].trim().replace(/^['"\`]|['"\`]$/g, ''));
      if (!existsSync(file)) return { ok: false, error: '文件不存在: ' + file };
      try {
        const buf = readFileSync(file);
        const dot = file.lastIndexOf('.');
        const ext = (dot >= 0 ? file.slice(dot + 1) : '').toLowerCase();
        const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' } as Record<string, string>)[ext] || 'application/octet-stream';
        if (buf.length > 6 * 1024 * 1024) return { ok: false, error: '文件过大（>6MB），无法回传' };
        return { ok: true, result: { action: 'read-image', path: file, image: 'data:' + mime + ';base64,' + buf.toString('base64'), text: '文件已读取（' + Math.round(buf.length / 1024) + ' KB）' } };
      } catch (e) {
        return { ok: false, error: '读取失败: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }
    // 6) 系统状态
    if (/(系统状态|服务器状态|运行状态|内存|磁盘|磁盘空间|uptime|主机)/.test(t) && !/文件/.test(t)) {
      const gb = (n: number) => (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
      const lines = [
        '--- 主机 ---', `${hostname} | ${platform()} ${release()} | ${arch()}`,
        '--- 运行时间 ---', (uptime() / 3600).toFixed(2) + ' 小时',
        '--- 内存 ---', `总 ${gb(totalmem())} / 空闲 ${gb(freemem())} / 已用 ${gb(totalmem() - freemem())}`,
        '--- CPU ---', cpus().length + ' 核 @ ' + cpus()[0].model.trim(),
        '--- 工作目录 ---', LOCAL_WORK,
      ];
      return { ok: true, result: { action: 'sysinfo', text: lines.join('\n') } };
    }
    // 7) 搜索文件
    m = /^(?:搜索|查找|找)(文件|关键词|内容)\s*[:：]?\s*(.+)$/i.exec(t);
    if (m) {
      const kw = m[2].trim();
      const hits: string[] = [];
      (function walk(d: string): void {
        let ents: Dirent[];
        try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (hits.length >= 30) return;
          const p = join(d, e.name);
          if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); }
          else { try { if (readFileSync(p, 'utf8').includes(kw)) hits.push(p); } catch { /* 忽略 */ } }
        }
      })(LOCAL_WORK);
      return { ok: true, result: { action: 'grep', keyword: kw, text: hits.length ? hits.map((h) => h.replace(LOCAL_WORK + sep, '')).join('\n') : '（未找到匹配文件）' } };
    }
    return null;
  }

  // 指令→执行：优先云端式解析（文件/命令/网页/系统状态），未命中回退 runComputer 自然语言（GUI 操作）
  async function execute(text: string): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
    mkdirSync(LOCAL_WORK, { recursive: true });
    try {
      const local = await tryLocalExec(text);
      if (local) return local;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    try {
      await runComputer('nl', [text]);
      return { ok: true, result: { text, executed: true } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  while (running) {
    try {
      const data = await bridgeFetch(`${cloudBase}/api/bridge/pending?deviceId=${encodeURIComponent(deviceId)}`, {
        headers: authHeaders,
      });
      const cmd = data.command;
      if (cmd && cmd.cmdId) {
        log(`收到指令: ${cmd.text}`);
        const outcome = await execute(cmd.text);
        log(`执行完成: ${outcome.ok ? '成功' : '失败'}`);
        await bridgeFetch(`${cloudBase}/api/bridge/result`, {
          method: 'POST',
          headers: authHeaders,
          body: { cmdId: cmd.cmdId, deviceId, ok: outcome.ok, result: outcome.result, error: outcome.error },
        });
      }
      // 轮询间隔 3 秒；云端 18080 本地联调时可改短
      await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      log('轮询出错（' + (e instanceof Error ? e.message : String(e)) + '），5 秒后重试');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/* ===================== license：商业授权管理 ===================== */

import {
  licenseState,
  activateLicense,
  generateLicenseKey,
  licenseText,
  deviceFingerprint,
} from '../license';

function printLicenseHelp(): void {
  console.log(`fhcode license — 商业授权管理
用法:
  fhcode license show                  查看当前授权状态
  fhcode license activate <激活码>      输入激活码激活
  fhcode license fingerprint           打印本机设备指纹
  （开发商专属，受双重密钥门禁）:
  fhcode license gen <类型> <客户名> [天数] [设备数]   生成激活码（需 FH_LICENSE_SECRET + FH_LICENSE_MASTER）
  fhcode license help                  显示帮助`);
}

/** fhcode license：激活码激活 / 状态查看 / 开发商发码 */
export async function runLicense(action: string, args: string[]): Promise<void> {
  switch (action) {
    case 'help':
    case '-h':
    case '--help':
      printLicenseHelp();
      return;

    case 'show': {
      const state = licenseState();
      console.log(licenseText(state));
      if (state.activated) {
        console.log(`设备指纹: ${state.deviceFingerprint ?? ''}`);
        console.log(`到期时间: ${state.expiresAt || '永久'}`);
      } else if (state.trial) {
        console.log('提示: 试用期内功能可用，试用结束后需激活码。');
      } else {
        console.error('提示: ' + (state.error || ''));
        console.error('购买授权后使用: fhcode license activate <激活码>');
        process.exitCode = 1;
      }
      return;
    }

    case 'activate': {
      const key = args.join(' ').trim();
      if (!key) { console.error('缺少激活码: fhcode license activate <激活码>'); process.exitCode = 1; return; }
      const result = activateLicense(key);
      if (!result.ok) {
        console.error('❌ 激活失败: ' + (result.error || '未知错误'));
        process.exitCode = 1;
        return;
      }
      console.log('✅ 激活成功:');
      console.log('  ' + licenseText(result.state!));
      return;
    }

    case 'gen': {
      const type = (args[0] || 'standard').toLowerCase();
      const issuedTo = args[1] || '';
      const days = args[2] ? parseInt(args[2], 10) : 0;
      const seats = args[3] ? parseInt(args[3], 10) : 1;
      if (!['standard', 'pro', 'enterprise'].includes(type)) {
        console.error('授权类型必须是 standard / pro / enterprise');
        process.exitCode = 1;
        return;
      }
      if (!issuedTo) { console.error('缺少客户名: fhcode license gen <类型> <客户名> [天数] [设备数]'); process.exitCode = 1; return; }
      // 双重密钥门禁：激活码只能在开发商源码端生成
      // 1) FH_LICENSE_SECRET（发码签名密钥）
      if (!process.env.FH_LICENSE_SECRET) {
        console.error('❌ 未配置 FH_LICENSE_SECRET（发码签名密钥），禁止生成激活码');
        process.exitCode = 1;
        return;
      }
      // 2) FH_LICENSE_MASTER（开发商主密钥，发布版/客户环境无此密钥）
      const masterOk =
        process.env.FH_LICENSE_MASTER?.trim() !== '' ||
        existsSync(join(homedir(), '.feihong-code', 'license-master'));
      if (!masterOk) {
        console.error('❌ 当前环境未配置开发商主密钥（FH_LICENSE_MASTER 或 ~/.feihong-code/license-master），激活码只能在开发商源码端生成');
        process.exitCode = 1;
        return;
      }
      const key = generateLicenseKey({ type: type as 'standard' | 'pro' | 'enterprise', issuedTo, days, seats });
      console.log('激活码: ' + key);
      console.log(`类型: ${type} | 客户: ${issuedTo} | 天数: ${days || '永久'} | 设备数: ${seats}`);
      console.log('交付话术: 请打开 fhcode，运行 fhcode license activate ' + key);
      return;
    }

    case 'fingerprint': {
      console.log(deviceFingerprint());
      return;
    }

    default:
      console.error('未知子命令: ' + action);
      printLicenseHelp();
      process.exitCode = 1;
  }
}

function expandHome(p: string): string {
  // 统一用 os.homedir()（Windows 上 process.env.HOME 可能缺失，导致 ~ 展开为空路径）
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
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
        rl.question(t('approve.prompt', { action }), (ans) => {
          rl.close();
          resolve(/^(y|yes|是)$/i.test(ans.trim()));
        });
      ask();
    });
}

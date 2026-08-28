/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 运行装配：把模型路由、工具、运行时、编排器组装成一次任务执行。
 * 无 API key 时自动进入离线模式（ScriptedMockProvider 驱动闭环验证）。
 *
 * M3 增强：会话检查点持久化 + resume/diff/rollback 管理命令 + 交互式审批。
 */
import { randomUUID } from 'crypto';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, dirname } from 'path';
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
    router = ModelRouter.fromConfig(cfg);
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

/* ===================== 审批器 ===================== */

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

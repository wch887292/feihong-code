/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * B1 架构治理(2026-09-27)：任务执行核心（中性模块）。
 * 从 cli/run.ts 下沉 executeTask 及其私有依赖，供 cli 与 web 共同单向引用，
 * 打断原 cli/run → web/server → web/task-queue → cli/run 循环依赖。
 * 本模块不得反向 import cli/* 或 web/*。
 */
import { randomUUID } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { setRunId, logger } from '../shared/logger';
import { t } from '../shared/i18n';
import { loadConfig, loadConfigFile } from '../shared/config';
import { AppError } from '../shared/errors';
import { ModelRouter } from '../models/model-router';
import { classifyGoalTier, type ComputeTier } from '../models/tier';
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
import { saveCheckpoint, type SessionCheckpoint } from '../runtime/session-persist';
import {
  createEnterpriseRuntime,
  isEnterpriseEnabled,
  assertQuota,
  type EnterpriseRuntime,
} from '../enterprise';
import { registerPuaHooks } from '../skills/pua-hooks';
import { runSkillHooks } from '../runtime/hooks';
import {
  Orchestrator,
  type OrchestratorSecurity,
  type OrchestratorEvent,
  type ResumeContext,
} from '../agent/orchestrator';
import { createLayeredMemory } from '../agent/layered-memory';
import type { ChatMessage } from '../models/model.interface';

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
  /** 算力档位（对标纳米Work 轻量/省钱/满血）；缺省按目标复杂度自动分类 */
  tier?: ComputeTier;
  /** ④ 工作记忆增强：注入共享分层记忆实例（缺省每次运行新建，自动召回/压缩/持久化项目记忆） */
  layeredMemory?: import('../agent/layered-memory').LayeredMemory;
}

/** 离线演示脚本：写文件 → 总结，跑通完整链路 */
export function buildDemoSteps(): MockStep[] {
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
export function getSessionHome(offline: boolean): string {
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

/** 统一用 os.homedir()（Windows 上 process.env.HOME 可能缺失，导致 ~ 展开为空路径） */
export function expandHome(p: string): string {
  if (p.startsWith('~')) return join(homedir(), p.slice(1));
  return p;
}

export function joinHome(): string {
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

/**
 * 单任务成本上限（orchestrator 硬闸）解析。
 * FH_BUDGET_USD 显式设置（>0）时优先——用户显式指定的预算应压过角色策略默认值
 * （此前该变量只接到 model-router 的告警层，orchestrator 仍按角色 maxCostUsd 中止，
 * 2026-10-01 实测踩坑：FH_BUDGET_USD=100 依旧被 $1 角色闸拦截）。
 */
export function resolveMaxCostUsd(rtMaxCost: number | undefined | null): number {
  const env = Number(process.env.FH_BUDGET_USD);
  if (Number.isFinite(env) && env > 0) return env;
  return rtMaxCost ?? 0;
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
    // Web 直连模式不感知档位，固定满血
    router = new ModelRouter(providers, 'cost', 0, '', '', 3, 1000, 'full');
  } else if (offline) {
    // 离线演示固定满血（mock provider）
    router = new ModelRouter([new ScriptedMockProvider(buildDemoSteps())], 'cost', 0, '', '', 3, 1000, 'full');
  } else {
    const cfg = loadConfig();
    // 算力档位（对标纳米Work 轻量/省钱/满血）：显式 --tier > 配置 defaultTier 锁定 > 按目标复杂度自动分类
    const tier = opts.tier ?? cfg.models.defaultTier ?? classifyGoalTier(goal);
    logger.info('compute tier', { tier, explicit: !!opts.tier, locked: !!cfg.models.defaultTier });
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
      router = ModelRouter.fromConfig({ ...cfg, models: { ...cfg.models, providers: matched } }, undefined, tier);
    } else {
      router = ModelRouter.fromConfig(cfg, undefined, tier);
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
    maxCostUsd: resolveMaxCostUsd(rt?.maxCostUsd),
    persist: (cp: SessionCheckpoint) => saveCheckpoint(logDir, cp),
    onEvent: opts.renderer ?? (opts.stream ? streamRenderer() : undefined),
    pluginSkillDirs,
    signal: opts.signal,
    stageChange: opts.stageChange,
    extraSystemPrompt,
    // ④ 工作记忆增强（对标纳米Work 记忆复用）：默认全局装配分层记忆。
    // 启动时按 goal 召回项目记忆注入上下文，过程中自动压缩，结束时把决策/产物持久化到项目记忆，
    // 实现跨会话复用。memoryDir 落 ~/.feihong-code/layered-memory/project-memory.json。
    layeredMemory: opts.layeredMemory ?? createLayeredMemory(),
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

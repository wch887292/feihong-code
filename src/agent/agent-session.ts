/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1.1 内核服务化改造：createAgentSession 工厂
 *  - 将 Orchestrator 从 CLI 装配（run.ts executeTask）解耦为可复用的会话工厂
 *  - 返回 AgentSession 对象：run() / injectSteer() / abort() / 事件订阅
 *  - 内置 steer 队列（P3 中途纠偏）和 AbortController（中断）
 *  - Web 服务端 / 嵌入式场景直接调用，无需走 CLI 入口
 *
 * 设计原则：
 *  - 工厂只做装配，不做业务逻辑（模型路由、工具、守卫由调用方注入或用默认值）
 *  - router 必须由调用方提供（支持离线 mock / 真实模型 / 自定义 provider）
 *  - tools 可选，默认 createDefaultRegistry()；MCP/企业守卫等高级组件由调用方注入
 *  - 不替代 executeTask——CLI 仍可独立装配；工厂面向程序化/Web 场景
 */

import { randomUUID } from 'crypto';
import { Orchestrator, type OrchestratorDeps, type OrchestratorSecurity, type OrchestratorEvent, type ResumeContext, type RunResult } from './orchestrator';
import { InMemorySteerQueue, type SteerSource, type SteerMessage } from './steer';
import { EventLog } from '../runtime/event-log';
import { SessionStore } from '../runtime/session-store';
import { createDefaultRegistry, type ToolRegistry } from '../tools';
import type { ModelRouter } from '../models/model-router';
import type { ToolGuard } from '../tools/tool.interface';
import type { SessionCheckpoint } from '../runtime/session-persist';
import { tmpdir } from 'os';
import { join } from 'path';

/** 创建 AgentSession 的配置 */
export interface AgentSessionConfig {
  /** 工作目录（所有文件操作的根路径） */
  cwd: string;
  /** 模型路由（必须由调用方提供，支持离线 mock / 真实模型） */
  router: ModelRouter;
  /** 运行 ID，不传则自动生成 */
  runId?: string;
  /** 事件日志目录，不传则用临时目录 */
  logDir?: string;
  /** 工具注册表，不传则用 createDefaultRegistry() */
  tools?: ToolRegistry;
  /** 安全配置（沙箱模式、shell 白名单、审批要求） */
  security?: Partial<OrchestratorSecurity>;
  /** 最大迭代轮数，默认 50 */
  maxIterations?: number;
  /** 成本上限（USD），0 表示不限制 */
  maxCostUsd?: number;
  /** 工具守卫（RBAC 策略引擎，企业场景注入） */
  guard?: ToolGuard;
  /** 审批回调（危险操作需用户确认时调用） */
  approve?: (action: string) => Promise<boolean>;
  /** 检查点持久化回调（resume 续跑用） */
  persist?: (cp: SessionCheckpoint) => Promise<void>;
  /** 编排事件回调（流式输出 / SSE 推送用） */
  onEvent?: (ev: OrchestratorEvent) => void;
  /** 文件写入暂存回调（注入 change-manager.stageChange，变更面板用） */
  stageChange?: (path: string, content: string) => void;
  /** 额外系统提示（hooks 注入的行为协议等） */
  extraSystemPrompt?: string;
  /** 插件技能目录 */
  pluginSkillDirs?: string[];
  /** 外部中断信号（不传则工厂内部创建 AbortController） */
  signal?: AbortSignal;
  /** 经验学习目录（不传则不启用经验提取） */
  experienceDir?: string;
  /** 分层记忆（P1-2 高级特性，可选注入） */
  layeredMemory?: OrchestratorDeps['layeredMemory'];
  /** RAG 代码检索（默认启用，传 false 关闭） */
  ragEnabled?: boolean;
}

/** 可运行的 Agent 会话对象 */
export interface AgentSession {
  /** 运行 ID */
  readonly runId: string;
  /** steer 事件源（可直接 push 消息，或用 injectSteer 便捷方法） */
  readonly steer: SteerSource;
  /** 执行目标（可带 resume 上下文续跑） */
  run(goal: string, resume?: ResumeContext): Promise<RunResult>;
  /** 注入中途纠偏指令（便捷方法，等价于 steer.push） */
  injectSteer(message: string, focus?: string): SteerMessage;
  /** 中断当前任务（工厂内部 AbortController 触发） */
  abort(): void;
  /** 获取会话存储（消息历史快照） */
  getSession(): SessionStore;
  /** 获取事件日志 */
  getEventLog(): EventLog;
}

/**
 * 创建一个可运行的 Agent 会话。
 *
 * 工厂封装了 Orchestrator 的装配细节，调用方只需提供 router 和 cwd，
 * 其余组件（tools/eventLog/session/steer/abort）自动创建或可覆盖。
 *
 * @example
 * ```ts
 * const session = createAgentSession({
 *   cwd: '/path/to/project',
 *   router: new ModelRouter([new ScriptedMockProvider(steps)], 'cost', 0),
 *   onEvent: (ev) => console.log(ev.type),
 * });
 * // 运行中用户插话
 * session.injectSteer('不要改测试文件，只改 src/', '只改 src/ 目录');
 * const result = await session.run('修复登录 bug');
 * ```
 */
export function createAgentSession(config: AgentSessionConfig): AgentSession {
  const runId = config.runId ?? randomUUID();
  const logDir = config.logDir ?? join(tmpdir(), 'fhcode-sessions');
  const tools = config.tools ?? createDefaultRegistry();
  const eventLog = new EventLog(runId, logDir);
  const session = new SessionStore(runId, config.cwd);
  const steer = new InMemorySteerQueue();

  // 中断控制器：外部 signal 优先，否则工厂内部创建
  const internalController = config.signal ? null : new AbortController();
  const signal = config.signal ?? internalController!.signal;

  const security: OrchestratorSecurity = {
    shellAllowlist: config.security?.shellAllowlist ?? [],
    requireApproval: config.security?.requireApproval ?? true,
    sandboxMode: config.security?.sandboxMode,
    networkRules: config.security?.networkRules,
    hooks: config.security?.hooks,
  };

  const orchestrator = new Orchestrator({
    router: config.router,
    tools,
    eventLog,
    session,
    cwd: config.cwd,
    security,
    approve: config.approve,
    maxIterations: config.maxIterations ?? 50,
    maxCostUsd: config.maxCostUsd ?? 0,
    persist: config.persist,
    guard: config.guard,
    onEvent: config.onEvent,
    pluginSkillDirs: config.pluginSkillDirs,
    signal,
    stageChange: config.stageChange,
    extraSystemPrompt: config.extraSystemPrompt,
    experienceDir: config.experienceDir,
    layeredMemory: config.layeredMemory,
    ragEnabled: config.ragEnabled,
    steerSource: steer,
  });

  return {
    runId,
    steer,
    run: (goal: string, resume?: ResumeContext) => orchestrator.run(goal, resume),
    injectSteer: (message: string, focus?: string) => steer.push({ message, focus }),
    abort: () => {
      if (internalController) {
        internalController.abort();
      } else {
        // 外部 signal 场景：调用方自行控制中断，这里只记录
        eventLog.append('error', { reason: 'abort-requested-on-external-signal' }).catch(() => undefined);
      }
    },
    getSession: () => session,
    getEventLog: () => eventLog,
  };
}

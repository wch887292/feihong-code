/**
 * @fhcode/theone-enhance — 插件入口
 *
 * 这是挂载进 fhcode 内核的唯一入口。fhcode 在收到用户需求后调用：
 *   const enhance = createTheoneEnhance(engine, config);
 *   const handled = await enhance.handle(userInput, { repoId });
 *   if (handled) return; // 增强大脑已接管本次请求
 *   // 否则走 fhcode 原有简易 LLM 路径（完全兼容旧行为）
 */
import { resolveConfig, shouldEnhance, type ConfigSource } from './config.js';
import type {
  FhcodeEngineCapabilities,
  LlmClient,
  MemoryStore,
  TaskPlan,
  TaskState,
} from './types.js';
import { createLlmPlanner, type Planner } from './planner/planner.js';
import { createMemoryService, InMemoryMemoryStore, type MemoryService } from './memory/memory.js';
import { createOrchestrator, type Orchestrator } from './orchestrator/orchestrator.js';
import { createMcpRouter, buildEngineTools, type McpRouter } from './mcp-router/router.js';

export * from './types.js';
export { resolveConfig, shouldEnhance } from './config.js';
export { createLlmPlanner, topologicalSort } from './planner/planner.js';
export { createMemoryService, InMemoryMemoryStore } from './memory/memory.js';
export { createOrchestrator } from './orchestrator/orchestrator.js';
export { createMcpRouter, buildEngineTools } from './mcp-router/router.js';

export interface TheoneEnhance {
  readonly config: ReturnType<typeof resolveConfig>;
  readonly planner: Planner;
  readonly memory: MemoryService;
  readonly orchestrator: Orchestrator;
  readonly mcpRouter: McpRouter;
  /** 统一入口：返回 true 表示增强大脑接管了本次请求 */
  handle(input: string, ctx: HandleContext): Promise<boolean>;
}

export interface HandleContext {
  repoId: string;
  /** 高风险操作的人工审批回调；缺省默认拒绝 */
  requestApproval?: (reason: string) => Promise<boolean>;
  /** 进度回调 */
  onProgress?: (state: TaskState) => void;
}

/** 创建增强引擎（嵌入式，不依赖独立 TheOne 服务进程） */
export function createTheoneEnhance(
  engine: FhcodeEngineCapabilities,
  configSource: ConfigSource = {},
  deps: { llm?: LlmClient; memoryStore?: MemoryStore } = {},
): TheoneEnhance {
  const config = resolveConfig(configSource);

  // 记忆：若配置了外部 store 则用外部，否则用默认内存实现
  const memoryStore = deps.memoryStore ?? config.memoryStore ?? new InMemoryMemoryStore();
  const memory = createMemoryService({ store: memoryStore, llm: deps.llm ?? config.llm });

  const planner = createLlmPlanner({
    memorySearch: async (q) => {
      if (!config.memory) return [];
      const hits = await memory.recall({ repoId: q.repoId, query: q.query });
      return hits.map((h) => h.entry.content);
    },
  });

  const orchestrator = createOrchestrator();

  const mcpRouter = createMcpRouter({
    tools: config.mcpRouter ? buildEngineTools(engine) : [],
    allowPaths: config.mcpRouter ? ['.'] : [],
    blockCommands: config.mcpRouter ? [/rm\s+-rf/i, /format\s+[a-z]:/i, /shutdown/i, /del\s+\/s/i] : [],
    requestApproval: async (req) => {
      if (!config.humanInLoop) return true;
      if (!deps.llm) return false;
      return configSource.humanInLoop === false ? true : defaultApproval();
    },
  });

  return {
    config,
    planner,
    memory,
    orchestrator,
    mcpRouter,

    async handle(input, ctx) {
      if (!shouldEnhance(config, input)) return false;

      // 1) 规划
      const plan = await planner.plan(input, { llm: mustLlm(deps.llm, config), repoId: ctx.repoId });

      // 2) 执行前检索记忆，注入上下文（已由 planner 的 memorySearch 完成）

      // 3) 编排执行（含人工审批、进度回调）
      const state = await orchestrator.run(plan, {
        plan,
        memory: memoryStore,
        engine,
        requestApproval: ctx.requestApproval
          ? async (req) => ctx.requestApproval!(req.reason)
          : undefined,
      }, {
        onProgress: ctx.onProgress,
      });

      // 4) 执行后吸收经验入库
      if (config.memory && state.status === 'success') {
        await memory.absorb({
          repoId: ctx.repoId,
          taskSummary: plan.goal,
          result: `已完成，共 ${plan.steps.length} 步。`,
          scope: 'repo',
        });
      }

      return true;
    },
  };
}

/** 无 LLM 配置时规划器不可用，给出明确错误（避免静默降级） */
function mustLlm(llm: LlmClient | undefined, config: { planner: boolean }): LlmClient {
  if (!llm) {
    throw new Error('[theone-enhance] 启用 planner 必须提供 llm 客户端（复用 fhcode 现有 LLM 链路）');
  }
  return llm;
}

/** 未提供审批回调时的默认策略：拒绝高危（安全优先） */
function defaultApproval(): boolean {
  return false;
}

/**
 * 多子Agent编排器（TheOne 核心能力之一）
 *
 * 作用：在 fhcode 内部拉起多个子角色（架构/编码/测试/评审）协同完成复杂工程任务。
 * 原则：
 *  - 子角色底层全部复用 fhcode 原生执行引擎（同一沙箱）；
 *  - 编排器只负责任务分配、角色轮换、结果评审、状态推进；
 *  - 并发修改同一文件需做串行化，防止冲突。
 */
import type {
  AgentRole,
  OrchestratorContext,
  SubAgentSpec,
  SubTask,
  TaskPlan,
  TaskState,
} from '../types.js';

/** 角色与可写权限的默认绑定 */
const ROLE_WRITE: Record<AgentRole, boolean> = {
  architect: false,
  coder: true,
  tester: false,
  reviewer: false,
};

export interface Orchestrator {
  run(plan: TaskPlan, ctx: OrchestratorContext, hooks?: RunHooks): Promise<TaskState>;
}

export interface RunHooks {
  onProgress?: (state: TaskState) => void;
  onStepStart?: (step: SubTask) => void;
  onStepEnd?: (step: SubTask, ok: boolean) => void;
}

/** 将子任务按角色分派：架构步骤归 architect，写文件归 coder，测试归 tester，其余默认 coder */
function assignRole(step: SubTask): AgentRole {
  const action = step.action;
  switch (action.kind) {
    case 'readFile':
      return 'architect';
    case 'runTests':
      return 'tester';
    case 'callMcp':
      return 'reviewer';
    case 'editFile':
    case 'writeFile':
    case 'runCommand':
    case 'runBuild':
    case 'git':
    default:
      return 'coder';
  }
}

/** 创建一个普通编排器 */
export function createOrchestrator(subAgents: SubAgentSpec[] = defaultSubAgents()): Orchestrator {
  return {
    async run(plan, ctx, hooks) {
      const state: TaskState = {
        id: plan.id,
        title: plan.goal,
        status: 'running',
        progress: 0,
        currentStep: 0,
        totalSteps: plan.steps.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // 高危计划需先过人工审批
      if (plan.requiresApproval) {
        if (ctx.requestApproval) {
          const ok = await ctx.requestApproval({
            id: `ap_${Date.now()}`,
            reason: `任务需要人工确认：${plan.goal}`,
            risk: 'high',
            context: { planId: plan.id, goal: plan.goal },
            createdAt: Date.now(),
          });
          if (!ok) {
            state.status = 'cancelled';
            return state;
          }
        }
      }

      // 拓扑序执行
      const order = topoPlan(plan);
      let lastOk = true;
      for (let i = 0; i < order.length; i++) {
        const step = order[i]!;
        state.currentStep = i + 1;
        state.updatedAt = Date.now();
        hooks?.onStepStart?.(step);

        try {
          const role = assignRole(step);
          const spec = subAgents.find((s) => s.role === role);
          const canWrite = spec?.canWrite ?? ROLE_WRITE[role];
          // 写权限不足且步骤需要写：跳过并标记失败
          if (!canWrite && step.action.kind !== 'readFile') {
            throw new Error(`[theone-enhance] 角色 ${role} 无写权限，拒绝执行 ${step.title}`);
          }
          await executeStep(step, ctx);
          lastOk = true;
        } catch (e) {
          lastOk = false;
          state.status = 'failed';
          state.error = {
            code: 'step_failed',
            message: e instanceof Error ? e.message : String(e),
            stepId: step.id,
            retryable: true,
            attempts: 1,
          };
          hooks?.onStepEnd?.(step, false);
          break;
        }
        hooks?.onStepEnd?.(step, true);
        state.progress = Math.round(((i + 1) / order.length) * 100);
        hooks?.onProgress?.(state);
      }

      if (lastOk) {
        state.status = 'success';
        state.progress = 100;
      }
      state.updatedAt = Date.now();
      return state;
    },
  };
}

function defaultSubAgents(): SubAgentSpec[] {
  return [
    { id: 'arch-1', role: 'architect', brief: '审阅仓库结构、制定改造方案', canWrite: false },
    { id: 'code-1', role: 'coder', brief: '修改文件、编写代码', canWrite: true },
    { id: 'test-1', role: 'tester', brief: '执行单元测试、捕获报错、定位问题', canWrite: false },
    { id: 'rev-1', role: 'reviewer', brief: '代码变更自检、检查约定', canWrite: false },
  ];
}

/** 复用规划器中的拓扑排序逻辑（避免循环依赖，内部实现一份） */
function topoPlan(plan: TaskPlan): SubTask[] {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const done = new Set<string>();
  const order: SubTask[] = [];
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visited.has(id)) return; // 环保护：不抛错，跳过重复
    visited.add(id);
    const step = byId.get(id);
    if (step) {
      for (const dep of step.dependsOn) visit(dep);
      order.push(step);
    }
    visited.delete(id);
    done.add(id);
  };
  for (const s of plan.steps) visit(s.id);
  return order;
}

/** 把单个子任务映射为 fhcode 内核调用 */
async function executeStep(step: SubTask, ctx: OrchestratorContext): Promise<void> {
  const engine = ctx.engine;
  const action = step.action;

  switch (action.kind) {
    case 'readFile':
      await engine.readFile(action.path);
      return;
    case 'editFile':
      await engine.patchFile(action.patch.path, action.patch);
      return;
    case 'writeFile':
      await engine.writeFile(action.path, action.content);
      return;
    case 'runCommand':
      await engine.runCommand(action.cmd, action.opts);
      return;
    case 'runBuild':
      await engine.runBuild(action.opts);
      return;
    case 'runTests':
      await engine.runTests(action.opts);
      return;
    case 'git':
      await engine.git(action.opts);
      return;
    case 'callMcp':
      // 经 MCP 路由中心调用外部工具
      throw new Error('[theone-enhance] callMcp 需在启用 mcpRouter 时由路由中心处理');
    default: {
      const _exhaustive: never = action;
      throw new Error(`[theone-enhance] 未知子任务动作: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

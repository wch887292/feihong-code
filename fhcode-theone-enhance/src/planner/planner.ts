/**
 * 任务规划器（TheOne 核心能力之一）
 *
 * 作用：把用户的中文大需求拆解为带依赖的有序子任务图，交给 fhcode 内核执行。
 * 原则：
 *  - 中文 prompt 原样透传，不做翻译；
 *  - 每个子任务只描述“要什么”，执行细节交给 fhcode 内核；
 *  - 输出 TaskPlan，供编排器消费。
 */
import type { LlmClient, SubTask, TaskPlan } from '../types.js';

export interface PlannerOptions {
  llm: LlmClient;
  repoId?: string;
}

export interface PlannerDeps {
  /** 若提供，规划前先检索项目记忆，把相关经验注入规划 prompt */
  memorySearch?: (q: { repoId: string; query: string }) => Promise<string[]>;
}

export interface Planner {
  plan(goal: string, opts: PlannerOptions, deps?: PlannerDeps): Promise<TaskPlan>;
}

const PLAN_SYSTEM_PROMPT = `
你是 fhcode 内置的 TheOne 任务规划器。请把用户的中文工程需求拆解为可执行的任务计划。

硬性要求：
1. 输出必须是合法 JSON，符合 TaskPlan 结构，不得输出解释性文字。
2. goal 用原中文保留。
3. steps 是 SubTask 数组，每步只描述“要什么”，action 必须指向 fhcode 内核支持的能力：
   readFile / editFile / writeFile / runCommand / runBuild / runTests / git / callMcp。
4. 用 dependsOn 表达依赖（拓扑序，无环）。
5. acceptanceCriteria 描述整项任务完成后的总体验收标准。
6. 涉及高危操作（批量删除、架构变更、生产写入、rm -rf 类命令）时：
   - requiresApproval 置 true；
   - 并在对应 step 的 title 中标注【需人工确认】。
7. 所有文本用中文。不得编造文件路径或命令；路径来自需求上下文或记忆。
`;

const PLAN_OUTPUT_SCHEMA_HINT = `
TaskPlan 结构：
{
  "id": "plan_xxx",
  "goal": "中文目标",
  "steps": [
    {
      "id": "s1",
      "title": "中文步骤",
      "dependsOn": [],
      "action": { "kind": "readFile", "path": "..." },
      "acceptance": "如何判定成功"
    }
  ],
  "acceptanceCriteria": ["..."],
  "resumable": true,
  "requiresApproval": false,
  "createdAt": 0
}
`;

/** 基于 LLM 的规划器实现 */
export function createLlmPlanner(deps: PlannerDeps = {}): Planner {
  return {
    async plan(goal, opts, overrideDeps) {
      const search = overrideDeps?.memorySearch ?? deps.memorySearch;
      let memoryContext = '';
      if (search && opts.repoId) {
        const hits = await search({ repoId: opts.repoId, query: goal });
        if (hits.length > 0) {
          memoryContext = `\n[项目记忆检索结果，可参考]\n${hits.join('\n')}\n`;
        }
      }

      const prompt = [
        `[用户需求]\n${goal}`,
        memoryContext,
        PLAN_OUTPUT_SCHEMA_HINT,
      ].filter(Boolean).join('\n');

      const res = await opts.llm.complete({ prompt, system: PLAN_SYSTEM_PROMPT, json: true });
      const plan = parsePlan(res.json ?? res.text);
      return plan;
    },
  };
}

/** 解析并校验 LLM 返回的计划，保证结构安全 */
function parsePlan(raw: unknown): TaskPlan {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('[theone-enhance] 规划器返回非法结构');
  }
  const o = raw as Record<string, unknown>;
  const steps = Array.isArray(o.steps) ? (o.steps as SubTask[]) : [];
  return {
    id: String(o.id ?? `plan_${Date.now()}`),
    goal: String(o.goal ?? ''),
    steps,
    acceptanceCriteria: Array.isArray(o.acceptanceCriteria) ? (o.acceptanceCriteria as string[]) : [],
    resumable: o.resumable !== false,
    requiresApproval: o.requiresApproval === true,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
  };
}

/** 拓扑排序：校验依赖无环，返回可安全执行的步骤顺序 */
export function topologicalSort(steps: SubTask[]): SubTask[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const done = new Set<string>();
  const order: SubTask[] = [];

  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visited.has(id)) throw new Error(`[theone-enhance] 子任务依赖成环: ${id}`);
    visited.add(id);
    const step = byId.get(id);
    if (step) {
      for (const dep of step.dependsOn) visit(dep);
      order.push(step);
    }
    visited.delete(id);
    done.add(id);
  };

  for (const s of steps) visit(s.id);
  return order;
}

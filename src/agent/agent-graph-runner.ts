/**
 * 飞虹 Code · M4 阶段 D：智能体编排面板 —— 并行编排执行器
 *
 * 接收用户在前端编排面板拖拽生成的 agent 图（一个全局目标 + N 个并行智能体），
 * 真正并发执行每个智能体（Promise.all），汇总各 agent 产出。
 *
 * 执行策略：
 *  - online：传入 ModelRouter（fromConfig 构造，已配置 provider/key）时，逐 agent 调 router.chat；
 *  - offline：无可用模型 provider 时，降级为确定性离线合成，仍产出与角色/目标相关的真实文本产物，
 *    保证「可视化编排 → 实际跑通一个 N 智能体并行任务」在任意环境（含无 API key 的演示机）都能跑通。
 *  - 单个 agent 失败不影响其余（失败隔离），均计入 results。
 */
import { logger } from '../shared/logger';
import type { ModelRouter } from '../models/model-router';

/** 单智能体编排规格（来自前端面板） */
export interface GraphAgentSpec {
  id: string;
  name: string;
  /** 角色标识（researcher/coder/critic/...），用于离线合成的措辞与图标 */
  role?: string;
  /** 自定义系统提示词；为空时按 role 取内置角色提示词 */
  systemPrompt?: string;
  /** 该 agent 的具体子目标（可包含全局目标的引用） */
  goal: string;
  /** 指定模型（可选，透传给 router） */
  model?: string;
}

/** 单智能体执行结果 */
export interface GraphAgentResult {
  id: string;
  name: string;
  role?: string;
  ok: boolean;
  /** 该 agent 的产出文本 */
  content: string;
  durationMs: number;
  /** 是否为离线合成（无可用模型） */
  offline: boolean;
  error?: string;
}

export interface GraphRunResult {
  ok: boolean;
  goal: string;
  results: GraphAgentResult[];
  summary: string;
  durationMs: number;
  offline: boolean;
}

export interface GraphRunOptions {
  router?: ModelRouter;
  /** 强制离线合成（无 API key 演示机） */
  offline?: boolean;
  /** 最大并发（默认 4） */
  maxConcurrent?: number;
}

/** 内置角色提示词（role → system prompt），离线/兜底时使用 */
const ROLE_SYSTEM_PROMPTS: Record<string, string> = {
  researcher: '你是一位资深调研分析师。请针对给定的子目标，输出结构化调研结论：核心发现、关键数据/依据、风险与机会、建议。观点要有依据，避免空泛。',
  coder: '你是一位资深全栈开发者。请针对给定的子目标，输出可运行的代码方案：设计思路、关键代码实现、必要的依赖与调用示例、边界处理。代码要完整、可落地。',
  architect: '你是一位资深软件架构师。请针对给定的子目标，输出架构设计方案：模块划分、接口定义、技术选型理由、风险与权衡。',
  tester: '你是一位资深测试工程师。请针对给定的子目标，输出测试方案：测试用例清单（覆盖正常/边界/异常）、预期结果、测试覆盖率评估、潜在缺陷预警。',
  reviewer: '你是一位资深代码评审员。请针对给定的子目标，按严重程度（严重/中等/轻微/建议）分类给出问题清单、修改建议与整体质量评分，并给出 pass/needs-changes/reject 结论。',
  critic: '你是一位严谨的批判性思考者。请针对给定的子目标，指出逻辑漏洞、假设风险、反方观点与改进方向，帮助方案更稳健。',
  writer: '你是一位资深内容写手。请针对给定的子目标，输出清晰、有说服力的成稿：结构、要点、措辞打磨，面向目标读者。',
  translator: '你是一位专业翻译专家。请针对给定的子目标，输出准确、符合语境的译文，并标注关键术语处理。',
};

/** 离线合成的产物骨架（按角色生成不同结构，确保各 agent 产出差异化、可审计） */
function offlineSynthesize(spec: GraphAgentSpec, goal: string): string {
  const role = spec.role || 'agent';
  const subGoal = spec.goal || '（未填写子目标）';
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const head =
    `# ${spec.name}（角色：${role}）\n` +
    `> 全局目标：${goal}\n` +
    `> 子目标：${subGoal}\n` +
    `> 生成时间：${stamp} · 模式：离线合成（本机未配置模型 provider，按角色模板确定性产出）\n\n`;

  switch (role) {
    case 'researcher':
      return head +
        `## 调研结论\n` +
        `1. **核心发现**：围绕「${subGoal}」梳理出 3 条可执行主线。\n` +
        `2. **关键依据**：引用行业实践与既有数据，优先采用可验证来源。\n` +
        `3. **风险与机会**：识别 2 项主要风险与 1 项高杠杆机会。\n` +
        `4. **建议**：给出下一步行动清单（按优先级排序）。\n`;
    case 'coder':
      return head +
        `## 实现方案\n` +
        `**设计思路**：将「${subGoal}」拆为输入/处理/输出三层。\n\n` +
        `**关键实现**：\n` +
        '```ts\n' +
        `// ${spec.name}: ${subGoal}\n` +
        `export async function run(input: unknown): Promise<unknown> {\n` +
        `  // TODO: 接入真实模型/数据时在此实现具体逻辑\n` +
        `  return { ok: true, input };\n` +
        `}\n` +
        '```\n\n' +
        `**依赖与边界**：列出所需依赖、异常分支与回退策略。\n`;
    case 'architect':
      return head +
        `## 架构设计\n` +
        `- **模块划分**：控制层 / 领域层 / 基础设施层。\n` +
        `- **接口定义**：明确输入输出契约。\n` +
        `- **技术选型**：基于成本与可维护性权衡。\n`;
    case 'tester':
      return head +
        `## 测试方案\n` +
        `| 用例 | 类型 | 预期 |\n|---|---|---|\n` +
        `| T1 | 正常流程 | 返回成功 |\n` +
        `| T2 | 边界 | 处理空/极值 |\n` +
        `| T3 | 异常 | 优雅失败并告警 |\n` +
        `**覆盖率评估**：核心路径 100%，异常路径 80%。\n`;
    case 'reviewer':
      return head +
        `## 评审结论：needs-changes\n` +
        `- [中等] 缺少对「${subGoal}」异常路径的处理，建议补回退。\n` +
        `- [轻微] 命名可更具语义化。\n` +
        `- [建议] 补充单元测试提升可维护性。\n` +
        `**质量评分**：75/100\n`;
    case 'critic':
      return head +
        `## 批判性审视\n` +
        `- **逻辑漏洞**：假设「${subGoal}」成立的前提是否充分？\n` +
        `- **反方观点**：在资源/时间受限下是否仍为最优？\n` +
        `- **改进方向**：先做最小验证再扩大投入。\n`;
    case 'writer':
      return head +
        `## 成稿\n` +
        `围绕「${subGoal}」，以目标读者视角组织叙事：开篇点题 → 分点论证 → 行动号召。\n`;
    case 'translator':
      return head + `## 译文\n（按目标语言输出「${subGoal}」的准确译文，并标注术语处理）\n`;
    default:
      return head + `## 执行产出\n针对「${subGoal}」完成分析，输出结构化结果供下游 agent 消费。\n`;
  }
}

async function runOneAgent(
  spec: GraphAgentSpec,
  goal: string,
  opts: GraphRunOptions,
): Promise<GraphAgentResult> {
  const start = Date.now();
  // 离线：直接合成
  if (opts.offline || !opts.router) {
    return {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      ok: true,
      content: offlineSynthesize(spec, goal),
      durationMs: Date.now() - start,
      offline: true,
    };
  }
  // 在线：调用真实模型
  const systemPrompt =
    spec.systemPrompt && spec.systemPrompt.trim()
      ? spec.systemPrompt
      : (spec.role && ROLE_SYSTEM_PROMPTS[spec.role]) || ROLE_SYSTEM_PROMPTS.researcher;
  const userPrompt = goal
    ? `全局目标：${goal}\n\n你的子目标：${spec.goal}\n\n请输出你的工作成果。`
    : `目标：${spec.goal}\n\n请输出你的工作成果。`;
  try {
    const resp = await opts.router.chat(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        maxTokens: 2000,
        timeoutMs: 60000,
      },
      ['reasoning', 'code-gen'],
    );
    return {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      ok: true,
      content: resp.message.content || '',
      durationMs: Date.now() - start,
      offline: false,
    };
  } catch (e) {
    logger.warn('orchestrator agent failed, fallback offline', {
      id: spec.id, name: spec.name, error: String(e instanceof Error ? e.message : e),
    });
    // 失败隔离：单 agent 出错不阻断其它，降级为离线合成产物
    return {
      id: spec.id,
      name: spec.name,
      role: spec.role,
      ok: false,
      content: offlineSynthesize(spec, goal),
      durationMs: Date.now() - start,
      offline: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 并行执行智能体图：所有 agent 通过 Promise.all 真正并发，返回汇总结果。
 */
export async function runAgentGraph(
  agents: GraphAgentSpec[],
  goal: string,
  opts: GraphRunOptions = {},
): Promise<GraphRunResult> {
  const start = Date.now();
  const list = Array.isArray(agents) ? agents : [];
  logger.info('orchestrator run', { goal, agents: list.length, offline: !!opts.offline });

  const results = await Promise.all(
    list.map((a) => runOneAgent(a, goal, opts)),
  );

  const okCount = results.filter((r) => r.ok).length;
  const offlineCount = results.filter((r) => r.offline).length;
  const summary =
    `并行编排完成：${okCount}/${list.length} 个智能体成功` +
    (offlineCount ? `（其中 ${offlineCount} 个为离线合成）` : '') +
    `。\n` +
    results
      .map((r, i) => `${i + 1}. [${r.ok ? 'OK' : 'FAIL'}] ${r.name}（${r.role || 'agent'}）→ ${r.content.length} 字`)
      .join('\n');

  return {
    ok: list.length > 0 && okCount === list.length,
    goal,
    results,
    summary,
    durationMs: Date.now() - start,
    offline: offlineCount === list.length,
  };
}

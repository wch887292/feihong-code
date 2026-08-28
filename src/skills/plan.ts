/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * /plan 技能：把目标转化为结构化实现计划（仅规划，不执行变更）。
 * 离线用规则生成；联调时可由模型产出更细致的方案。
 */
import { decomposeGoal } from '../agent/planner';

export interface PlanItem {
  step: number;
  action: string;
  target?: string;
  risk?: string;
}

export interface PlanOutput {
  goal: string;
  items: PlanItem[];
  estimatedWorktrees: number;
  note: string;
}

export function runPlan(goal: string): PlanOutput {
  const tasks = decomposeGoal(goal);

  const items: PlanItem[] = tasks.map((t, i) => ({
    step: i + 1,
    action: t.goal,
    target: inferTarget(t.goal),
    risk: inferRisk(t.goal),
  }));

  return {
    goal,
    items: items.length ? items : [{ step: 1, action: goal, risk: '目标过于笼统，建议拆分' }],
    estimatedWorktrees: Math.max(1, items.length),
    note: '本计划为只读输出，未对代码库做任何修改。确认后可用 --parallel 并行执行。',
  };
}

function inferTarget(text: string): string {
  const m = text.match(/(?:文件|模块|函数|类|组件|配置|接口|表)\s*[`'"']?([\w./-]+)/);
  return m ? m[1] : '（待勘察确定）';
}

function inferRisk(text: string): string {
  if (/删除|移除|重构|迁移|重命名/.test(text)) return '破坏性操作，需先备份/评审';
  if (/权限|密钥|token|密码|凭证/.test(text)) return '涉及敏感信息，需脱敏与最小权限';
  if (/并发|并行|性能|压测/.test(text)) return '需关注回归与资源占用';
  return '低风险，常规变更';
}

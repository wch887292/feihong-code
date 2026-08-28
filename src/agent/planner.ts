/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 规划器：
 *  - planTask(goal)：M1 最小版，返回可读步骤（单代理执行用）。
 *  - decomposeGoal(goal)：M2 升级，把大目标拆成可并行的子任务列表（多子代理用）。
 *    离线用规则拆分；联调时可由模型生成更智能的分解。
 */
import type { ChatMessage } from '../models/model.interface';

export interface Plan {
  steps: string[];
}

export interface SubTask {
  id: string;
  title: string;
  /** 派发给子代理的自然语言目标 */
  goal: string;
}

export function planTask(goal: string): { messages: ChatMessage[]; plan: Plan } {
  const plan: Plan = {
    steps: [
      '勘察工作区：了解目录结构与相关文件',
      '制定并应用变更（read/write/edit/shell）',
      '运行测试与构建验证变更有效',
      '收尾并给出总结',
    ],
  };
  const messages: ChatMessage[] = [{ role: 'user', content: goal }];
  return { messages, plan };
}

/**
 * 把目标拆成子任务。
 * 规则拆分（离线/无模型时）：
 *  - 含显式分隔（换行、分号、句号 + 序号、'并且'/'同时'/'分别'/'一方面…另一方面'）则按片段拆。
 *  - 否则整体作为一个子任务。
 * 生成的子任务目标彼此独立，适合并行隔离执行。
 */
export function decomposeGoal(goal: string): SubTask[] {
  const normalized = goal.trim();
  if (!normalized) return [];

  const fragments = splitByConjunctions(normalized);
  if (fragments.length <= 1) {
    return [{ id: 't1', title: '主线任务', goal: normalized }];
  }

  return fragments.map((frag, i) => ({
    id: `t${i + 1}`,
    title: frag.length > 24 ? frag.slice(0, 24) + '…' : frag,
    goal: frag,
  }));
}

/** 按中文/英文常见并列连词与标点拆分。
 *  拆分后会合并过短的片段回前一个，避免连贯句子被撕碎。
 *  阈值取 5：4 字以内（如"修改内容""先读文件"）是悬垂续接片段，应合并；
 *  5 字以上（如"实现登录模块""添加用户管理"）可承载完整独立任务，应保留为独立子任务。
 *  （曾用 12 导致"X 并且 Y"中 6 字级的合法任务被合并成一段，拆解失效。） */
const MIN_FRAGMENT_LEN = 5;

function splitByConjunctions(text: string): string[] {
  const raw = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?:；|;|。|并且|同时|分别|以及|还有|另外|一方面|另一方面)/))
    .map((s) => s.trim())
    .filter(Boolean);
  // 合并过短片段：长度 < MIN_FRAGMENT_LEN 的片段合并回前一个，避免"先读文件"被拆成独立子任务
  const merged: string[] = [];
  for (const frag of raw) {
    if (merged.length > 0 && frag.length < MIN_FRAGMENT_LEN) {
      merged[merged.length - 1] += '，' + frag;
    } else {
      merged.push(frag);
    }
  }
  // 若合并后只有一段，尝试按「做X和Y」式并列再拆
  if (merged.length <= 1) {
    // 注意：'并且' 必须排在 '并' 之前，否则会先把 '并且' 的 '并' 命中，
    // 把 '且…' 拆成 5 字级残片，破坏主拆分已形成的语义。
    const alt = text.split(/(?:并且|和|与|、|以及|并|加上)/).map((s) => s.trim()).filter(Boolean);
    if (alt.length > 1) {
      const mergedAlt: string[] = [];
      for (const frag of alt) {
        if (mergedAlt.length > 0 && frag.length < MIN_FRAGMENT_LEN) {
          mergedAlt[mergedAlt.length - 1] += '和' + frag;
        } else {
          mergedAlt.push(frag);
        }
      }
      if (mergedAlt.length > 1) return mergedAlt;
    }
  }
  return merged;
}

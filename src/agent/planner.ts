/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 规划器（M1 最小版）：把目标拆成可读步骤，并构造初始消息。
 * 完整规划/子代理分解在 M2 实现。
 */
import type { ChatMessage } from '../models/model.interface';

export interface Plan {
  steps: string[];
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

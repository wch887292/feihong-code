/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 脚本化 Mock Provider：离线闭环 / 测试用，无需 API key。
 * 让 Agent 编排循环在无真实模型时也能跑通，验证「模型→工具→回填」链路。
 */
import type { CapabilityTag } from '../../shared/types';
import type { ChatMessage, ChatRequest, ChatResponse, ModelProvider, TokenUsage } from '../model.interface';

export interface MockStep {
  message: ChatMessage;
  usage?: TokenUsage;
}

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/**
 * 按预设步骤依次返回响应的 provider。
 * orchestrator 每轮调用一次 chat()，依次消费 steps；
 * 步骤耗尽后固定返回最后一步（通常用于最终总结，不含 toolCalls）。
 */
export class ScriptedMockProvider implements ModelProvider {
  readonly id = 'mock';
  readonly model = 'mock-model';
  readonly tags: CapabilityTag[] = ['code-gen', 'cheap'];
  readonly costPer1k = 0;
  private idx = 0;

  constructor(private readonly steps: MockStep[]) {
    if (steps.length === 0) throw new Error('ScriptedMockProvider 至少需要一个步骤');
  }

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    const step = this.steps[Math.min(this.idx, this.steps.length - 1)];
    this.idx += 1;
    return {
      message: step.message,
      usage: step.usage ?? ZERO_USAGE,
      providerId: this.id,
      model: this.model,
      costUsd: 0,
    };
  }
}

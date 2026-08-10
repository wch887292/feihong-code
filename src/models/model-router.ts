/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 模型路由器：按策略选优（cost/capability/latency）+ 自动 fallback。
 * 不直接耦合任何供应商，组件注入，便于测试与扩展。
 */
import type { AppConfig } from '../shared/config';
import type { CapabilityTag, ModelStrategy } from '../shared/types';
import { ModelError } from '../shared/errors';
import { logger } from '../shared/logger';
import type { ChatRequest, ChatResponse, ModelProvider } from './model.interface';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { OllamaProvider } from './providers/ollama.provider';

export class ModelRouter {
  private readonly providers: ModelProvider[];
  private readonly strategy: ModelStrategy;
  private readonly budget: number;

  constructor(providers: ModelProvider[], strategy: ModelStrategy, budget: number) {
    this.providers = providers;
    this.strategy = strategy;
    this.budget = budget;
  }

  /** 从 AppConfig 构建（默认路由，联调真实模型时使用） */
  static fromConfig(cfg: AppConfig): ModelRouter {
    const providers = cfg.models.providers.map((p) =>
      p.type === 'ollama' ? new OllamaProvider(p) : new OpenAICompatibleProvider(p),
    );
    return new ModelRouter(providers, cfg.models.defaultStrategy, cfg.models.budgetPerTaskUsd);
  }

  /** 按策略排序后的 provider 列表（含能力过滤与 fallback 顺序） */
  rank(tags?: CapabilityTag[]): ModelProvider[] {
    let list = [...this.providers];
    if (tags && tags.length > 0) {
      const filtered = list.filter((p) => tags.every((t) => p.tags.includes(t)));
      if (filtered.length > 0) list = filtered;
    }
    return list.sort((a, b) => this.score(b) - this.score(a));
  }

  private score(p: ModelProvider): number {
    if (this.strategy === 'cost') return -(p.costPer1k ?? 0);
    if (this.strategy === 'latency') return p.tags.includes('local') ? 1 : 0;
    // capability：强推理 + 代码生成的供应商优先
    return (p.tags.includes('reasoning') ? 2 : 0) + (p.tags.includes('code-gen') ? 1 : 0);
  }

  /** 调用并自动 fallback；全部失败抛出最后错误 */
  async chat(req: ChatRequest, tags?: CapabilityTag[]): Promise<ChatResponse> {
    const order = this.rank(tags);
    let lastErr: unknown;
    for (const p of order) {
      try {
        const resp = await p.chat(req);
        if (this.budget > 0 && resp.costUsd > this.budget) {
          logger.warn('cost over budget', { provider: p.id, cost: resp.costUsd, budget: this.budget });
        }
        return resp;
      } catch (e) {
        logger.warn('provider failed, try next', {
          provider: p.id,
          error: e instanceof Error ? e.message : String(e),
        });
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new ModelError('所有 provider 均不可用', 'router');
  }
}

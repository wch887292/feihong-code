/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 模型路由器：按策略选优（cost/capability/latency）+ 自动 fallback。
 * 不直接耦合任何供应商，组件注入，便于测试与扩展。
 *
 * M6 增强：
 *  - 模型性能追踪（成功/失败统计）
 *  - 自动择优（基于历史成功率）
 *  - model-stats 命令支持
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { AppConfig } from '../shared/config';
import type { CapabilityTag, ModelStrategy } from '../shared/types';
import { ModelError } from '../shared/errors';
import { logger } from '../shared/logger';
import type { ChatRequest, ChatResponse, ModelProvider } from './model.interface';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { OllamaProvider } from './providers/ollama.provider';

export interface ModelStat {
  providerId: string;
  model: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  lastUsedAt: string;
  successRate: number;
}

export interface ModelStatsCache {
  version: number;
  stats: ModelStat[];
  updatedAt: string;
}

const STATS_VERSION = 1;
const DEFAULT_STATS_FILE = 'model-stats.jsonl';

export class ModelRouter {
  private readonly providers: ModelProvider[];
  private readonly strategy: ModelStrategy;
  private readonly budget: number;
  private readonly statsFile: string;
  private statsCache: ModelStatsCache | null = null;

  constructor(providers: ModelProvider[], strategy: ModelStrategy, budget: number, statsFile: string = '') {
    this.providers = providers;
    this.strategy = strategy;
    this.budget = budget;
    this.statsFile = statsFile || DEFAULT_STATS_FILE;
  }

  /** 从 AppConfig 构建（默认路由，联调真实模型时使用） */
  static fromConfig(cfg: AppConfig, statsFile?: string): ModelRouter {
    const providers = cfg.models.providers.map((p) =>
      p.type === 'ollama' ? new OllamaProvider(p) : new OpenAICompatibleProvider(p),
    );
    return new ModelRouter(providers, cfg.models.defaultStrategy, cfg.models.budgetPerTaskUsd, statsFile);
  }

  /** 加载性能统计缓存 */
  async loadStats(homeDir: string): Promise<void> {
    const file = join(homeDir, this.statsFile);
    if (!existsSync(file)) {
      this.statsCache = { version: STATS_VERSION, stats: [], updatedAt: new Date().toISOString() };
      return;
    }
    try {
      const content = await readFile(file, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const stats: ModelStat[] = [];
      for (const line of lines) {
        try {
          stats.push(JSON.parse(line) as ModelStat);
        } catch {
          // 跳过损坏记录
        }
      }
      this.statsCache = { version: STATS_VERSION, stats, updatedAt: new Date().toISOString() };
    } catch {
      this.statsCache = { version: STATS_VERSION, stats: [], updatedAt: new Date().toISOString() };
    }
  }

  /** 保存性能统计 */
  async saveStats(homeDir: string): Promise<void> {
    if (!this.statsCache) return;
    const file = join(homeDir, this.statsFile);
    await mkdir(homeDir, { recursive: true });
    const lines = this.statsCache.stats.map((s) => JSON.stringify(s)).join('\n') + '\n';
    await writeFile(file, lines, 'utf8');
  }

  /** 更新模型调用统计 */
  async updateStat(providerId: string, model: string, success: boolean, costUsd: number, latencyMs: number): Promise<void> {
    if (!this.statsCache) {
      this.statsCache = { version: STATS_VERSION, stats: [], updatedAt: new Date().toISOString() };
    }

    const existing = this.statsCache.stats.find((s) => s.providerId === providerId && s.model === model);
    if (existing) {
      existing.totalCalls++;
      if (success) existing.successfulCalls++;
      else existing.failedCalls++;
      existing.totalCostUsd += costUsd;
      existing.avgLatencyMs = (existing.avgLatencyMs * (existing.totalCalls - 1) + latencyMs) / existing.totalCalls;
      existing.lastUsedAt = new Date().toISOString();
      existing.successRate = existing.successfulCalls / existing.totalCalls;
    } else {
      this.statsCache.stats.push({
        providerId,
        model,
        totalCalls: 1,
        successfulCalls: success ? 1 : 0,
        failedCalls: success ? 0 : 1,
        totalCostUsd: costUsd,
        avgLatencyMs: latencyMs,
        lastUsedAt: new Date().toISOString(),
        successRate: success ? 1 : 0,
      });
    }
    this.statsCache.updatedAt = new Date().toISOString();
  }

  /** 获取模型统计报告 */
  getStats(): ModelStat[] {
    return this.statsCache?.stats ?? [];
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
    let base = 0;
    if (this.strategy === 'cost') base = -(p.costPer1k ?? 0);
    else if (this.strategy === 'latency') base = p.tags.includes('local') ? 1 : 0;
    else base = (p.tags.includes('reasoning') ? 2 : 0) + (p.tags.includes('code-gen') ? 1 : 0);

    // M6: 加权历史成功率（最多 0.3 分）
    if (this.statsCache) {
      const stat = this.statsCache.stats.find((s) => s.providerId === p.id);
      if (stat && stat.totalCalls >= 3) {
        base += stat.successRate * 0.3;
      }
    }
    return base;
  }

  /** 调用并自动 fallback；全部失败抛出最后错误 */
  async chat(req: ChatRequest, tags?: CapabilityTag[]): Promise<ChatResponse> {
    const order = this.rank(tags);
    let lastErr: unknown;
    const startTime = Date.now();

    for (const p of order) {
      try {
        const resp = await p.chat(req);
        const latency = Date.now() - startTime;

        // M6: 更新性能统计
        await this.updateStat(p.id, resp.model, true, resp.costUsd, latency);

        if (this.budget > 0 && resp.costUsd > this.budget) {
          logger.warn('cost over budget', { provider: p.id, cost: resp.costUsd, budget: this.budget });
        }
        return resp;
      } catch (e) {
        const latency = Date.now() - startTime;
        // M6: 记录失败
        await this.updateStat(p.id, '', false, 0, latency);
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


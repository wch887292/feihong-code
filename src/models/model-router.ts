/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 模型路由器：按策略选优（cost/capability/latency）+ 自动 fallback。
 * 不直接耦合任何供应商，组件注入，便于测试与扩展。
 *
 * M6 增强：
 *  - 模型性能追踪（成功/失败统计）
 *  - 自动择优（基于历史成功率）
 *  - model-stats 命令支持
 *
 * 模型异常自动轮换：
 *  - 上游返回 400/401/403/404（模型/鉴权类）：立即轮换到下一个可用模型，不重试同一模型
 *  - 上游返回 429/500/502/503/504（瞬时/服务端）：轮换下个模型并退避后重试整轮，直到任务完成或达到上限
 *  - 网络/未知错误：按可重试处理，同样触发轮换与重试
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

/** 模型/鉴权类错误：直接轮换到下一个可用模型，重试无意义 */
const ROTATE_ONLY_STATUS = new Set<number>([400, 401, 403, 404]);
/** 其余状态码（429/500/502/503/504 等瞬时错误）均视为可退避重试 */

export class ModelRouter {
  private readonly providers: ModelProvider[];
  private readonly strategy: ModelStrategy;
  private readonly budget: number;
  private readonly statsFile: string;
  private readonly statsHomeDir: string;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private statsCache: ModelStatsCache | null = null;

  constructor(
    providers: ModelProvider[],
    strategy: ModelStrategy,
    budget: number,
    statsFile: string = '',
    statsHomeDir: string = '',
    maxRetries: number = 3,
    backoffMs: number = 1000,
  ) {
    this.providers = providers;
    this.strategy = strategy;
    this.budget = budget;
    this.statsFile = statsFile || DEFAULT_STATS_FILE;
    this.statsHomeDir = statsHomeDir;
    this.maxRetries = Math.max(1, maxRetries);
    this.backoffMs = Math.max(0, backoffMs);
  }

  /** 从 AppConfig 构建（默认路由，联调真实模型时使用）；homeDir 用于统计自动落盘 */
  static fromConfig(cfg: AppConfig, statsFile?: string): ModelRouter {
    const providers = cfg.models.providers.map((p) =>
      p.type === 'ollama' ? new OllamaProvider(p) : new OpenAICompatibleProvider(p),
    );
    return new ModelRouter(
      providers,
      cfg.models.defaultStrategy,
      cfg.models.budgetPerTaskUsd,
      statsFile,
      cfg.app.homeDir,
      cfg.runtime.maxRetries,
    );
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

  /** 更新模型调用统计（并在配置了 homeDir 时同步落盘，供 model-stats 命令读取） */
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

    // M6 闭环修复：统计仅驻留内存则 model-stats 永远读不到数据，这里同步落盘
    if (this.statsHomeDir) {
      try {
        await this.saveStats(this.statsHomeDir);
      } catch (e) {
        logger.warn('failed to persist model stats', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
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

    // M6: 加权历史成功率（最多 0.3 分）；统计按 providerId+model 键控，查找需一致
    if (this.statsCache) {
      const stat = this.statsCache.stats.find((s) => s.providerId === p.id && s.model === p.model);
      if (stat && stat.totalCalls >= 3) {
        base += stat.successRate * 0.3;
      }
    }
    return base;
  }

  /**
   * 从错误中提取上游 HTTP 状态码（优先 ModelError.statusCode，兼容从消息解析 "HTTP <n>"）。
   * 网络/未知错误返回 undefined。
   */
  private statusOf(e: unknown): number | undefined {
    if (e instanceof ModelError) return e.statusCode;
    if (e instanceof Error) {
      const m = /HTTP\s+(\d{3})/.exec(e.message);
      if (m) return Number(m[1]);
    }
    return undefined;
  }

  /** 该错误是否值得退避重试（模型/鉴权类 400/401/403/404 不重试，其余默认重试） */
  private isRetryable(e: unknown): boolean {
    const status = this.statusOf(e);
    if (status === undefined) return true; // 网络/未知错误默认可重试
    return !ROTATE_ONLY_STATUS.has(status);
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  /**
   * 调用并自动轮换。按状态码分类：
   *  - 400/401/403/404（模型/鉴权类）：立即轮换下个可用模型，不做退避重试
   *  - 429/500/502/503/504（瞬时/服务端）：轮换下个模型，整轮结束后退避重试，直到任务完成或达到上限
   *  - 网络/未知错误：按可重试处理
   * 全部 provider 均不可用时抛出最后错误。
   */
  async chat(req: ChatRequest, tags?: CapabilityTag[]): Promise<ChatResponse> {
    const order = this.rank(tags);
    if (order.length === 0) {
      throw new ModelError('未配置任何可用模型 provider', 'router', 500);
    }

    const maxCycles = this.maxRetries;
    let lastErr: unknown;
    let lastRetryable = true;

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      for (const p of order) {
        const startTime = Date.now();
        try {
          const resp = await p.chat(req);
          const latency = Date.now() - startTime;

          // M6: 更新性能统计（成功记录响应模型名）
          await this.updateStat(p.id, resp.model, true, resp.costUsd, latency);

          if (this.budget > 0 && resp.costUsd > this.budget) {
            logger.warn('cost over budget', { provider: p.id, cost: resp.costUsd, budget: this.budget });
          }
          return resp;
        } catch (e) {
          const latency = Date.now() - startTime;
          // M6: 记录失败（用 provider 配置的模型名，避免统计出 model='' 的空条目）
          await this.updateStat(p.id, p.model, false, 0, latency);
          const status = this.statusOf(e);
          lastErr = e;
          lastRetryable = this.isRetryable(e);
          logger.warn('模型调用失败，自动轮换下个模型', {
            provider: p.id,
            status,
            cycle: cycle + 1,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // 整轮结束：若原因是模型/鉴权类（400/401 等），退避重试无意义，直接终止
      if (!lastRetryable) break;
      // 瞬时错误（429/500 等）：退避后重试下一轮，直到任务完成或达到上限
      if (cycle < maxCycles - 1) {
        await this.sleep(this.backoffMs * Math.pow(2, cycle));
      }
    }

    throw lastErr instanceof Error ? lastErr : new ModelError('所有可用模型均调用失败', 'router', 500);
  }
}


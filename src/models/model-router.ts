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
import type { AppConfig, ProviderConfig } from '../shared/config';
import type { CapabilityTag, ModelStrategy } from '../shared/types';
import { TIERS, type ComputeTier } from './tier';
import { ModelError } from '../shared/errors';
import { logger } from '../shared/logger';
import type { ChatRequest, ChatResponse, ModelProvider } from './model.interface';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { AnthropicMessagesProvider } from './providers/anthropic-messages.provider';
import { resolveCredential, resolveProviderApiKey } from '../security/credentials';

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
  /** key 池编号（1 起），未配置 key 池时为 1；旧记录缺省视为 1 */
  keyIndex?: number;
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
/** key 级错误：优先在本 provider 内切下一把 key，key 池耗尽再跳下一家（对标 FCC fallback key 轮换） */
const KEY_ROTATE_STATUS = new Set<number>([401, 403, 429]);
/** 其余状态码（429/500/502/503/504 等瞬时错误）均视为可退避重试 */

export class ModelRouter {
  private readonly providers: ModelProvider[];
  private readonly strategy: ModelStrategy;
  private readonly budget: number;
  private readonly statsFile: string;
  private readonly statsHomeDir: string;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly tier: ComputeTier;
  private statsCache: ModelStatsCache | null = null;

  constructor(
    providers: ModelProvider[],
    strategy: ModelStrategy,
    budget: number,
    statsFile: string = '',
    statsHomeDir: string = '',
    maxRetries: number = 3,
    backoffMs: number = 1000,
    /** 算力档位（对标纳米Work 轻量/省钱/满血）；light/save 强制 cost 策略并偏好 cheap/local */
    tier: ComputeTier = 'full',
  ) {
    this.providers = providers;
    this.strategy = strategy;
    this.budget = budget;
    this.statsFile = statsFile || DEFAULT_STATS_FILE;
    this.statsHomeDir = statsHomeDir;
    this.maxRetries = Math.max(1, maxRetries);
    this.backoffMs = Math.max(0, backoffMs);
    this.tier = tier;
  }

  /** 从 AppConfig 构建（默认路由，联调真实模型时使用）；homeDir 用于统计自动落盘 */
  static fromConfig(cfg: AppConfig, statsFile?: string, tier: ComputeTier = 'full'): ModelRouter {
    // 凭据 seam（对标 dsh）：apiKeyEnv 引用优先解析，回退旧 apiKey 兼容存量配置
    const homeDir = cfg.app.homeDir;
    // Key 池第一阶段：只做配置解析与多 key 展开，不改轮换逻辑。
    // keyRefs 非空：逐项经凭据存储 resolveCredential 解析并收集非空 key（按配置顺序展开）；
    // 未配 keyRefs：回退 resolveProviderApiKey 单 key 行为（有值则单元素数组，否则空数组）
    const resolveKeyList = (p: ProviderConfig): string[] => {
      if (p.keyRefs && p.keyRefs.length > 0) {
        const keys: string[] = [];
        for (const ref of p.keyRefs) {
          const key = resolveCredential(ref, homeDir);
          if (key) keys.push(key);
        }
        return keys;
      }
      const singleKey = resolveProviderApiKey(p, homeDir);
      return singleKey ? [singleKey] : [];
    };

    const providers: ModelProvider[] = [];
    for (const p of cfg.models.providers) {
      const keyList = resolveKeyList(p);
      // key 池非空：每把 key 各建一个实例，id 保持 p.id 不变（兼容统计与日志）；
      // 列表为空：按原行为只建一个实例，apiKey 仍传 resolveProviderApiKey 的结果
      const normalizedList: ProviderConfig[] =
        keyList.length > 0
          ? keyList.map((key, idx) => ({ ...p, apiKey: key, keyIndex: idx + 1 }))
          : [{ ...p, apiKey: resolveProviderApiKey(p, homeDir) }];
      for (const normalized of normalizedList) {
        if (p.type === 'ollama') {
          providers.push(new OllamaProvider(normalized));
        } else if (p.type === 'anthropic-messages') {
          // anthropic-messages 为可选扩展协议（缺省不启用）：仅当需要接入 Claude 官方 /
          // Anthropic 兼容网关（如 DeepSeek 官方 Anthropic 端点 https://api.deepseek.com/anthropic）
          // 时才配置；不配置时走默认的 openai-compatible 分支，不影响现有 provider。
          providers.push(new AnthropicMessagesProvider(normalized));
        } else {
          providers.push(new OpenAICompatibleProvider(normalized));
        }
      }
    }
    return new ModelRouter(
      providers,
      cfg.models.defaultStrategy,
      cfg.models.budgetPerTaskUsd,
      statsFile,
      cfg.app.homeDir,
      cfg.runtime.maxRetries,
      1000,
      tier,
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
  async updateStat(providerId: string, model: string, success: boolean, costUsd: number, latencyMs: number, keyIndex: number = 1): Promise<void> {
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
      existing.keyIndex = keyIndex;
      existing.successRate = existing.successfulCalls / existing.totalCalls;
    } else {
      this.statsCache.stats.push({
        keyIndex,
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
    // 档位优先于策略：light/save 强制 cost 并偏好 cheap/local；full 沿用配置策略
    const strat = this.tier === 'full' ? this.strategy : TIERS[this.tier].strategy;
    let base = 0;
    if (strat === 'cost') {
      base = -(p.costPer1k ?? 0);
      if (this.tier !== 'full') {
        if (p.tags.includes('cheap')) base += 0.5;
        if (p.tags.includes('local')) base += 0.3;
      }
    } else if (strat === 'latency') base = p.tags.includes('local') ? 1 : 0;
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
   * 调用并自动轮换。按状态码分类处理（P0-1 起支持 provider 级 key 池）：
   *  - 401/403/429（key 级错误）：优先切同一 provider 的下一把 key，key 池耗尽再跳下一家
   *  - 400/404（模型类）：跳过本 provider 剩余 key，直接挑战下一家，不做退避重试
   *  - 其余 5xx（瞬时/服务端）：同上跳下一家，整轮结束后退避重试，直到任务完成或达到上限
   *  - 网络/未知错误：按可重试处理
   * 全部 provider（含各 key）均不可用时抛出最后错误。
   */
  async chat(req: ChatRequest, tags?: CapabilityTag[]): Promise<ChatResponse> {
    const order = this.rank(tags);
    if (order.length === 0) {
      throw new ModelError('未配置任何可用模型 provider', 'router', 500);
    }
    // 同 provider 的多个 key 实例聚拢相邻（keyIndex 升序），保证 401/429 时先切自家 key
    const grouped = this.groupByProvider(order);

    const maxCycles = this.maxRetries;
    let lastErr: unknown;
    let lastRetryable = true;

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      let i = 0;
      while (i < grouped.length) {
        const p = grouped[i];
        const startTime = Date.now();
        try {
          const resp = await p.chat(req);
          const latency = Date.now() - startTime;

          // M6: 更新性能统计（成功记录响应模型名）
          await this.updateStat(p.id, resp.model, true, resp.costUsd, latency, p.keyIndex ?? 1);

          if (this.budget > 0 && resp.costUsd > this.budget) {
            logger.warn('cost over budget', { provider: p.id, cost: resp.costUsd, budget: this.budget });
          }
          return resp;
        } catch (e) {
          const latency = Date.now() - startTime;
          // M6: 记录失败（用 provider 配置的模型名，避免统计出 model='' 的空条目）
          await this.updateStat(p.id, p.model, false, 0, latency, p.keyIndex ?? 1);
          const status = this.statusOf(e);
          lastErr = e;
          lastRetryable = this.isRetryable(e);
          logger.warn('模型调用失败，自动轮换', {
            provider: p.id,
            keyIndex: p.keyIndex ?? 1,
            status,
            cycle: cycle + 1,
            error: e instanceof Error ? e.message : String(e),
          });

          if (status !== undefined && KEY_ROTATE_STATUS.has(status)) {
            // key 级错误（401/403/429）：同 provider 还有下一把 key 就切 key，否则自然跳到下一家
            i += 1;
          } else {
            // 非 key 级错误：跳过本 provider 剩余 key，直接挑战下一家
            i += 1;
            while (i < grouped.length && grouped[i].id === p.id) i += 1;
          }
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

  /** 把 rank 结果按 provider 聚拢：同 provider 的 key 实例相邻且按 keyIndex 升序 */
  private groupByProvider(order: ModelProvider[]): ModelProvider[] {
    const groups = new Map<string, ModelProvider[]>();
    for (const p of order) {
      const arr = groups.get(p.id);
      if (arr) arr.push(p);
      else groups.set(p.id, [p]);
    }
    const grouped: ModelProvider[] = [];
    for (const arr of groups.values()) {
      arr.sort((a, b) => (a.keyIndex ?? 1) - (b.keyIndex ?? 1));
      grouped.push(...arr);
    }
    return grouped;
  }
}


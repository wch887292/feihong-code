/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 集中配置（铁律：所有配置来自环境变量，启动时校验，fail-fast，懒加载）
 */
import { ConfigError } from './errors';
import type { CapabilityTag, ModelStrategy } from './types';

export interface ProviderConfig {
  id: string;
  type: 'openai-compatible' | 'ollama';
  baseURL: string;
  /** 模型名（OpenAI 兼容接口必填；Ollama 指定本地模型） */
  model?: string;
  apiKey?: string;
  tags: CapabilityTag[];
  costPer1k?: number;
}

export interface AppConfig {
  app: { name: string; version: string; homeDir: string };
  models: {
    providers: ProviderConfig[];
    defaultStrategy: ModelStrategy;
    budgetPerTaskUsd: number;
  };
  runtime: { logDir: string; maxRetries: number };
  security: { shellAllowlist: string[]; requireApproval: boolean };
}

const APP_VERSION = '0.1.0';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(name);
  return v;
}

let cached: AppConfig | null = null;

/** 加载并校验配置（首次调用时执行，之后复用）。缺必需项立即抛 ConfigError。 */
export function loadConfig(): AppConfig {
  if (cached) return cached;

  const providersRaw = process.env.FH_PROVIDERS || '[]';
  let providers: ProviderConfig[] = [];
  try {
    const parsed = JSON.parse(providersRaw);
    if (!Array.isArray(parsed)) throw new Error('FH_PROVIDERS 必须为数组');
    providers = parsed as ProviderConfig[];
  } catch {
    throw new ConfigError('FH_PROVIDERS');
  }

  cached = {
    app: {
      name: 'feihong-code',
      version: APP_VERSION,
      homeDir: required('FH_HOME'),
    },
    models: {
      providers,
      defaultStrategy: (process.env.FH_MODEL_STRATEGY as ModelStrategy) || 'cost',
      budgetPerTaskUsd: Number(process.env.FH_BUDGET_USD || '0.5'),
    },
    runtime: {
      logDir: process.env.FH_LOG_DIR || '~/.feihong-code/sessions',
      maxRetries: 3,
    },
    security: {
      shellAllowlist: (process.env.FH_SHELL_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean),
      requireApproval: process.env.FH_REQUIRE_APPROVAL !== 'false',
    },
  };
  return cached;
}

/** 仅用于测试：重置缓存 */
export function __resetConfigForTest(): void {
  cached = null;
}

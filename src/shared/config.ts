/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 集中配置（铁律：所有配置来自环境变量，启动时校验，fail-fast，懒加载）
 */
import { ConfigError } from './errors';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { CapabilityTag, ModelStrategy } from './types';

/**
 * 极简 .env 加载器（不引入第三方依赖，离线可用）。
 * 在 cwd 下读取 .env（若存在），将 KEY=VALUE 注入 process.env（仅当该键尚未设置，避免覆盖显式环境变量）。
 * 值两侧的 ' 或 " 会被剥离。.env 必须被 .gitignore 排除，切勿提交真实密钥。
 */
export function loadDotEnv(cwd = process.cwd()): void {
  const file = join(cwd, '.env');
  if (!existsSync(file)) return;
  try {
    const text = readFileSync(file, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* 加载失败不影响离线模式 */
  }
}

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

/**
 * 解析主目录：优先 FH_HOME，缺省 ~/.feihong-code（避免缺环境变量即崩溃）。
 */
export function resolveHomeDir(): string {
  const h = process.env.FH_HOME?.trim();
  if (h) return h.startsWith('~') ? h.replace(/^~/, homedir()) : h;
  return join(homedir(), '.feihong-code');
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
      homeDir: resolveHomeDir(),
    },
    models: {
      providers,
      defaultStrategy: (process.env.FH_MODEL_STRATEGY as ModelStrategy) || 'cost',
      budgetPerTaskUsd: Number(process.env.FH_BUDGET_USD || '0.5'),
    },
    runtime: {
      logDir: process.env.FH_LOG_DIR || join(resolveHomeDir(), 'sessions'),
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

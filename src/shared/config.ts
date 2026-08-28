/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 集中配置（铁律：所有配置来自环境变量，启动时校验，fail-fast，懒加载）
 */
import { ConfigError } from './errors';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { VERSION } from '../cli/version';
import type { CapabilityTag, ModelStrategy } from './types';
import type { SandboxMode } from '../tools/sandbox';
import { normalizeSandboxMode } from '../tools/sandbox';
import type { McpServerConfig } from '../tools/mcp/mcp-client';
import { parseMcpServers } from '../tools/mcp';
import type { HookConfig } from '../runtime/hooks';
import { parseHooks } from '../runtime/hooks';
import { loadPlugins, type LoadedPlugins } from '../plugins/plugin-loader';

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
  /** P0-3：MCP 服务器列表（外部工具扩展） */
  mcp: { servers: McpServerConfig[] };
  /** P2-1：hooks 确定性控制（PreToolUse/PostToolUse/PostEdit/SessionStart） */
  hooks: HookConfig[];
  /** P3-3：插件（聚合的 skills 目录 / hooks / MCP） */
  plugins: LoadedPlugins;
  security: {
    shellAllowlist: string[];
    requireApproval: boolean;
    /** P0-2：沙箱模式（read-only / workspace-write / danger-full-access） */
    sandboxMode: SandboxMode;
    /** P0-2：网络域名规则（allow/deny，作用于 run_shell 命令中的 http(s) 目标） */
    networkAllow: string[];
    networkDeny: string[];
  };
}

/**
 * 解析主目录：优先 FH_HOME，缺省 ~/.feihong-code（避免缺环境变量即崩溃）。
 * 支持 `~` 前缀展开（Windows 下 HOME 不一定存在，统一走 os.homedir()）。
 */
export function resolveHomeDir(): string {
  const h = process.env.FH_HOME?.trim();
  if (h) return h.startsWith('~') ? h.replace(/^~/, homedir()) : h;
  return join(homedir(), '.feihong-code');
}

/** 展开路径开头的 `~`（对 FH_LOG_DIR 等单值环境变量复用） */
function expandTilde(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

let cached: AppConfig | null = null;

/**
 * 读取 fhcode 配置文件（JSON），按优先级：
 *   1) 显式 path
 *   2) FH_CONFIG 环境变量
 *   3) cwd/fhcode.config.json
 *   4) FH_HOME/fhcode.config.json
 * 文件缺失或 JSON 损坏时返回 null（不抛错，便于离线/默认配置）。
 */
export function loadConfigFile(path?: string): Partial<AppConfig> | null {
  const candidates = [
    path,
    process.env.FH_CONFIG,
    join(process.cwd(), 'fhcode.config.json'),
    join(resolveHomeDir(), 'fhcode.config.json'),
  ].filter(Boolean) as string[];
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as Partial<AppConfig>;
    } catch {
      /* 忽略损坏的配置文件 */
    }
  }
  return null;
}

/**
 * 单环境变量快速接入真实模型：
 *   FH_MODEL_NAME         模型名（必填，Ollama 即本地模型名）
 *   FH_MODEL_TYPE         'ollama' | 'openai-compatible'（缺省按 baseURL 推断）
 *   FH_MODEL_BASE_URL     接口地址（ollama 缺省 http://localhost:11434）
 *   FH_MODEL_API_KEY      OpenAI 兼容接口的 Bearer 令牌
 *   FH_MODEL_TAGS         逗号分隔能力标签（缺省 code-gen,reasoning[,local]）
 *   FH_MODEL_COST_PER_1K  每千 token 成本（USD，统计用，缺省 0）
 * 仅当 FH_PROVIDERS / 配置文件均未提供 provider 时生效。
 */
function buildProviderFromEnv(): ProviderConfig | null {
  const name = process.env.FH_MODEL_NAME || process.env.FH_OLLAMA_MODEL;
  if (!name) return null;
  const type: 'openai-compatible' | 'ollama' =
    (process.env.FH_MODEL_TYPE as 'openai-compatible' | 'ollama') ||
    (process.env.FH_MODEL_BASE_URL?.includes('ollama') ? 'ollama' : 'openai-compatible');
  const baseURL =
    process.env.FH_MODEL_BASE_URL || (type === 'ollama' ? 'http://localhost:11434' : '');
  if (type === 'openai-compatible' && !baseURL) return null;
  const tagStr =
    process.env.FH_MODEL_TAGS ||
    (type === 'ollama' ? 'code-gen,reasoning,local' : 'code-gen,reasoning');
  const tags = tagStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as CapabilityTag[];
  return {
    id: name,
    type,
    baseURL,
    model: name,
    apiKey: process.env.FH_MODEL_API_KEY || undefined,
    tags,
    costPer1k: Number(process.env.FH_MODEL_COST_PER_1K || '0'),
  };
}

/**
 * 解析模型供应商列表（三级优先级）：
 *   1) FH_PROVIDERS 显式 JSON（最高优先级）
 *   2) 配置文件 models.providers
 *   3) 单环境变量（FH_MODEL_NAME 等）自动构建一个 provider
 * 三者皆无则返回空数组（真实模式会在调用时给出明确报错）。
 */
function resolveProviders(fileCfg?: Partial<AppConfig> | null): ProviderConfig[] {
  if (process.env.FH_PROVIDERS) {
    try {
      const parsed = JSON.parse(process.env.FH_PROVIDERS);
      if (!Array.isArray(parsed)) throw new Error('FH_PROVIDERS 必须为数组');
      return parsed as ProviderConfig[];
    } catch {
      throw new ConfigError('FH_PROVIDERS');
    }
  }
  const fileProviders = fileCfg?.models?.providers;
  if (Array.isArray(fileProviders) && fileProviders.length > 0) {
    return fileProviders as ProviderConfig[];
  }
  const envProv = buildProviderFromEnv();
  if (envProv) return [envProv];
  return [];
}

/** 加载并校验配置（首次调用时执行，之后复用）。缺必需项立即抛 ConfigError。 */
export function loadConfig(): AppConfig {
  if (cached) return cached;

  const fileCfg = loadConfigFile();
  const providers = resolveProviders(fileCfg);
  // P3-3：插件聚合（用户级 + 项目级）
  const plugins = loadPlugins(process.cwd());

  cached = {
    app: {
      name: 'feihong-code',
      version: VERSION,
      homeDir: resolveHomeDir(),
    },
    models: {
      providers,
      defaultStrategy:
        (process.env.FH_MODEL_STRATEGY as ModelStrategy) ||
        fileCfg?.models?.defaultStrategy ||
        'cost',
      budgetPerTaskUsd: Number(
        process.env.FH_BUDGET_USD || fileCfg?.models?.budgetPerTaskUsd || '0.5',
      ),
    },
    runtime: {
      logDir: process.env.FH_LOG_DIR ? expandTilde(process.env.FH_LOG_DIR) : join(resolveHomeDir(), 'sessions'),
      maxRetries: 3,
    },
    // P0-3：MCP 服务器（FH_MCP_SERVERS 环境变量优先，其次配置文件 mcp.servers；插件 MCP 叠加）
    mcp: {
      servers: [
        ...(parseMcpServers(process.env.FH_MCP_SERVERS).length > 0
          ? parseMcpServers(process.env.FH_MCP_SERVERS)
          : (fileCfg?.mcp?.servers ?? [])),
        ...plugins.mcp,
      ],
    },
    // P2-1：hooks（FH_HOOKS 环境变量优先，其次配置文件 hooks；插件 hooks 叠加）
    hooks: [
      ...(parseHooks(process.env.FH_HOOKS).length > 0
        ? parseHooks(process.env.FH_HOOKS)
        : (fileCfg?.hooks ?? [])),
      ...plugins.hooks,
    ],
    // P3-3：插件（用户级 + 项目级），聚合技能目录/hooks/MCP，与显式配置叠加
    plugins,
    security: {
      shellAllowlist: (process.env.FH_SHELL_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean),
      requireApproval: process.env.FH_REQUIRE_APPROVAL !== 'false',
      sandboxMode: normalizeSandboxMode(process.env.FH_SANDBOX_MODE),
      networkAllow: (process.env.FH_NETWORK_ALLOW || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      networkDeny: (process.env.FH_NETWORK_DENY || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    },
  };
  return cached;
}

/** 仅用于测试：重置缓存 */
export function __resetConfigForTest(): void {
  cached = null;
}

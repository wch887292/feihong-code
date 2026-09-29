/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * MCP 隧道内置能力 — 隧道配置管理。
 * 配置文件：~/.feihong-code/tunnel-config.json
 * 用途：ChatGPT 网页等外部 MCP 客户端通过 OpenAI Secure MCP Tunnel
 *       调用 fhcode 内置 MCP Server 暴露的本地工具（不消耗 Work/Codex 额度）。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { logger } from '../shared/logger';
import { normalizeSandboxMode, type SandboxMode } from '../tools/sandbox';

export const TUNNEL_CONFIG_FILE = 'tunnel-config.json';
export const TUNNEL_PROFILE_PREFIX = 'fhcode-local';

export interface TunnelConfig {
  /** OpenAI 平台创建的隧道 ID（tunnel_ 开头） */
  tunnel_id: string;
  /** Runtime API Key（仅用于隧道认证，不参与 API 计费；单次显示，妥善保管） */
  api_key: string;
  /** tunnel-client profile 名（默认 fhcode-local） */
  profile: string;
  /** MCP channel（默认 main） */
  channel: string;
  /** 暴露给隧道/外部客户端的工具白名单（默认只读核心工具） */
  tools: string[];
  /** 允许访问的工作区根目录（MCP Server 的 cwd，仅此范围内操作） */
  workspace: string;
  /** 沙箱模式：read-only（默认）/ workspace-write / danger-full-access */
  sandbox_mode: SandboxMode;
  /** shell 命令白名单前缀（sandbox_mode=workspace-write 时生效） */
  shell_allowlist: string[];
  /** tunnel-client 可执行文件路径；'auto' = 从 PATH/常见位置查找 */
  tunnel_client: string;
  /** 是否要求每次写操作人工审批 */
  require_approval: boolean;
  /** 更新时间 */
  updated_at: string;
}

/** 默认只读工具白名单（安全基线：内置隧道默认不暴露写/执行） */
export const DEFAULT_TOOLS = ['read_file', 'list_dir', 'grep'];
export const EXTRA_SAFE_TOOLS = ['run_tests', 'build_check'];
export const WRITE_TOOLS = ['write_file', 'edit_file'];
export const SHELL_TOOL = 'run_shell';

export function defaultTunnelConfig(): TunnelConfig {
  return {
    tunnel_id: '',
    api_key: '',
    profile: TUNNEL_PROFILE_PREFIX,
    channel: 'main',
    tools: [...DEFAULT_TOOLS],
    workspace: process.cwd() || homedir(),
    sandbox_mode: 'read-only',
    shell_allowlist: [],
    tunnel_client: 'auto',
    require_approval: true,
    updated_at: new Date().toISOString(),
  };
}

/** 配置目录（~/.feihong-code） */
export function tunnelConfigDir(): string {
  return join(homedir(), '.feihong-code');
}

export function tunnelConfigPath(): string {
  return join(tunnelConfigDir(), TUNNEL_CONFIG_FILE);
}

export function tunnelPidPath(): string {
  return join(tunnelConfigDir(), 'tunnel-client.pid');
}

export function tunnelLogPath(): string {
  return join(tunnelConfigDir(), 'tunnel-client.log');
}

/** 读取配置；不存在返回 null（不抛错） */
export function loadTunnelConfig(): TunnelConfig | null {
  const p = tunnelConfigPath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<TunnelConfig>;
    const base = defaultTunnelConfig();
    const cfg: TunnelConfig = {
      ...base,
      ...raw,
      profile: raw.profile || base.profile,
      channel: raw.channel || base.channel,
      tools: Array.isArray(raw.tools) && raw.tools.length > 0 ? raw.tools : base.tools,
      workspace: raw.workspace || base.workspace,
      sandbox_mode: normalizeSandboxMode(raw.sandbox_mode as string | undefined),
      shell_allowlist: Array.isArray(raw.shell_allowlist) ? raw.shell_allowlist : [],
      tunnel_client: raw.tunnel_client || 'auto',
      require_approval: raw.require_approval ?? true,
    };
    return cfg;
  } catch (e) {
    logger.warn('tunnel-config.json 解析失败', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** 保存配置（密钥不加密，仅本机可读；提示用户妥善保管） */
export function saveTunnelConfig(cfg: TunnelConfig): void {
  cfg.updated_at = new Date().toISOString();
  mkdirSync(tunnelConfigDir(), { recursive: true });
  writeFileSync(tunnelConfigPath(), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** 配置是否已就绪（tunnel_id 与 api_key 已填且非占位） */
export function tunnelConfigReady(cfg: TunnelConfig | null): boolean {
  if (!cfg) return false;
  return !!cfg.tunnel_id && !!cfg.api_key
    && !cfg.tunnel_id.startsWith('YOUR_') && !cfg.api_key.startsWith('YOUR_');
}

/** 配置脱敏摘要（status/check 展示用，api_key 只显示末 4 位） */
export function tunnelConfigSummary(cfg: TunnelConfig | null): string {
  if (!cfg) return '未配置（运行 fhcode tunnel init 初始化）';
  const keyMask = cfg.api_key ? `****${cfg.api_key.slice(-4)}` : '(空)';
  return [
    `tunnel_id: ${cfg.tunnel_id || '(空)'}`,
    `api_key: ${keyMask}`,
    `profile: ${cfg.profile}`,
    `channel: ${cfg.channel}`,
    `workspace: ${resolve(cfg.workspace)}`,
    `sandbox: ${cfg.sandbox_mode}`,
    `tools(${cfg.tools.length}): ${cfg.tools.join(', ')}`,
    `tunnel_client: ${cfg.tunnel_client}`,
  ].join('\n');
}

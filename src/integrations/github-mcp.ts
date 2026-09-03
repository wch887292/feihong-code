/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * GitHub MCP Server 接入：
 *  - 官方包：@modelcontextprotocol/server-github
 *  - 启动方式：npx -y @modelcontextprotocol/server-github
 *  - 认证：GITHUB_PERSONAL_ACCESS_TOKEN 环境变量
 *  - 能力：仓库管理、Issue/PR、代码搜索、文件读写、推送等
 *
 * 环境变量配置：
 *  FH_GITHUB_MCP_ENABLED=true          # 启用 GitHub MCP（默认 false）
 *  GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx # GitHub Personal Access Token（必需）
 *  FH_GITHUB_MCP_PACKAGE=@modelcontextprotocol/server-github  # 自定义包名（可选）
 *  FH_GITHUB_MCP_COMMAND=npx           # 启动命令（默认 npx）
 *
 * 配置文件方式（fhcode.config.json）：
 *  {
 *    "githubMcp": { "enabled": true, "token": "ghp_xxx" }
 *  }
 *
 * 安全：
 *  - Token 仅通过环境变量传递给 MCP 子进程，不落盘
 *  - 启用前校验 Token 格式（ghp_ 前缀，长度 >= 40）
 *  - MCP 工具受 ToolRegistry 沙箱/守卫统一约束
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../shared/logger';
import type { McpServerConfig } from '../tools/mcp/mcp-client';

/* ===================== 配置 ===================== */

export interface GithubMcpConfig {
  enabled: boolean;
  token: string;
  packageName: string;
  command: string;
  /** 自定义启动参数（默认 ["-y", packageName]） */
  args?: string[];
}

export function loadGithubMcpConfig(fileCfg?: Record<string, unknown> | null): GithubMcpConfig {
  const file = (fileCfg?.githubMcp ?? {}) as Partial<GithubMcpConfig>;
  return {
    enabled: process.env.FH_GITHUB_MCP_ENABLED === 'true' || file.enabled === true,
    token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || file.token || '',
    packageName: process.env.FH_GITHUB_MCP_PACKAGE || file.packageName || '@modelcontextprotocol/server-github',
    command: process.env.FH_GITHUB_MCP_COMMAND || file.command || 'npx',
    args: file.args,
  };
}

/** 校验 GitHub Personal Access Token 格式（ghp_ 前缀，经典 Token；github_pat_ 前缀，细粒度 Token） */
export function isValidGithubToken(token: string): boolean {
  if (!token || token.length < 40) return false;
  return token.startsWith('ghp_') || token.startsWith('github_pat_') || token.startsWith('gho_') || token.startsWith('ghu_') || token.startsWith('ghs_') || token.startsWith('ghr_');
}

/** GitHub MCP 是否可用（启用 + Token 有效） */
export function isGithubMcpAvailable(cfg: GithubMcpConfig): boolean {
  if (!cfg.enabled) return false;
  if (!isValidGithubToken(cfg.token)) {
    logger.warn('GitHub MCP token 格式无效，已跳过', { tokenPrefix: cfg.token.slice(0, 4) + '...' });
    return false;
  }
  return true;
}

/* ===================== McpServerConfig 生成 ===================== */

/**
 * 生成 GitHub MCP Server 的 McpServerConfig。
 * 工具名会以 github_<toolName> 前缀注册（如 github_create_issue）。
 */
export function buildGithubMcpConfig(cfg: GithubMcpConfig): McpServerConfig {
  return {
    name: 'github',
    command: cfg.command,
    args: cfg.args ?? ['-y', cfg.packageName],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: cfg.token,
      // 禁用 npm  fund/audit 提示，减少 stderr 噪音
      npm_config_fund: 'false',
      npm_config_audit: 'false',
    },
    initTimeoutMs: 60000, // 首次 npx 下载包可能较慢
    callTimeoutMs: 120000,
  };
}

/**
 * 从配置生成 GitHub MCP 服务器列表（可用时返回单元素数组，否则空数组）。
 * 供 config.ts 叠加到 mcp.servers。
 */
export function getGithubMcpServers(fileCfg?: Record<string, unknown> | null): McpServerConfig[] {
  const cfg = loadGithubMcpConfig(fileCfg);
  if (!isGithubMcpAvailable(cfg)) return [];
  const mcpCfg = buildGithubMcpConfig(cfg);
  logger.info('GitHub MCP Server 已启用', { package: cfg.packageName, command: cfg.command });
  return [mcpCfg];
}

/* ===================== GitHub MCP 工具清单（参考） ===================== */

/**
 * GitHub MCP Server 提供的主要工具（实际工具列表以运行时 tools/list 为准）。
 * 用于文档说明和前端展示，不影响实际注册。
 */
export const GITHUB_MCP_TOOL_CATALOG = [
  { category: '仓库', tools: ['get_repository', 'list_repositories', 'search_repositories', 'create_repository'] },
  { category: 'Issue', tools: ['create_issue', 'get_issue', 'list_issues', 'search_issues', 'update_issue', 'add_issue_comment'] },
  { category: 'Pull Request', tools: ['create_pull_request', 'get_pull_request', 'list_pull_requests', 'search_pull_requests', 'merge_pull_request', 'update_pull_request'] },
  { category: '代码', tools: ['get_file_contents', 'create_or_update_file', 'push_files', 'search_code', 'get_commit', 'list_commits'] },
  { category: '分支/标签', tools: ['list_branches', 'create_branch', 'list_tags', 'create_release'] },
  { category: '工作流', tools: ['list_workflow_runs', 'get_workflow_run', 'trigger_workflow_dispatch'] },
];

/* ===================== 环境检测 ===================== */

/** 检测 npx 是否可用（同步检查 node_modules/.bin 或全局） */
export function detectNpxAvailable(): boolean {
  // npx 随 npm 一起安装，检查 npm 是否可用即可
  try {
    // 简单检查：npm 根目录是否存在
    const npmRoot = process.env.npm_config_prefix || join(process.env.APPDATA || '', 'npm');
    return existsSync(join(npmRoot, 'npx.cmd')) || existsSync(join(npmRoot, 'npx'));
  } catch {
    return true; // 假设可用，实际启动失败时 attachMcpTools 会容错跳过
  }
}

/** 生成 GitHub MCP 接入状态报告（用于 /api/health 或诊断） */
export function getGithubMcpStatus(fileCfg?: Record<string, unknown> | null): {
  enabled: boolean;
  available: boolean;
  tokenConfigured: boolean;
  tokenValid: boolean;
  package: string;
  command: string;
  toolCount: number; // 预估工具数（实际以运行时为准）
} {
  const cfg = loadGithubMcpConfig(fileCfg);
  return {
    enabled: cfg.enabled,
    available: isGithubMcpAvailable(cfg),
    tokenConfigured: !!cfg.token,
    tokenValid: isValidGithubToken(cfg.token),
    package: cfg.packageName,
    command: cfg.command,
    toolCount: GITHUB_MCP_TOOL_CATALOG.reduce((sum, c) => sum + c.tools.length, 0),
  };
}

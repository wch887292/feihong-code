/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * MCP 隧道内置能力 — 权限策略。
 * 从 tunnel-config 构造 MCP Server 使用的安全上下文：
 *  - 工具白名单（只暴露配置允许的工具）
 *  - 沙箱模式（默认 read-only，写/执行需显式开启）
 *  - shell 白名单前缀 + 审批开关
 */
import { resolve, sep } from 'path';
import type { ToolSecurityConfig } from '../tools/tool.interface';
import type { SandboxRules } from '../tools/sandbox';
import type { TunnelConfig } from './tunnel-config';

/** 判断工具是否在暴露白名单内 */
export function isToolAllowed(cfg: TunnelConfig, toolName: string): boolean {
  return cfg.tools.includes(toolName);
}

/** 根据配置构造 ToolContext.security（沙箱 + shell 白名单 + 审批） */
export function buildToolSecurity(cfg: TunnelConfig): ToolSecurityConfig {
  const networkRules: SandboxRules = { networkAllow: [], networkDeny: [] };
  return {
    shellAllowlist: cfg.shell_allowlist,
    requireApproval: cfg.require_approval,
    sandboxMode: cfg.sandbox_mode,
    networkRules,
  };
}

/** 工作区规范化（不存在时回退用户主目录；防止路径逃逸到无关目录） */
export function normalizeWorkspace(ws: string): string {
  const p = resolve(ws || process.cwd() || '');
  return p;
}

/** 检查路径是否位于工作区根之内（MCP 层额外防线；返回 null=放行，否则返回原因） */
export function pathInsideWorkspace(workspace: string, target: string | undefined | null): string | null {
  if (!target) return null;
  const ws = normalizeWorkspace(workspace).toLowerCase();
  const tp = resolve(target).toLowerCase();
  if (tp === ws || tp.startsWith(ws + sep)) return null;
  return `目标路径 ${target} 不在授权工作区 ${ws} 内`;
}

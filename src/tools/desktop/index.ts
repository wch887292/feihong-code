/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * C 层 · feihong-desktop 挂载入口：
 * 把 feihong_desktop_see/act/verify 注册进 registry，并把共享的 MCP client
 * 注入 ToolContext（_desktopClient），避免重复 spawn desktop-touch 进程。
 */
import type { Tool } from '../tool.interface';
import type { McpClient } from '../mcp/mcp-client';
import { feihongDesktopTools } from './desktop.tool';
import { logger } from '../../shared/logger';

const DESKTOP_SERVER = 'desktop';

/**
 * 找到已连接的 desktop MCP client 并注册 feihong 原生工具。
 * 未连接（未配置/attach 失败）时静默跳过——不影响主流程。
 * 返回是否成功挂载。
 */
export function attachDesktopTools(
  registry: { register(t: Tool): void },
  clients: McpClient[],
): boolean {
  const client = clients.find((c) => c.serverName === DESKTOP_SERVER);
  if (!client) {
    logger.info('feihong-desktop 未挂载（未找到 desktop MCP client）');
    return false;
  }
  const desktopClient = {
    callTool: (name: string, args: Record<string, unknown>) => client.callTool(name, args),
  };
  for (const t of feihongDesktopTools) {
    registry.register(withClient(t, desktopClient));
  }
  logger.info('feihong-desktop 已挂载', { tools: feihongDesktopTools.map((t) => t.name).join(',') });
  return true;
}

/** 包装：把 desktopClient 注入 execute 的 ctx */
function withClient(tool: Tool, client: { callTool(name: string, args: Record<string, unknown>): Promise<unknown> }): Tool {
  const base = { ...tool };
  return {
    ...base,
    async execute(args, ctx) {
      return tool.execute(args, { ...ctx, _desktopClient: client } as never);
    },
  };
}

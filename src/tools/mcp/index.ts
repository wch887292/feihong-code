/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-3 MCP 工具适配层：把 MCP 服务器的工具包装成本地 Tool 注册进 ToolRegistry。
 *  - 工具名以 `<serverName>_<toolName>` 前缀注册，避免与内置工具冲突
 *  - 调用时透传 JSON-RPC tools/call，结果归一为 ToolResult
 *  - 沙箱/守卫在 ToolRegistry.execute 层统一生效（MCP 工具同样受约束）
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { McpClient, connectMcp, type McpServerConfig } from './mcp-client';
import { logger } from '../../shared/logger';

/** MCP 服务器配置解析：支持 FH_MCP_SERVERS（JSON 数组）与配置文件 mcpServers 字段 */
export function parseMcpServers(raw?: string | null): McpServerConfig[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is McpServerConfig => !!s && typeof s === 'object' && typeof s.name === 'string' && typeof s.command === 'string')
      .map((s) => ({ args: [], ...s }));
  } catch {
    logger.warn('FH_MCP_SERVERS 不是合法 JSON，已忽略');
    return [];
  }
}

/** 包装一个 MCP 工具为本地 Tool（schema 采用宽松 object，运行时再转发给服务器校验） */
function wrapMcpTool(serverName: string, tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }, client: McpClient): Tool {
  const fullName = `${serverName}_${tool.name}`;
  return {
    name: fullName,
    description: `[MCP ${serverName}] ${tool.description ?? tool.name}`,
    jsonSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    schema: z.record(z.string(), z.unknown()),
    async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      try {
        const res = await client.callTool(tool.name, args);
        return res.ok
          ? { ok: true, output: res.output || '(MCP 无文本输出)' }
          : { ok: false, output: '', error: res.error ?? 'MCP 工具调用失败' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('MCP tool call failed', { tool: fullName, error: msg });
        return { ok: false, output: '', error: msg };
      }
    },
  };
}

/** 连接一组 MCP 服务器并把它们的工具注册进 registry；返回已连接客户端（供关闭） */
export async function attachMcpTools(registry: { register(t: Tool): void }, servers: McpServerConfig[]): Promise<McpClient[]> {
  const clients: McpClient[] = [];
  for (const cfg of servers) {
    try {
      const client = await connectMcp(cfg);
      const tools = await client.listTools();
      for (const t of tools) {
        registry.register(wrapMcpTool(cfg.name, t, client));
      }
      clients.push(client);
      logger.info('MCP server attached', { name: cfg.name, tools: tools.length });
    } catch (e) {
      logger.warn('MCP server attach failed（跳过，不影响主流程）', {
        name: cfg.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return clients;
}

/** 关闭全部 MCP 客户端 */
export async function closeMcpClients(clients: McpClient[]): Promise<void> {
  await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
}

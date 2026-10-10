/**
 * MCP 工具路由中心（TheOne 核心能力之一）
 *
 * 作用：把 fhcode 原生能力封装为可统一路由、统一权限校验的工具总线，
 *      同时支持接入外部 MCP 服务作为 fhcode 的扩展工具。
 * 原则：
 *  - 沙箱权限唯一来源仍是 fhcode：文件路径白名单、命令黑名单在此统一校验；
 *  - 高危操作（rm -rf、生产写入等）强制人工审批（human-in-loop）。
 */
import type { ApprovalRequest, FhcodeEngineCapabilities, McpRouterOptions, McpToolDefinition } from '../types.js';

export interface McpRouter {
  tools: ReadonlyMap<string, McpToolDefinition>;
  registerExternal(server: string, tool: McpToolDefinition): void;
  call(toolName: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

/** 创建 MCP 工具路由中心 */
export function createMcpRouter(opts: McpRouterOptions): McpRouter {
  const tools = new Map<string, McpToolDefinition>();
  for (const t of opts.tools) tools.set(t.name, t);

  return {
    tools,

    registerExternal(server, tool) {
      // 外部工具名加服务器前缀，避免冲突
      tools.set(`${server}/${tool.name}`, tool);
    },

    async call(toolName, args) {
      const tool = tools.get(toolName);
      if (!tool) {
        throw new Error(`[theone-enhance] 未知工具: ${toolName}`);
      }

      // 1) 权限校验：写/执行类工具走人工审批（如配置开启）
      if (opts.requestApproval && tool.permission !== 'read') {
        const req: ApprovalRequest = {
          id: `mcp_ap_${Date.now()}`,
          reason: `MCP 工具 ${toolName} 需要执行 ${tool.permission} 操作`,
          risk: tool.permission === 'exec' || tool.permission === 'network' ? 'high' : 'medium',
          context: { tool: toolName, args },
          createdAt: Date.now(),
        };
        const ok = await opts.requestApproval(req);
        if (!ok) {
          throw new Error(`[theone-enhance] 用户拒绝执行 ${toolName}`);
        }
      }

      // 2) 命令黑名单校验（针对 exec 工具）
      if (tool.permission === 'exec') {
        const cmd = String(args['cmd'] ?? args['command'] ?? '');
        for (const re of opts.blockCommands) {
          if (re.test(cmd)) {
            throw new Error(`[theone-enhance] 命中命令黑名单: ${re}`);
          }
        }
      }

      // 3) 文件路径白名单校验（针对文件读写工具）
      if (tool.permission === 'write' || tool.permission === 'read') {
        const path = String(args['path'] ?? '');
        if (path && !isUnderAny(path, opts.allowPaths)) {
          throw new Error(`[theone-enhance] 路径不在白名单内: ${path}`);
        }
      }

      return tool.handler(args);
    },
  };
}

function isUnderAny(target: string, allowPaths: string[]): boolean {
  const norm = normalize(target);
  return allowPaths.some((p) => {
    const base = normalize(p);
    return norm === base || norm.startsWith(base.endsWith('/') ? base : `${base}/`);
  });
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

/** 便捷：把 fhcode 引擎能力封装为一组内置 MCP 工具 */
export function buildEngineTools(engine: FhcodeEngineCapabilities): McpToolDefinition[] {
  return [
    {
      name: 'read_file',
      description: '读取文件内容',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      permission: 'read',
      handler: async (args) => {
        const r = await engine.readFile(String(args['path']));
        return { content: [{ type: 'text', text: r.content }] };
      },
    },
    {
      name: 'write_file',
      description: '写入文件内容',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      permission: 'write',
      handler: async (args) => {
        const r = await engine.writeFile(String(args['path']), String(args['content']));
        return { content: [{ type: 'text', text: `written: ${r.changed}` }] };
      },
    },
    {
      name: 'run_command',
      description: '执行终端命令',
      inputSchema: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
      permission: 'exec',
      handler: async (args) => {
        const r = await engine.runCommand(String(args['cmd']));
        return { content: [{ type: 'text', text: `exit=${r.exitCode}\n${r.stdout}` }] };
      },
    },
    {
      name: 'run_tests',
      description: '执行单元测试',
      inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
      permission: 'exec',
      handler: async (args) => {
        const r = await engine.runTests(args['filter'] ? { filter: String(args['filter']) } : undefined);
        return { content: [{ type: 'text', text: `passed=${r.passed} failed=${r.failed}` }] };
      },
    },
  ];
}

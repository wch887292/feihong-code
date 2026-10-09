/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * MCP 隧道内置能力 — MCP Server（stdio transport）。
 * 让 fhcode 自己成为"本地执行端"：外部 MCP 客户端（ChatGPT 网页等，
 * 经 OpenAI Secure MCP Tunnel 转发）可调用 fhcode 暴露的本地工具。
 *
 * 协议约定与 src/tools/mcp/mcp-client.ts 一致：
 *  - 传输：stdio，每行一个 JSON-RPC 2.0 消息（NDJSON）
 *  - 生命周期：initialize → notifications/initialized → tools/list → tools/call
 *  - stdout 仅走协议；一切诊断写 stderr / 文件日志
 *
 * 安全基线：
 *  - 只暴露 tunnel-config.tools 白名单内的工具
 *  - 沙箱（默认 read-only）与路径防逃逸在调用前生效
 *  - 写/执行类工具默认不暴露，需用户显式开启
 */
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import { basename } from 'path';
import { logger } from '../shared/logger';
import type { ToolRegistry } from '../tools';
import type { ToolContext } from '../tools/tool.interface';
import type { TunnelConfig } from './tunnel-config';
import { buildToolSecurity, normalizeWorkspace, pathInsideWorkspace } from './policy';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_NAME = 'feihong-code';
export const MCP_SERVER_VERSION = '8.8.6-tunnel';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function send(msg: JsonRpcMessage): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendError(id: number | string | undefined, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/** 把 fhcode Tool 转成 MCP tools/list 条目 */
function toMcpTool(tool: { name: string; description: string; jsonSchema: Record<string, unknown> }) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.jsonSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
  };
}

/**
 * 运行内置 MCP Server（stdio），直到进程退出。
 * @param registry 工具注册表（通常为 createDefaultRegistry()）
 * @param cfg 隧道配置（决定白名单/沙箱/工作区）
 */
export function runMcpServer(registry: ToolRegistry, cfg: TunnelConfig): Promise<void> {
  const workspace = normalizeWorkspace(cfg.workspace);
  const security = buildToolSecurity(cfg);
  const allowed = new Set(cfg.tools);

  // 预注册工具（白名单外的不向 MCP 暴露）
  const visible = registry.list().filter((t) => allowed.has(t.name));

  logger.info('MCP Server 启动', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    workspace,
    sandbox: cfg.sandbox_mode,
    tools: visible.map((t) => t.name),
  });

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let initialized = false;

  const handle = async (line: string): Promise<void> => {
    if (!line.trim()) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      sendError(undefined, -32700, 'Parse error');
      return;
    }

    const method = msg.method ?? '';
    const id = msg.id;

    switch (method) {
      case 'initialize': {
        const params = (msg.params ?? {}) as { protocolVersion?: string; clientInfo?: Record<string, unknown> };
        const client = params.clientInfo ?? {};
        logger.info('MCP initialize', { client: String(client.name ?? 'unknown') });
        initialized = true;
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          },
        });
        return;
      }

      case 'notifications/initialized':
        // 客户端就绪通知，无需响应
        return;

      case 'ping':
        send({ jsonrpc: '2.0', id, result: {} });
        return;

      case 'tools/list': {
        if (!initialized) {
          sendError(id, -32002, 'Server not initialized');
          return;
        }
        send({ jsonrpc: '2.0', id, result: { tools: visible.map(toMcpTool) } });
        return;
      }

      case 'tools/call': {
        if (!initialized) {
          sendError(id, -32002, 'Server not initialized');
          return;
        }
        const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const name = params.name ?? '';
        const args = (params.arguments ?? {}) as Record<string, unknown>;

        if (!allowed.has(name)) {
          sendError(id, -32602, `工具 ${name} 不在隧道白名单（当前允许: ${[...allowed].join(', ') || '(空)'}）`);
          return;
        }
        const tool = registry.get(name);
        if (!tool) {
          sendError(id, -32602, `未知工具: ${name}`);
          return;
        }

        // 路径防逃逸：对带 path/file 参数的工具做工作区校验
        const target = typeof args.path === 'string' ? args.path : typeof args.file === 'string' ? args.file : undefined;
        if (target) {
          const deny = pathInsideWorkspace(workspace, target);
          if (deny) {
            sendError(id, -32602, `[路径拦截] ${deny}`);
            return;
          }
        }

        const ctx: ToolContext = {
          runId: randomUUID(),
          cwd: workspace,
          security,
        };

        try {
          const result = await registry.execute(name, args, ctx);
          send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: result.output || (result.ok ? '(无输出)' : '') }],
              isError: !result.ok,
            },
          });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          logger.error('MCP tools/call 异常', { tool: name, error: errMsg });
          sendError(id, -32603, errMsg);
        }
        return;
      }

      default:
        sendError(id, -32601, `Method not found: ${method}`);
        return;
    }
  };

  return new Promise<void>((resolvePromise) => {
    rl.on('line', (line) => {
      handle(line).catch((e) => {
        logger.error('MCP 消息处理失败', { error: e instanceof Error ? e.message : String(e) });
      });
    });
    rl.on('close', () => {
      logger.info('MCP Server stdin 关闭，退出');
      resolvePromise();
    });
    const onSignal = (sig: string): void => {
      logger.info('MCP Server 收到信号退出', { sig });
      resolvePromise();
    };
    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));
  });
}

/** 供 CLI 展示的工具清单（含建议开启的说明） */
export function describeTools(allTools: Array<{ name: string; description: string }>): string {
  const lines = allTools.map((t) => `  ${t.name} — ${t.description.split('\n')[0]}`);
  return lines.join('\n') || '  (无)';
}

/** 从工具名推断默认建议（写/执行类工具提醒风险） */
export function toolRiskHint(name: string): string | null {
  const base = basename(name);
  if (base === 'write_file' || base === 'edit_file') return '写文件类：会修改工作区文件，请确认需要时再开启';
  if (base === 'run_shell') return '命令执行类：允许在本地执行命令，风险最高，谨慎开启';
  if (base === 'run_tests' || base === 'build_check') return '测试/构建类：会运行命令，建议配合沙箱使用';
  return null;
}

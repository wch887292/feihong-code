#!/usr/bin/env node
/**
 * Mock MCP stdio 服务器（测试夹具）
 * 协议：每行一个 JSON-RPC 2.0 消息（NDJSON），与官方 stdio transport 一致。
 * 支持：initialize / notifications/initialized / tools/list / tools/call
 */
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
      },
    });
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'uppercase',
            description: '把输入文本转大写',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
          {
            name: 'fail_tool',
            description: '总是失败的测试工具',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    if (name === 'uppercase') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: String(args?.text ?? '').toUpperCase() }],
          isError: false,
        },
      });
    } else if (name === 'fail_tool') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: 'boom' }], isError: true },
      });
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown tool: ${name}` } });
    }
  }
  // notifications/initialized 等通知无需响应
});

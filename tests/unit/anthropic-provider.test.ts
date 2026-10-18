/**
 * Anthropic Messages Provider 单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：system 抽取 / 消息与工具映射 / tool_use→ToolCall 归一 / 非 200 → ModelError
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { AnthropicMessagesProvider } from '../../src/models/providers/anthropic-messages.provider';
import { ModelError } from '../../src/shared/errors';
import type { ChatRequest } from '../../src/models/model.interface';
import type { ProviderConfig } from '../../src/shared/config';

function startMockServer(handler: (body: unknown) => { status: number; json?: unknown }): Promise<{ server: Server; baseURL: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        const out = handler(body);
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(out.json !== undefined ? JSON.stringify(out.json) : '');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseURL: `http://127.0.0.1:${port}` });
    });
  });
}

const baseCfg: ProviderConfig = {
  id: 'mock-anthropic',
  type: 'anthropic-messages',
  baseURL: 'http://127.0.0.1:0',
  model: 'deepseek-flash',
  apiKey: 'sk-test',
  tags: ['code-gen', 'reasoning'],
  costPer1k: 0,
};

test('anthropic: system 抽到顶层，工具结果映射为 tool_result', async () => {
  let captured: Record<string, unknown> | undefined;
  const { server, baseURL } = await startMockServer((body) => {
    captured = body as Record<string, unknown>;
    return {
      status: 200,
      json: {
        id: 'msg_1',
        model: 'deepseek-flash',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    };
  });
  try {
    const provider = new AnthropicMessagesProvider({ ...baseCfg, baseURL });
    const req: ChatRequest = {
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: 'hi' },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'call_1' },
      ],
      tools: [{ name: 'read_file', description: '读文件', parameters: { type: 'object', properties: {} } }],
    };
    const res = await provider.chat(req);
    assert.ok(captured);
    assert.equal(captured['system'], '你是助手', 'system 应抽到顶层');
    assert.equal((captured['messages'] as unknown[]).length, 2, 'system 已抽顶层，messages 剩 user + tool_result 两条');
    const toolResult = (captured['messages'] as Array<{ role: string; content: Array<{ type: string; tool_use_id: string }> }>)[1];
    assert.equal(toolResult.role, 'user');
    assert.equal(toolResult.content[0].type, 'tool_result');
    assert.equal(toolResult.content[0].tool_use_id, 'call_1');
    // 工具 schema 映射
    const tools = (captured['tools'] as Array<{ name: string; input_schema: unknown }>);
    assert.equal(tools[0].name, 'read_file');
    assert.ok(tools[0].input_schema, 'input_schema 应存在');
    // 响应归一
    assert.equal(res.message.content, 'ok');
    assert.equal(res.usage.promptTokens, 10);
    assert.equal(res.usage.completionTokens, 5);
  } finally {
    server.close();
  }
});

test('anthropic: assistant tool_use → ToolCall 归一', async () => {
  const { server, baseURL } = await startMockServer(() => ({
    status: 200,
    json: {
      id: 'msg_2',
      model: 'deepseek-flash',
      content: [
        { type: 'text', text: '让我查一下' },
        { type: 'tool_use', id: 'toolu_1', name: 'run_shell', input: { command: 'ls' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 30 },
    },
  }));
  try {
    const provider = new AnthropicMessagesProvider({ ...baseCfg, baseURL });
    const res = await provider.chat({ messages: [{ role: 'user', content: 'ls' }] });
    assert.equal(res.message.content, '让我查一下');
    assert.equal(res.message.toolCalls?.length, 1);
    assert.equal(res.message.toolCalls![0].id, 'toolu_1');
    assert.equal(res.message.toolCalls![0].name, 'run_shell');
    assert.deepEqual(res.message.toolCalls![0].arguments, { command: 'ls' });
  } finally {
    server.close();
  }
});

test('anthropic: 历史 assistant toolCalls 转 tool_use 块往返', async () => {
  let capturedMessages: unknown[] | undefined;
  const { server, baseURL } = await startMockServer((body) => {
    capturedMessages = (body as Record<string, unknown>)['messages'] as unknown[];
    return { status: 200, json: { id: 'm3', model: 'deepseek-flash', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 1, output_tokens: 1 } } };
  });
  try {
    const provider = new AnthropicMessagesProvider({ ...baseCfg, baseURL });
    await provider.chat({
      messages: [
        { role: 'assistant', content: '我执行一下', toolCalls: [{ id: 'call_9', name: 'run_shell', arguments: { cmd: 'pwd' } }] },
        { role: 'tool', content: '/home', toolCallId: 'call_9' },
      ],
    });
    const assistantMsg = (capturedMessages as Array<{ role: string; content: Array<{ type: string; id?: string; name?: string; input?: unknown }> }>)[0];
    assert.equal(assistantMsg.role, 'assistant');
    const toolUse = assistantMsg.content.find((b) => b.type === 'tool_use');
    assert.ok(toolUse);
    assert.equal(toolUse!.id, 'call_9');
    assert.equal(toolUse!.name, 'run_shell');
    assert.deepEqual(toolUse!.input, { cmd: 'pwd' });
  } finally {
    server.close();
  }
});

test('anthropic: 非 200 抛 ModelError 且携带状态码', async () => {
  const { server, baseURL } = await startMockServer(() => ({ status: 429, json: { error: { message: 'rate limited' } } }));
  try {
    const provider = new AnthropicMessagesProvider({ ...baseCfg, baseURL });
    await assert.rejects(
      () => provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
      (err: unknown) => err instanceof ModelError && err.statusCode === 429,
    );
  } finally {
    server.close();
  }
});

test('anthropic: baseURL 带 /v1 后缀不重复拼接', async () => {
  let hitPath = '';
  const server = createServer((req, res) => {
    hitPath = req.url ?? '';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'm4', model: 'x', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address() as AddressInfo;
    const provider = new AnthropicMessagesProvider({ ...baseCfg, baseURL: `http://127.0.0.1:${port}/v1` });
    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(hitPath, '/v1/messages', '不应重复拼接 /v1');
  } finally {
    server.close();
  }
});

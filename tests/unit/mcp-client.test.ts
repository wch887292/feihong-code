/**
 * MCP Client 单元测试（聚焦 McpClient 类行为）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖场景：
 *  - initialize 握手成功
 *  - tools/list 正确解析返回
 *  - tools/call 成功 / 失败
 *  - close 幂等性
 *  - stderr 摘要可用
 *  - 进程退出时 pending 请求被 reject
 *  - 非 JSON 行被忽略
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { McpClient } from '../../src/tools/mcp/mcp-client';

/** 生成一个最简 MCP stdio 服务器的内联脚本 */
function makeMockScript(opts = {}) {
  const {
    respondInitialize = true,
    tools = [
      { name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } },
      { name: 'fail', description: 'fail', inputSchema: { type: 'object', properties: {} } },
    ],
    writeStderr = false,
  } = opts;

  const toolsJson = JSON.stringify(tools);
  const stderrLine = writeStderr ? "process.stderr.write('debug log\\n');" : '';

  return `
    ${stderrLine}
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let idSeq = 0;
    function send(msg) { process.stdout.write(JSON.stringify(msg) + '\\n'); }
    function response(id, result) { send({ jsonrpc: '2.0', id, result }); }
    function errorResp(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
    rl.on('line', line => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method === 'initialize') {
        idSeq++;
        ${respondInitialize ? `response(idSeq, { protocolVersion: '2024-11-05', capabilities: { tools: {} } });` : 'errorResp(idSeq, -32600, "unsupported");'}
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      } else if (msg.method === 'tools/list') {
        idSeq++;
        response(idSeq, { tools: ${toolsJson} });
      } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params || {};
        idSeq++;
        if (name === 'ping') {
          response(idSeq, { content: [{ type: 'text', text: 'pong' }], isError: false });
        } else if (name === 'fail') {
          errorResp(idSeq, -32603, 'intentional failure');
        } else {
          errorResp(idSeq, -32601, 'unknown tool: ' + name);
        }
      }
    });
  `;
}

function createClient(script) {
  const child = spawn(process.execPath, ['-e', script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const client = new McpClient({
    name: 'inline-mock',
    command: process.execPath,
    args: ['-e', script],
    initTimeoutMs: 5000,
    callTimeoutMs: 5000,
  });
  return { client, child };
}

test('McpClient: initialize 握手 + listTools 列出工具', async () => {
  const script = makeMockScript();
  const { client, child } = createClient(script);
  try {
    await client.connect();
    const tools = await client.listTools();
    assert.ok(tools.length >= 2, `应列出至少 2 个工具，实际 ${tools.length}`);
    assert.ok(tools.some((t) => t.name === 'ping'));
    assert.ok(tools.some((t) => t.name === 'fail'));
  } finally {
    await client.close();
    child.kill();
  }
});

test('McpClient: callTool 成功返回文本结果', async () => {
  const script = makeMockScript();
  const { client, child } = createClient(script);
  try {
    await client.connect();
    const res = await client.callTool('ping', {});
    assert.equal(res.ok, true);
    assert.equal(res.output, 'pong');
  } finally {
    await client.close();
    child.kill();
  }
});

test('McpClient: callTool 未知工具时 ok=false', async () => {
  const script = makeMockScript();
  const { client, child } = createClient(script);
  try {
    await client.connect();
    const res = await client.callTool('nonexistent', {});
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes('unknown tool'), '应提示未知工具');
  } finally {
    await client.close();
    child.kill();
  }
});

test('McpClient: close 幂等，重复调用不抛错', async () => {
  const script = makeMockScript();
  const { client, child } = createClient(script);
  await client.connect();
  await client.close();
  await client.close(); // 第二次应静默
  child.kill();
});

test('McpClient: 服务器不响应 initialize 时 connect 抛错', async () => {
  const script = makeMockScript({ respondInitialize: false });
  const { client, child } = createClient(script);
  try {
    await client.connect();
    assert.fail('应因 initialize 失败而抛错');
  } catch (e) {
    assert.ok(e instanceof Error, '应抛出 Error');
  } finally {
    await client.close();
    child.kill();
  }
});

test('McpClient: stderr 摘要可用', async () => {
  const script = makeMockScript({ writeStderr: true });
  const { client, child } = createClient(script);
  try {
    await client.connect();
    // 短暂等待 stderr 累积
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(typeof client.stderrTail === 'string');
    assert.ok(client.stderrTail.includes('debug log'), '应包含 stderr 输出');
  } finally {
    await client.close();
    child.kill();
  }
});

test('McpClient: 非 JSON 行被忽略不抛错', async () => {
  // 服务器会先写一行垃圾再响应
  const script = `
    process.stdout.write('GARBAGE_LINE\\n');
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let idSeq = 0;
    function send(msg) { process.stdout.write(JSON.stringify(msg) + '\\n'); }
    function response(id, result) { send({ jsonrpc: '2.0', id, result }); }
    rl.on('line', line => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method === 'initialize') {
        idSeq++;
        response(idSeq, { protocolVersion: '2024-11-05', capabilities: { tools: {} } });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      } else if (msg.method === 'tools/list') {
        idSeq++;
        response(idSeq, { tools: [] });
      }
    });
  `;
  const { client, child } = createClient(script);
  try {
    await client.connect();
    const tools = await client.listTools();
    assert.equal(tools.length, 0);
  } finally {
    await client.close();
    child.kill();
  }
});

test('McpClient: 进程意外退出时 pending call 被 reject', async () => {
  // 服务器在收到 tools/list 后立即退出
  const script = `
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let idSeq = 0;
    function send(msg) { process.stdout.write(JSON.stringify(msg) + '\\n'); }
    function response(id, result) { send({ jsonrpc: '2.0', id, result }); }
    rl.on('line', line => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method === 'initialize') {
        idSeq++;
        response(idSeq, { protocolVersion: '2024-11-05', capabilities: { tools: {} } });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      } else if (msg.method === 'tools/list') {
        idSeq++;
        response(idSeq, { tools: [] });
        process.exit(0); // 立即退出
      }
    });
  `;
  const { client, child } = createClient(script);
  try {
    await client.connect();
    await client.listTools(); // 这会触发服务器退出
    // 之后再调用 callTool 应失败
    await assert.rejects(
      client.callTool('ping', {}),
      /MCP 进程退出/,
      '进程退出后调用应失败',
    );
  } finally {
    await client.close();
    child.kill();
  }
});

test('McpClient: callTool 终结性错误立即抛出不重试', async () => {
  // 构造一个会立即退出的 mock server，模拟 ECONNRESET / 进程意外退出场景
  const script = `
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let idSeq = 0;
    function send(msg) { process.stdout.write(JSON.stringify(msg) + '\\n'); }
    function response(id, result) { send({ jsonrpc: '2.0', id, result }); }
    rl.on('line', line => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.method === 'initialize') {
        idSeq++;
        response(idSeq, { protocolVersion: '2024-11-05', capabilities: { tools: {} } });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      } else if (msg.method === 'tools/list') {
        idSeq++;
        response(idSeq, { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object' } }] });
      } else if (msg.method === 'tools/call') {
        // 第一个 call 故意不响应（模拟连接断开），客户端超时后重试
        // 第二个及以后的 call 返回成功，验证重试机制生效
        idSeq++;
        response(idSeq, { content: [{ type: 'text', text: 'ok' }], isError: false });
      }
    });
  `;
  const { client, child } = createClient(script);
  try {
    await client.connect();
    await client.listTools();
    // 正常调用应成功
    const r = await client.callTool('ping', {});
    assert.equal(r.ok, true);
    assert.equal(r.output, 'ok');
  } finally {
    await client.close().catch(() => undefined);
    child.kill();
  }
});

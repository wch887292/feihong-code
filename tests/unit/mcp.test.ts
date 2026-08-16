/**
 * MCP 客户端单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：initialize 握手 / tools/list / tools/call（成功与失败）/ 工具包装注册 / 超时清理
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { McpClient } from '../../src/tools/mcp/mcp-client';
import { attachMcpTools, parseMcpServers } from '../../src/tools/mcp';
import { ToolRegistry } from '../../src/tools/tool.registry';

const FIXTURE = join(__dirname, '..', 'fixtures', 'mock-mcp-server.mjs');

function serverCfg(overrides = {}) {
  return {
    name: 'mock',
    command: process.execPath,
    args: [FIXTURE],
    initTimeoutMs: 5000,
    callTimeoutMs: 5000,
    ...overrides,
  };
}

test('McpClient: initialize 握手 + listTools 列出工具', async () => {
  const client = new McpClient(serverCfg());
  try {
    await client.connect();
    const tools = await client.listTools();
    assert.ok(tools.length >= 2, '应列出至少 2 个工具');
    assert.ok(tools.some((t) => t.name === 'uppercase'));
  } finally {
    await client.close();
  }
});

test('McpClient: callTool 成功返回文本结果', async () => {
  const client = new McpClient(serverCfg());
  try {
    await client.connect();
    const res = await client.callTool('uppercase', { text: 'hello mcp' });
    assert.equal(res.ok, true);
    assert.equal(res.output, 'HELLO MCP');
  } finally {
    await client.close();
  }
});

test('McpClient: callTool 服务器报错时 ok=false', async () => {
  const client = new McpClient(serverCfg());
  try {
    await client.connect();
    const res = await client.callTool('fail_tool', {});
    assert.equal(res.ok, false);
    assert.ok(res.error);
  } finally {
    await client.close();
  }
});

test('attachMcpTools: 远程工具以前缀注册进 ToolRegistry 并可执行', async () => {
  const reg = new ToolRegistry();
  const clients = await attachMcpTools(reg, [serverCfg()]);
  try {
    const defs = reg.definitions();
    assert.ok(defs.some((d) => d.name === 'mock_uppercase'), '应注册 mock_uppercase');
    assert.ok(defs.some((d) => d.name === 'mock_fail_tool'), '应注册 mock_fail_tool');
    const result = await reg.execute('mock_uppercase', { text: 'abc' }, {
      runId: 'test',
      cwd: process.cwd(),
      security: { shellAllowlist: [], requireApproval: false },
    });
    assert.equal(result.ok, true);
    assert.equal(result.output, 'ABC');
  } finally {
    await import('../../src/tools/mcp/index').then((m) => m.closeMcpClients(clients));
  }
});

test('attachMcpTools: 服务器启动失败时跳过且不抛错（容错）', async () => {
  const reg = new ToolRegistry();
  const clients = await attachMcpTools(reg, [serverCfg({ command: 'definitely-not-a-real-cmd-xyz' })]);
  assert.equal(clients.length, 0, '失败服务器不应进入已连接列表');
  assert.equal(reg.list().length, 0);
});

test('parseMcpServers: 解析合法 JSON 并过滤非法项', () => {
  const servers = parseMcpServers(
    JSON.stringify([
      { name: 'a', command: 'npx', args: ['-y', '@x/y'] },
      { name: 'b' }, // 缺 command → 过滤
      'not-an-object', // 非对象 → 过滤
    ]),
  );
  assert.equal(servers.length, 1);
  assert.equal(servers[0].name, 'a');
  assert.deepEqual(servers[0].args, ['-y', '@x/y']);
  assert.deepEqual(parseMcpServers('not-json'), [], '非法 JSON 返回空');
  assert.deepEqual(parseMcpServers(null), []);
});

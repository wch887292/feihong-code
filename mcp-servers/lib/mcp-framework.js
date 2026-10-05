#!/usr/bin/env node
/**
 * 飞虹 Code · MCP 共享框架（stdio transport）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
 *
 * 用法：
 *   const { createMcpServer } = require('./lib/mcp-framework');
 *   createMcpServer({ name: 'xxx', version: '1.0.0', tools: [...] });
 *
 * 协议：JSON-RPC 2.0 over stdio (NDJSON)，protocolVersion 2024-11-05
 */
'use strict';
const readline = require('readline');

/**
 * 创建一个 MCP stdio server。
 * @param {Object} opts
 * @param {string} opts.name - server 名称
 * @param {string} opts.version - 版本
 * @param {Array}  opts.tools - 工具定义数组 [{name, description, inputSchema, handler}]
 */
function createMcpServer({ name, version, tools }) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }

  async function handleMcp(msg) {
    const { id, method } = msg;
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name, version },
        },
      });
      return;
    }
    if (method === 'notifications/initialized') return;
    if (method === 'tools/list') {
      send({
        jsonrpc: '2.0', id,
        result: {
          tools: tools.map(({ name, description, inputSchema }) => ({
            name, description, inputSchema: inputSchema || { type: 'object', properties: {} },
          })),
        },
      });
      return;
    }
    if (method === 'tools/call') {
      const params = msg.params || {};
      const toolName = params.name;
      const args = params.arguments || {};
      const tool = toolMap.get(toolName);
      if (!tool) {
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `错误：未知工具 ${toolName}` }], isError: true } });
        return;
      }
      try {
        const out = await tool.handler(args);
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }], isError: false } });
      } catch (e) {
        const err = (e && e.message) || String(e);
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `错误：${err}` }], isError: true } });
      }
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    handleMcp(msg).catch((e) => {
      send({ jsonrpc: '2.0', id: msg && msg.id, error: { code: -32603, message: (e && e.message) || String(e) } });
    });
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();

  // 诊断信息写 stderr（协议要求 stdout 仅走协议）
  process.stderr.write(`[mcp-framework] ${name} v${version} 启动，工具数=${tools.length}\n`);
}

/**
 * 通用 HTTP 请求封装（零依赖，用 Node 内置 https/http）。
 */
async function httpRequest({ url, method = 'GET', headers = {}, body = null, timeoutMs = 15000 }) {
  const mod = url.startsWith('https') ? require('https') : require('http');
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method, headers, timeout: timeoutMs,
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/** 从环境变量读取，缺失则抛错 */
function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`缺少环境变量 ${key}，请在 MCP 配置中设置`);
  return v;
}

module.exports = { createMcpServer, httpRequest, requireEnv };

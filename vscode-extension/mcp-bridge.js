#!/usr/bin/env node
/**
 * 飞虹 Code VS Code 扩展 · MCP stdio 桥
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 角色：被飞虹 Code 的 MCP stdio 客户端 spawn，作为"VS Code 工具源"。
 * 本协议层仅做 MCP stdio(JSON-RPC 2.0, NDJSON) <-> 本地 TCP(127.0.0.1:9599) 的转换与转发：
 *   - tools/list  -> 转发 __list_tools__ 到扩展 socket，取回工具清单
 *   - tools/call  -> 转发 { tool, args } 到扩展 socket，取回 { ok, output, error }
 *   - 实际能力由 VS Code 扩展内 mcp-server.js 用 vscode.* API 实现
 *
 * 与扩展 socket 断线时自动后台重连（VS Code 晚开也能恢复）。
 */
'use strict';
const net = require('net');
const readline = require('readline');

const HOST = '127.0.0.1';
const PORT = 9599;

let sock = null;
let sockReady = false;
const sockPending = new Map();
let sockSeq = 0;

function connectSocket() {
  if (sock) return;
  sock = net.connect(PORT, HOST, () => { sockReady = true; });
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!l.trim()) continue;
      let msg;
      try { msg = JSON.parse(l); } catch { continue; }
      const entry = sockPending.get(msg.id);
      if (entry) { sockPending.delete(msg.id); entry(msg); }
    }
  });
  sock.on('error', () => { sockReady = false; });
  sock.on('close', () => {
    sockReady = false;
    sock = null;
    setTimeout(connectSocket, 2000); // 后台重连
  });
}

/** 向扩展 socket 发请求并等待响应（带 110s 超时） */
function socketRequest(tool, args) {
  return new Promise((resolve) => {
    if (!sock || !sockReady) {
      resolve({ ok: false, error: 'VS Code 扩展未连接：请确认微软 VS Code 已打开且飞虹 Code 扩展已加载（左侧出现「飞虹 Code」图标）。' });
      return;
    }
    const id = ++sockSeq;
    const timer = setTimeout(() => {
      sockPending.delete(id);
      resolve({ ok: false, error: 'VS Code 扩展响应超时（>110s）' });
    }, 110000);
    sockPending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    sock.write(JSON.stringify({ id, tool, args }) + '\n');
  });
}

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
        serverInfo: { name: 'vscode-mcp-bridge', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized') return; // 通知，无响应
  if (method === 'tools/list') {
    const r = await socketRequest('__list_tools__', {});
    let tools = [];
    if (r.ok) {
      try { tools = JSON.parse(r.output || '[]'); } catch { tools = []; }
    }
    send({ jsonrpc: '2.0', id, result: { tools } });
    return;
  }
  if (method === 'tools/call') {
    const params = msg.params || {};
    const name = params.name;
    const args = params.arguments || {};
    const r = await socketRequest(name, args);
    send({
      jsonrpc: '2.0', id,
      result: {
        content: [{ type: 'text', text: r.ok ? (r.output || '') : ('错误：' + (r.error || '未知')) }],
        isError: !r.ok,
      },
    });
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handleMcp(msg).catch((e) => {
    send({ jsonrpc: '2.0', id: msg && msg.id, error: { code: -32603, message: (e && e.message) || String(e) } });
  });
});

// 启动即尝试连接扩展 socket（失败不影响 MCP 握手，后续重连）
connectSocket();

// 防止 stdin 无数据时进程退出（保持常驻，直到父进程关闭 stdin）
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();

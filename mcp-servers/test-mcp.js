#!/usr/bin/env node
/**
 * 飞虹 Code · MCP 服务器连通性测试
 * 用法：node mcp-servers/test-mcp.js [server-name]
 * 不传参数则测试全部 5 个平台
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const SERVERS = {
  doubao: 'doubao-mcp.js',
  wecom: 'wecom-mcp.js',
  feishu: 'feishu-mcp.js',
  dingtalk: 'dingtalk-mcp.js',
  workbuddy: 'workbuddy-mcp.js',
  git: 'git-mcp.js',
  browser: 'browser-mcp.js',
  desktopplus: 'desktopplus-mcp.js',
  figma: 'figma-mcp.js',
  db: 'db-mcp.js',
};

function testServer(name, file) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, file);
    const child = spawn('node', [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let id = 1;
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ name, ok: false, error: '超时（10秒无响应）' });
    }, 10000);

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdout.on('data', (d) => {
      stdout += d.toString();
      const lines = stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            // initialize 成功，发送 tools/list
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
          } else if (msg.id === 2 && msg.result) {
            clearTimeout(timeout);
            const tools = msg.result.tools || [];
            child.kill();
            resolve({ name, ok: true, tools: tools.map((t) => t.name) });
          }
        } catch { /* 非 JSON 行忽略 */ }
      }
    });
    child.on('error', (e) => {
      clearTimeout(timeout);
      resolve({ name, ok: false, error: e.message });
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (!stdout.includes('"result"')) {
        resolve({ name, ok: false, error: `进程退出 code=${code}, stderr=${stderr.slice(0, 200)}` });
      }
    });

    // 发送 initialize
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fhcode-test', version: '1.0' } },
    }) + '\n');
  });
}

async function main() {
  const target = process.argv[2];
  const targets = target ? { [target]: SERVERS[target] } : SERVERS;
  if (!targets || Object.keys(targets).length === 0) {
    console.log('未知的服务器名称。可用：' + Object.keys(SERVERS).join(', '));
    process.exit(1);
  }
  console.log('=== 飞虹 Code MCP 连通性测试 ===\n');
  for (const [name, file] of Object.entries(targets)) {
    process.stdout.write(`测试 ${name}... `);
    const result = await testServer(name, file);
    if (result.ok) {
      console.log(`OK (${result.tools.length} 个工具: ${result.tools.join(', ')})`);
    } else {
      console.log(`失败 - ${result.error}`);
    }
  }
  console.log('\n=== 测试完成 ===');
}

main().catch(console.error);

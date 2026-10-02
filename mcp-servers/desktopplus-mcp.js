#!/usr/bin/env node
/**
 * 飞虹 Code · 主机能力补全 MCP 服务器（工具提供侧，stdio）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 作用：补齐 desktop-touch-mcp（GUI 级：窗口/键鼠/截图/Excel）所缺的"编程式"主机能力：
 *   - host_shell        ：干净地执行 shell 命令并捕获 stdout/stderr/退出码（desktop 的 terminal 是往可见窗口发键，拿不到结构化输出）
 *   - clipboard_read/write：读写系统剪贴板（跨应用搬运文本）
 *   - host_file_read/write/list：对任意主机路径做文件 IO（不依赖 VS Code 是否打开）
 *
 * 传输：MCP stdio（JSON-RPC 2.0, NDJSON），与飞虹 Code 的 McpClient 对齐（protocolVersion 2024-11-05）。
 * 注：clipboard 依赖 Windows PowerShell；文件写操作对 C:/Windows 做硬性护栏以防误伤系统。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');

const TOOLS = [
  {
    name: 'host_shell',
    description: '在主机上执行一条 shell 命令并捕获结构化输出（stdout+stderr+退出码）。参数 command(必填)、cwd(可选)、timeoutMs(默认 60000，上限 300000)。用于跑 npm test / git / 系统查询等，拿到干净结果供智能体判断。',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['command'] },
  },
  {
    name: 'host_file_read',
    description: '读取主机任意路径的文本文件内容。参数 path(必填，绝对路径)。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'host_file_write',
    description: '写入（新建/覆盖）主机文件，自动创建父目录。参数 path(必填，绝对路径)、content(必填)。对 C:/Windows 路径硬性拒绝以防误伤系统。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'host_file_list',
    description: '列出目录内容。参数 dir(必填，绝对路径)、recursive(可选，默认 false)。',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' }, recursive: { type: 'boolean' } }, required: ['dir'] },
  },
  {
    name: 'clipboard_read',
    description: '读取系统剪贴板文本（Windows PowerShell Get-Clipboard）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'clipboard_write',
    description: '写入系统剪贴板文本（Windows PowerShell Set-Clipboard），便于跨应用搬运。参数 text(必填)。',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

/** 写护栏：禁止写入系统目录，避免误伤操作系统 */
function guardWritePath(p) {
  const abs = path.resolve(p);
  const bad = ['C:/Windows', 'C:/Windows/'].map((x) => x.toUpperCase());
  if (bad.some((b) => abs.toUpperCase().startsWith(b))) {
    throw new Error('拒绝写入系统目录（安全护栏）：' + abs + '。请在用户数据/项目目录内操作。');
  }
  return abs;
}

function runPs(script) {
  return new Promise((resolve, reject) => {
    cp.exec('powershell -NoProfile -NonInteractive -Command "' + script.replace(/"/g, '`"') + '"',
      { maxBuffer: 8 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
        if (err && !stdout && !stderr) return reject(err);
        resolve((stdout || '') + (stderr || ''));
      });
  });
}

async function runTool(name, args) {
  switch (name) {
    case 'host_shell': {
      const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
      const timeout = Math.min(Number(args.timeoutMs) || 60000, 300000);
      const out = await new Promise((resolve) => {
        cp.exec(args.command, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
          let s = (stdout || '') + (stderr || '');
          if (err) s += '\n[命令结束码 ' + (err.code ?? '?') + (err.signal ? ' signal=' + err.signal : '') + ']';
          resolve(s || '(无输出)');
        });
      });
      return '命令执行结果（cwd=' + cwd + '）：\n```\n' + out.slice(0, 20000) + '\n```';
    }
    case 'host_file_read': {
      const abs = path.resolve(args.path);
      if (!fs.existsSync(abs)) throw new Error('文件不存在：' + abs);
      const text = fs.readFileSync(abs, 'utf8');
      return '文件 ' + abs + '（' + text.length + ' 字符）：\n```\n' + text.slice(0, 60000) + '\n```';
    }
    case 'host_file_write': {
      const abs = guardWritePath(args.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, args.content || '', 'utf8');
      return '已写入 ' + abs + '（' + (args.content || '').length + ' 字符）。';
    }
    case 'host_file_list': {
      const abs = path.resolve(args.dir);
      if (!fs.existsSync(abs)) throw new Error('目录不存在：' + abs);
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      let lines = entries.map((e) => (e.isDirectory() ? '[D] ' : '[F] ') + e.name);
      if (args.recursive) {
        const walk = (d, depth) => {
          if (depth > 4) return;
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { lines.push('[D] ' + p); walk(p, depth + 1); }
            else lines.push('[F] ' + p);
          }
        };
        lines = []; walk(abs, 0);
      }
      return '目录 ' + abs + '（' + lines.length + ' 项）：\n' + lines.join('\n');
    }
    case 'clipboard_read': {
      // 经管道直读会被系统代码页(GPK/GBK)错位，改为写入 UTF-8 临时文件再由 Node 读回
      const tmp = path.join(os.tmpdir(), 'fh-clip-in-' + Date.now() + '.txt');
      await runPs('Get-Clipboard -Raw | Set-Content -Path "' + tmp + '" -Encoding utf8');
      let txt = '';
      try { txt = fs.readFileSync(tmp, 'utf8'); } catch { txt = ''; }
      try { fs.unlinkSync(tmp); } catch { /* noop */ }
      return '剪贴板内容（' + txt.length + ' 字符）：\n' + txt;
    }
    case 'clipboard_write': {
      // 直接 spawn clip.exe，把文本以 UTF-8 写入其 stdin。
      // 经实测：Set-Clipboard 跨进程进程退出即清空；clip.exe 经 stdin 管道写入可稳定持久化，
      // 且绕过 cmd 重定向路径解析报错与引号/编码问题（中文不乱码）。
      const out = await new Promise((resolve) => {
        const p = cp.spawn('clip.exe', [], { windowsHide: true });
        let s = '';
        p.stderr.on('data', (d) => { s += d.toString(); });
        p.on('error', (e) => resolve('spawn 失败: ' + e.message));
        p.stdin.on('error', () => { /* 忽略 */ });
        p.stdin.write(Buffer.from(args.text || '', 'utf8'));
        p.stdin.end();
        p.on('close', () => resolve(s));
      });
      return '已写入剪贴板（' + (args.text || '').length + ' 字符）。' + (out ? (' 备注：' + out.slice(0, 100)) : '');
    }
    default:
      throw new Error('未知工具：' + name);
  }
}

// ---------- MCP stdio 协议层 ----------
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function handleMcp(msg) {
  const { id, method } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'desktopplus-mcp', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    const params = msg.params || {};
    const name = params.name;
    const args = params.arguments || {};
    try {
      const out = await runTool(name, args);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }], isError: false } });
    } catch (e) {
      const err = (e && e.message) || String(e);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '错误：' + err }], isError: true } });
    }
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

process.stdin.on('end', () => process.exit(0));
process.stdin.resume();

#!/usr/bin/env node
/**
 * 飞虹 Code · Figma 设计稿 MCP 服务器（工具提供侧，stdio）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 作用：把 Figma 设计稿的"只读"能力作为 MCP 工具暴露给飞虹 Code，让智能体能够：
 *   读取文件结构 / 取指定节点 / 导出节点为图片 / 读取评审评论，
 *   从而把设计稿转化为可理解的结构与素材，辅助"设计 → 代码"的落地。
 *
 * 鉴权：通过环境变量 FIGMA_TOKEN（Figma Personal Access Token）提供，见 https://www.figma.com/developers/api#access-tokens。
 *   未设置 token 时工具调用会返回明确指引，不会崩溃（不影响飞虹 Code 启动）。
 *
 * 说明：Typora 等"纯 GUI 本地编辑器"没有可编程接口，无法直接桥接为 MCP；
 *       若需本地文档自动化，可用现有的 host_file_* / desktopplus 工具操作 .md 文件替代。
 *
 * 传输：MCP stdio（JSON-RPC 2.0, NDJSON），与飞虹 Code 的 McpClient 对齐（protocolVersion 2024-11-05）。
 */
'use strict';
const readline = require('readline');

const TOKEN = process.env.FIGMA_TOKEN || '';
const API = 'https://api.figma.com/v1';

const TOOLS = [
  {
    name: 'figma_get_file',
    description: '读取 Figma 文件的结构（文档树/页面/画板/组件名与类型）。参数 fileKey(必填，Figma 文件 URL 里的 key)、depth(可选，默认 2，限制递归深度避免过大)。',
    inputSchema: { type: 'object', properties: { fileKey: { type: 'string' }, depth: { type: 'number' } }, required: ['fileKey'] },
  },
  {
    name: 'figma_get_nodes',
    description: '读取文件中指定节点（多个用逗号分隔）的详细结构。参数 fileKey(必填)、nodeIds(必填，如 "1:23,2:45")。',
    inputSchema: { type: 'object', properties: { fileKey: { type: 'string' }, nodeIds: { type: 'string' } }, required: ['fileKey', 'nodeIds'] },
  },
  {
    name: 'figma_get_image',
    description: '把指定节点导出为图片（默认 PNG），返回可下载的临时图片 URL。参数 fileKey(必填)、nodeIds(必填)、format(可选 png/jpg/svg/pdf，默认 png)、scale(可选 1-4，默认 2)。',
    inputSchema: { type: 'object', properties: { fileKey: { type: 'string' }, nodeIds: { type: 'string' }, format: { type: 'string' }, scale: { type: 'number' } }, required: ['fileKey', 'nodeIds'] },
  },
  {
    name: 'figma_get_comments',
    description: '读取文件上的评审评论（含作者与时间），用于理解设计意图与待办。参数 fileKey(必填)。',
    inputSchema: { type: 'object', properties: { fileKey: { type: 'string' } }, required: ['fileKey'] },
  },
];

function needToken() {
  if (!TOKEN) {
    throw new Error('未配置 FIGMA_TOKEN。请在环境变量中设置 Figma Personal Access Token（https://www.figma.com/developers/api#access-tokens），重启飞虹 Code 后生效。');
  }
}

async function figmaFetch(urlPath) {
  needToken();
  const res = await fetch(API + urlPath, { headers: { 'X-Figma-Token': TOKEN } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error('Figma API ' + res.status + '：' + text.slice(0, 300));
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/** 把文档节点树压成可读摘要（名称 + 类型 + 子节点数），控制体积 */
function summarizeTree(node, depth, cur = 0) {
  if (!node || cur > depth) return [];
  const line = '  '.repeat(cur) + '- ' + (node.name || '(无名)') + ' [' + (node.type || '?') + ']';
  const out = [line];
  if (cur < depth && Array.isArray(node.children)) {
    for (const c of node.children) out.push(...summarizeTree(c, depth, cur + 1));
  }
  return out;
}

async function runTool(name, args) {
  switch (name) {
    case 'figma_get_file': {
      const depth = Math.min(Number(args.depth) || 2, 6);
      const data = await figmaFetch('/files/' + encodeURIComponent(args.fileKey));
      const doc = data.document;
      const tree = doc ? summarizeTree(doc, depth).join('\n') : '(无文档树)';
      const meta = [
        '文件名：' + (data.name || '?'),
        '最后修改：' + (data.lastModified || '?'),
        '版本：' + (data.version || '?'),
        '页面数：' + (Array.isArray(doc && doc.children) ? doc.children.length : 0),
      ].join('\n');
      return meta + '\n\n结构（depth=' + depth + '）：\n' + tree;
    }
    case 'figma_get_nodes': {
      const ids = String(args.nodeIds).split(',').map((s) => s.trim()).filter(Boolean);
      const data = await figmaFetch('/files/' + encodeURIComponent(args.fileKey) + '/nodes?ids=' + encodeURIComponent(ids.join(',')));
      const entries = Object.entries(data.nodes || {}).map(([id, v]) => '节点 ' + id + '：\n' + summarizeTree(v.document, 4).join('\n'));
      return entries.length ? entries.join('\n\n') : '(无节点返回)';
    }
    case 'figma_get_image': {
      const ids = String(args.nodeIds).split(',').map((s) => s.trim()).filter(Boolean);
      const format = args.format || 'png';
      const scale = Math.min(Number(args.scale) || 2, 4);
      const q = 'ids=' + encodeURIComponent(ids.join(',')) + '&format=' + format + '&scale=' + scale;
      const data = await figmaFetch('/images/' + encodeURIComponent(args.fileKey) + '?' + q);
      if (data.err) throw new Error('Figma 导出错误：' + data.err);
      const lines = Object.entries(data.images || {}).map(([id, url]) => id + ' -> ' + (url || '(null)'));
      return '导出（format=' + format + ', scale=' + scale + '）：\n' + (lines.length ? lines.join('\n') : '(无)');
    }
    case 'figma_get_comments': {
      const data = await figmaFetch('/files/' + encodeURIComponent(args.fileKey) + '/comments');
      const list = (data.comments || []).map((c) => {
        const who = (c.user && (c.user.handle || c.user.name)) || '匿名';
        const ts = c.created_at || '';
        const txt = (c.body || '').replace(/\n/g, ' ');
        return '[' + ts + '] ' + who + '：' + txt;
      });
      return list.length ? ('评论 ' + list.length + ' 条：\n' + list.join('\n')) : '（无评论）';
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
        serverInfo: { name: 'figma-mcp', version: '1.0.0' },
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

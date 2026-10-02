#!/usr/bin/env node
/**
 * 飞虹 Code · Git 仓库 MCP 服务器（工具提供侧，stdio）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 作用：把本机 git 仓库的"只读审察 + 受护栏写操作"作为 MCP 工具暴露给飞虹 Code。
 *       让智能体能够直接：看状态 / 列分支 / 看提交历史 / 看 diff / 看某次提交改动 / 审远程，
 *       从而在"改代码 → 自测 → 提交"的链路里，AI 可以自主审分支、理解改动、按需提交。
 *
 * 安全设计：
 *   - 默认全部只读（status/log/diff/show/branch/remote/stash），绝对安全。
 *   - 写操作（add/commit/checkout/create_branch/reset）必须显式传 confirm:true，
 *     且 commit 只允许在当前分支原地提交（不强制 push），避免误推/误删。
 *
 * 传输：MCP stdio（JSON-RPC 2.0, NDJSON），与飞虹 Code 的 McpClient 对齐（protocolVersion 2024-11-05）。
 */
'use strict';
const cp = require('child_process');
const path = require('path');
const readline = require('readline');

const TOOLS = [
  {
    name: 'git_status',
    description: '查看工作区状态（porcelain 格式，含 暂存/未暂存/未跟踪 文件清单）。参数 repo(可选，git 仓库根目录绝对路径；缺省用 cwd)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } } },
  },
  {
    name: 'git_current_branch',
    description: '返回当前所在分支名。参数 repo(可选)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } } },
  },
  {
    name: 'git_branch_list',
    description: '列出本地与远程分支，标注当前分支(*)。参数 repo(可选)、all(可选，默认 true 含远程)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, all: { type: 'boolean' } } },
  },
  {
    name: 'git_log',
    description: '查看提交历史（oneline）。参数 repo(可选)、count(可选，默认 20)、file(可选，只看某文件历史)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, count: { type: 'number' }, file: { type: 'string' } } },
  },
  {
    name: 'git_diff',
    description: '查看改动。参数 repo(可选)、staged(可选，true 看已暂存)、file(可选，只看某文件)。返回 diff 文本（自动截断到 60000 字符）。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, staged: { type: 'boolean' }, file: { type: 'string' } } },
  },
  {
    name: 'git_show',
    description: '查看某次提交的完整改动（patch）。参数 repo(可选)、ref(必填，commit hash / 分支 / HEAD~1 等)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, ref: { type: 'string' } }, required: ['ref'] },
  },
  {
    name: 'git_remote_list',
    description: '列出配置的远程仓库（名称 + URL）。参数 repo(可选)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } } },
  },
  {
    name: 'git_stash_list',
    description: '列出 stash 栈。参数 repo(可选)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } } },
  },
  {
    name: 'git_add',
    description: '【写操作·需 confirm:true】将文件加入暂存区。参数 repo(可选)、paths(必填，文件/目录数组，可用 ["."] 全加)、confirm(必填 true)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, paths: { type: 'array', items: { type: 'string' } }, confirm: { type: 'boolean' } }, required: ['paths', 'confirm'] },
  },
  {
    name: 'git_commit',
    description: '【写操作·需 confirm:true】在当前分支提交已暂存改动（不自动 push）。参数 repo(可选)、message(必填)、confirm(必填 true)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, message: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['message', 'confirm'] },
  },
  {
    name: 'git_create_branch',
    description: '【写操作·需 confirm:true】基于当前 HEAD 新建分支并切换。参数 repo(可选)、name(必填)、confirm(必填 true)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, name: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['name', 'confirm'] },
  },
  {
    name: 'git_checkout',
    description: '【写操作·需 confirm:true】切换分支或文件。参数 repo(可选)、ref(必填，分支名或文件路径)、confirm(必填 true)。',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, ref: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['ref', 'confirm'] },
  },
];

function resolveRepo(args) {
  return args.repo ? path.resolve(args.repo) : process.cwd();
}

function git(repo, args, opts = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile('git', args, {
      cwd: repo,
      maxBuffer: 32 * 1024 * 1024,
      timeout: opts.timeout || 60000,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return reject(err);
      // git diff 等无改动时退出码 1 属正常，只要拿到输出即可
      resolve({ out: (stdout || '') + (stderr || ''), code: err ? err.code : 0 });
    });
  });
}

function requireConfirm(args) {
  if (args.confirm !== true) {
    throw new Error('写操作被安全护栏拦截：必须显式传 confirm:true 才能执行。');
  }
}

async function runTool(name, args) {
  const repo = resolveRepo(args);
  switch (name) {
    case 'git_status': {
      const { out } = await git(repo, ['status', '--porcelain', '-b']);
      if (!out.trim()) return '工作区干净，无改动。';
      const lines = out.split('\n').filter(Boolean);
      return '仓库 ' + repo + ' 状态（' + lines.length + ' 行）：\n' + lines.join('\n');
    }
    case 'git_current_branch': {
      const { out } = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
      return '当前分支：' + out.trim();
    }
    case 'git_branch_list': {
      const all = args.all !== false;
      const { out } = await git(repo, all ? ['branch', '-a', '-v'] : ['branch', '-v']);
      return '分支列表：\n' + out.trim();
    }
    case 'git_log': {
      const count = Math.min(Number(args.count) || 20, 200);
      const fileArgs = args.file ? ['--', args.file] : [];
      const { out } = await git(repo, ['log', '--oneline', '-n', String(count), ...fileArgs]);
      const lines = out.split('\n').filter(Boolean);
      return '提交历史（' + lines.length + ' 条）：\n' + lines.join('\n');
    }
    case 'git_diff': {
      const a = ['diff'];
      if (args.staged) a.push('--cached');
      if (args.file) a.push('--', args.file);
      const { out } = await git(repo, a);
      if (!out.trim()) return '（无差异）';
      return 'diff（' + out.length + ' 字符，截断到 60000）：\n```diff\n' + out.slice(0, 60000) + '\n```';
    }
    case 'git_show': {
      const { out } = await git(repo, ['show', args.ref, '--format=%H%n%an%n%ad%n%s%n%n%b']);
      if (!out.trim()) return '（空提交或不存在）';
      return '提交 ' + args.ref + '：\n```diff\n' + out.slice(0, 60000) + '\n```';
    }
    case 'git_remote_list': {
      const { out } = await git(repo, ['remote', '-v']);
      return out.trim() ? ('远程仓库：\n' + out.trim()) : '（无远程仓库配置）';
    }
    case 'git_stash_list': {
      const { out } = await git(repo, ['stash', 'list']);
      return out.trim() ? ('stash 栈：\n' + out.trim()) : '（stash 为空）';
    }
    case 'git_add': {
      requireConfirm(args);
      const paths = Array.isArray(args.paths) && args.paths.length ? args.paths : ['.'];
      const { out } = await git(repo, ['add', '--', ...paths]);
      return '已暂存：' + paths.join(' ') + (out.trim() ? ('\n' + out.trim()) : '');
    }
    case 'git_commit': {
      requireConfirm(args);
      const { out } = await git(repo, ['commit', '-m', String(args.message)]);
      return '提交结果：\n' + out.trim();
    }
    case 'git_create_branch': {
      requireConfirm(args);
      const { out } = await git(repo, ['checkout', '-b', String(args.name)]);
      return '已创建并切换到分支 ' + args.name + '：\n' + out.trim();
    }
    case 'git_checkout': {
      requireConfirm(args);
      const { out } = await git(repo, ['checkout', '--', String(args.ref)]);
      return '已 checkout：' + args.ref + (out.trim() ? ('\n' + out.trim()) : '');
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
        serverInfo: { name: 'git-mcp', version: '1.0.0' },
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

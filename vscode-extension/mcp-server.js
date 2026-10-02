/**
 * 飞虹 Code VS Code 扩展 · 内置 MCP 服务器（工具提供侧）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 作用：把 VS Code 的能力（读/写/改文件、列文件、搜索、跑命令、取诊断、执行命令）
 *       作为 MCP 工具暴露给飞虹 Code（智能体）。
 *
 * 传输：本模块在扩展宿主内监听本地 TCP（127.0.0.1:9599），使用 NDJSON 信封
 *       { id, tool, args } -> { id, ok, output, error }。
 *       真正的 MCP stdio 协议由同目录 mcp-bridge.js 承接（被飞虹 Code spawn），
 *       桥只负责把 tools/call 转发到本 socket。
 *
 * 为什么拆两层：飞虹 Code 的 MCP 客户端是 stdio-only（spawn 子进程）。而 VS Code 的
 *       vscode.* API 只能在扩展宿主内调用，无法被外部 spawn 的进程直接访问。因此
 *       由"扩展内 socket 服务"持有真实能力，"stdio 桥"只做协议转换与转发。
 */
'use strict';
const net = require('net');
const path = require('path');
const cp = require('child_process');
const vscode = require('vscode');

const HOST = '127.0.0.1';
const PORT = 9599;

let server = null;
let outChannel = null;

function log(...args) {
  if (!outChannel) {
    try { outChannel = vscode.window.createOutputChannel('飞虹 Code MCP'); } catch { /* noop */ }
  }
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  if (outChannel) outChannel.appendLine('[vscode-mcp] ' + line);
}

/** 工具清单（同时作为 MCP tools/list 的返回；inputSchema 供智能体理解参数） */
const TOOLS = [
  {
    name: 'vscode_read_file',
    description: '读取工作区内某文件的完整内容（UTF-8 文本）。参数 path：相对工作区根的路径或绝对路径。返回文件全文。',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' } }, required: ['path'] },
  },
  {
    name: 'vscode_write_file',
    description: '新建或整体覆盖写入一个文件。参数 path、content。会创建必要的父目录。用于创建新文件或整文件重写。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
  {
    name: 'vscode_edit_file',
    description: '对已有文件做精确字符串替换（SEARCH/REPLACE）。参数 path、old_string、new_string、replace_all(可选，默认 false 只替换第一处)。old_string 必须是文件中存在的连续片段。用于局部修改/优化代码。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'] },
  },
  {
    name: 'vscode_list_files',
    description: '按 glob 模式列出工作区文件，如 "src/**/*.ts"。参数 glob(默认 **/*)、max_results(默认 200)。',
    inputSchema: { type: 'object', properties: { glob: { type: 'string' }, max_results: { type: 'number' } } },
  },
  {
    name: 'vscode_get_active_editor',
    description: '获取当前 VS Code 中正在编辑的文件：返回其路径、语言与完整内容。无打开文件时返回提示。用于让智能体聚焦用户当前关注的代码。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vscode_open_file',
    description: '在 VS Code 编辑器中打开指定文件（并激活）。参数 path。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'vscode_search_in_files',
    description: '在工作区中按关键字搜索文件内容，返回匹配的文件与行（最多 max_results 条）。参数 query(必填)、include(glob 可选)、max_results(默认 50)。用于定位代码/符号。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, include: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'vscode_run_terminal',
    description: '在 VS Code 工作区目录下执行一条 shell 命令并捕获输出（如 npm test / npm run build / git status）。参数 command(必填)、cwd(可选)、timeout_ms(默认 60000)。返回合并后的 stdout/stderr。',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['command'] },
  },
  {
    name: 'vscode_get_diagnostics',
    description: '获取 VS Code 的诊断信息（报错/警告，如 TS 编译错误）。参数 path(可选，缺省返回全部打开文件的诊断)。返回诊断条目。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  },
  {
    name: 'vscode_execute_command',
    description: '执行任意 VS Code 命令（命令面板 ID），可选参数 args(数组)。用于触发 IDE 能力，如格式化、重构、运行任务等。',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array' } }, required: ['command'] },
  },
];

function resolveAbs(p) {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (path.isAbsolute(p)) return p;
  if (!folder) throw new Error('未打开工作区且 path 非绝对路径：' + p);
  return path.join(folder.uri.fsPath, p);
}

async function readText(abs) {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
  return Buffer.from(bytes).toString('utf8');
}

async function writeText(abs, content) {
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(abs)));
  await vscode.workspace.fs.writeFile(vscode.Uri.file(abs), Buffer.from(content, 'utf8'));
}

async function runTool(tool, args) {
  switch (tool) {
    case 'vscode_read_file': {
      const abs = resolveAbs(args.path);
      const text = await readText(abs);
      return '文件 ' + args.path + '（' + text.length + ' 字符）：\n```\n' + text + '\n```';
    }
    case 'vscode_write_file': {
      const abs = resolveAbs(args.path);
      await writeText(abs, args.content || '');
      return '已写入文件 ' + args.path + '（' + (args.content || '').length + ' 字符）';
    }
    case 'vscode_edit_file': {
      const abs = resolveAbs(args.path);
      const text = await readText(abs);
      const oldS = args.old_string;
      if (!oldS) throw new Error('old_string 不能为空');
      if (text.indexOf(oldS) < 0) {
        throw new Error('old_string 在文件中未找到（请确认片段精确且唯一）：\n' + oldS.slice(0, 120));
      }
      const newText = args.replace_all
        ? text.split(oldS).join(args.new_string)
        : text.replace(oldS, args.new_string);
      await writeText(abs, newText);
      return '已修改文件 ' + args.path + '（replace_all=' + !!args.replace_all + '）';
    }
    case 'vscode_list_files': {
      const glob = args.glob || '**/*';
      const max = Math.min(Number(args.max_results) || 200, 2000);
      const uris = await vscode.workspace.findFiles(glob, null, max);
      const rels = uris.map((u) => vscode.workspace.asRelativePath(u));
      return '匹配 ' + rels.length + ' 个文件：\n' + rels.join('\n');
    }
    case 'vscode_get_active_editor': {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return '当前没有打开的编辑器（活动文件为空）。';
      const rel = vscode.workspace.asRelativePath(ed.document.uri);
      const text = ed.document.getText();
      return '活动文件：' + rel + '（语言 ' + ed.document.languageId + '，' + text.length + ' 字符）：\n```\n' + text + '\n```';
    }
    case 'vscode_open_file': {
      const abs = resolveAbs(args.path);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      await vscode.window.showTextDocument(doc);
      return '已在编辑器中打开 ' + args.path;
    }
    case 'vscode_search_in_files': {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('query 不能为空');
      const max = Math.min(Number(args.max_results) || 50, 500);
      const glob = args.include || '**/*';
      const uris = await vscode.workspace.findFiles(glob, null, 400);
      const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const hits = [];
      for (const u of uris) {
        if (hits.length >= max) break;
        let text;
        try { text = await readText(u.fsPath); } catch { continue; }
        if (text.length > 2_000_000) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && hits.length < max; i++) {
          if (re.test(lines[i])) {
            hits.push(vscode.workspace.asRelativePath(u) + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 200));
          }
        }
      }
      return hits.length
        ? '搜索 "' + query + '" 命中 ' + hits.length + ' 处：\n' + hits.join('\n')
        : '未找到匹配 "' + query + '"';
    }
    case 'vscode_run_terminal': {
      const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
      const cwd = args.cwd ? resolveAbs(args.cwd) : (folder ? folder.uri.fsPath : process.cwd());
      const timeout = Math.min(Number(args.timeout_ms) || 60000, 300000);
      const out = await new Promise((resolve) => {
        cp.exec(args.command, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
          let s = (stdout || '') + (stderr || '');
          if (err) s += '\n[命令结束码 ' + (err.code ?? '?') + (err.signal ? ' signal=' + err.signal : '') + ']';
          resolve(s || '(无输出)');
        });
      });
      return '命令执行结果（cwd=' + cwd + '）：\n```\n' + out.slice(0, 20000) + '\n```';
    }
    case 'vscode_get_diagnostics': {
      let diags;
      if (args.path) {
        diags = vscode.languages.getDiagnostics(vscode.Uri.file(resolveAbs(args.path)));
      } else {
        diags = vscode.languages.getDiagnostics();
      }
      const flat = Array.isArray(diags[0]) ? diags.flat() : diags;
      if (!flat.length) return '无诊断信息（无错误/警告）。';
      const lines = flat.slice(0, 200).map((d) => {
        const loc = d.source ? '[' + d.source + '] ' : '';
        return '· ' + loc + (d.severity === 0 ? '错误' : d.severity === 1 ? '警告' : '信息') +
          ' L' + (d.range.start.line + 1) + ': ' + d.message;
      });
      return '诊断 ' + flat.length + ' 条：\n' + lines.join('\n');
    }
    case 'vscode_execute_command': {
      const r = await vscode.commands.executeCommand(args.command, ...(Array.isArray(args.args) ? args.args : []));
      return '已执行命令 ' + args.command + (r !== undefined ? '；返回：' + JSON.stringify(r).slice(0, 2000) : '');
    }
    default:
      throw new Error('未知工具：' + tool);
  }
}

function handleLine(socket, line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, tool, args } = msg;
  if (tool === '__list_tools__') {
    socket.write(JSON.stringify({ id, ok: true, output: JSON.stringify(TOOLS) }) + '\n');
    return;
  }
  runTool(tool, args || {})
    .then((out) => socket.write(JSON.stringify({ id, ok: true, output: String(out) }) + '\n'))
    .catch((e) => socket.write(JSON.stringify({ id, ok: false, error: (e && e.message) || String(e) }) + '\n'));
}

/** 启动本地 MCP 工具 socket 服务（幂等）。返回 Promise<net.Server> */
function startMcpServer() {
  if (server) return Promise.resolve(server);
  return new Promise((resolve) => {
    server = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (l.trim()) handleLine(socket, l);
        }
      });
      socket.on('error', () => { /* 连接级错误忽略 */ });
    });
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        log('端口 ' + PORT + ' 已被占用（可能已有另一个 VS Code 窗口加载本扩展），跳过本次启动');
      } else {
        log('socket 服务错误', e.message);
      }
    });
    server.listen(PORT, HOST, () => {
      log('VS Code MCP 工具服务已启动：tcp://' + HOST + ':' + PORT + '（' + TOOLS.length + ' 个工具）');
      resolve(server);
    });
  });
}

module.exports = { startMcpServer, TOOLS, PORT, HOST };

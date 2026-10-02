/**
 * 飞虹 Code VS Code 扩展
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 对话链路（与 Web 控制台同源）：
 *   POST /api/auth/login（手机号登录，免签）→ POST /api/tasks（建任务，F2 签名）
 *   → GET /api/tasks/:id（轮询，免签读）→ POST /api/tasks/:id/messages（多轮续接）
 *
 * 两种工作模式：
 *   1) 对话模式（默认）：聊天 + 代码块「插入」手动落盘。
 *   2) 驱动模式（🤖 驱动）：飞虹 Code 作为 VS Code 内置编码代理，
 *      用 ```fh-edit / ```fh-newfile 块返回改动，扩展解析后真实写回工作区文件。
 */
'use strict';
const vscode = require('vscode');
const path = require('path');
const { FhApiClient } = require('./api-client');
const { startMcpServer } = require('./mcp-server');

let chatProvider = null;

function activate(context) {
  chatProvider = new FeihongChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('feihong-code.chat', chatProvider)
  );

  // 启动"VS Code 作为飞虹 Code 的 MCP 工具源"：扩展内 socket 服务（127.0.0.1:9599）
  startMcpServer().catch((e) => {
    vscode.window.showWarningMessage('飞虹 Code MCP 服务启动失败：' + (e && e.message ? e.message : e));
  });
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.chat', () => {
      vscode.commands.executeCommand('workbench.view.extension.feihong-code');
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.toggleAgent', () => {
      chatProvider.toggleAgent();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.explain', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) return;
      const code = editor.document.getText(editor.selection);
      const lang = editor.document.languageId;
      chatProvider.sendMessage(
        '请解释以下 ' + lang + ' 代码：\n\n```' + lang + '\n' + code + '\n```',
        false
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.refactor', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) return;
      const code = editor.document.getText(editor.selection);
      const lang = editor.document.languageId;
      const rel = vscode.workspace.asRelativePath(editor.document.uri);
      const prompt =
        '请重构以下 ' + lang + ' 代码（文件 ' + rel + '），保持功能不变，提升可读性和性能。' +
        '直接给出可应用的修改，不要只解释：\n\n```' + lang + '\n' + code + '\n```';
      chatProvider.sendMessage(prompt, true);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.stop', () => {
      chatProvider.stopCurrentTask();
    })
  );
}

class FeihongChatViewProvider {
  constructor(extensionUri) {
    this._extensionUri = extensionUri;
    this._view = null;
    this._client = null;
    this._taskId = null;        // 当前会话任务（多轮归属同一任务）
    this._renderedConv = 0;     // 已渲染的 conversation 条数（增量渲染）
    this._busy = false;         // 轮询执行中，禁止并发发送
    this._agentMode = false;    // 驱动模式：AI 直接改文件
  }

  toggleAgent() {
    this._agentMode = !this._agentMode;
    this._view?.webview.postMessage({ type: 'agentState', on: this._agentMode });
    this._status(
      this._agentMode ? '🤖 驱动模式：飞虹 Code 将直接修改工作区文件' : '已切回对话模式',
      false
    );
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtml();
    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.type === 'send') {
        await this._sendFlow(data.text);
      } else if (data.type === 'insertCode') {
        this._insertCode(data.code);
      } else if (data.type === 'clear') {
        this._taskId = null;
        this._renderedConv = 0;
      } else if (data.type === 'stop') {
        this.stopCurrentTask();
      } else if (data.type === 'agentToggle') {
        this._agentMode = !!data.on;
        this._view?.webview.postMessage({ type: 'agentState', on: this._agentMode });
      }
    });
  }

  /** 命令入口（右键解释/重构）：显示面板并发送；forceAgent 强制驱动模式 */
  sendMessage(text, forceAgent = false) {
    if (!this._view) {
      vscode.commands.executeCommand('workbench.view.extension.feihong-code');
    }
    this._view?.webview.postMessage({ type: 'user', text });
    this._sendFlow(text, forceAgent);
  }

  _clientFromConfig() {
    const cfg = vscode.workspace.getConfiguration('feihong-code');
    const serverUrl = cfg.get('serverUrl', 'http://127.0.0.1:8080');
    if (!this._client || this._client.serverUrl !== serverUrl.replace(/\/+$/, '')) {
      this._client = new FhApiClient(serverUrl);
    }
    return this._client;
  }

  /** 确保已持有会话令牌：token 配置 → phone 自动登录 → InputBox 输入手机号 */
  async _ensureToken() {
    const cfg = vscode.workspace.getConfiguration('feihong-code');
    const client = this._clientFromConfig();

    const cfgToken = (cfg.get('token', '') || '').trim();
    if (cfgToken) {
      client.setToken(cfgToken);
      return client;
    }

    let phone = (cfg.get('phone', '') || '').trim();
    if (!phone) {
      phone = await vscode.window.showInputBox({
        prompt: '飞虹 Code：输入手机号登录（6-20 位数字，本地服务免验证码）',
        placeHolder: '13800000000',
        ignoreFocusOut: true,
      });
      if (!phone) throw new Error('已取消：未提供登录手机号');
      await cfg.update('phone', phone.trim(), vscode.ConfigurationTarget.Global);
    }

    const r = await client.login(phone.trim());
    if (r.status === 200 && r.json && r.json.token) {
      this._status('已登录（' + phone.trim() + '）', false);
      return client;
    }
    const err = (r.json && (r.json.error || r.json.raw)) || ('HTTP ' + r.status);
    throw new Error('登录失败：' + err);
  }

  /** 组装驱动模式任务目标：注入编码代理指令 + 当前活动文件上下文 */
  _buildAgentGoal(userText) {
    const editor = vscode.window.activeTextEditor;
    let ctx = '';
    if (editor) {
      const rel = vscode.workspace.asRelativePath(editor.document.uri);
      const content = editor.document.getText();
      ctx =
        '\n当前活动文件：' + rel +
        '\n当前文件完整内容：\n```\n' + content.slice(0, 20000) + '\n```\n';
    }
    const instruction =
      '你正在作为 VS Code 内置的编码代理运行，请直接修改项目代码以满足用户请求。\n' +
      '输出规则：\n' +
      '1. 修改已有文件：用 ```fh-edit 块，第一行 path: 相对路径（相对项目根目录），随后：\n' +
      '<<<<<<< SEARCH\n旧代码（必须是从文件精确复制的连续片段，确保能唯一匹配）\n=======\n新代码\n>>>>>>> REPLACE\n' +
      '2. 新建文件：用 ```fh-newfile 块，第一行 path: 相对路径，随后 content: 完整文件内容。\n' +
      '3. 只修改用户明确要求的部分；代码块前后只用一两句话说明意图，不要写长篇解释。\n' +
      '4. 若只需说明、无需改文件，正常用自然语言回答即可。';
    return instruction + ctx + '\n用户请求：\n' + userText;
  }

  /** 从模型输出中解析 fh-edit / fh-newfile 改动块 */
  _parseEdits(text) {
    const edits = [];
    const reEdit = /```fh-edit\s*\n([\s\S]*?)```/g;
    let m;
    while ((m = reEdit.exec(text))) {
      const body = m[1];
      const pm = /^\s*path:\s*(.+)$/m.exec(body);
      if (!pm) continue;
      const p = pm[1].trim();
      const sm = /<<<<<<< SEARCH\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>> REPLACE/.exec(body);
      if (!sm) continue;
      edits.push({ type: 'edit', path: p, search: sm[1], replace: sm[2] });
    }
    const reNew = /```fh-newfile\s*\n([\s\S]*?)```/g;
    while ((m = reNew.exec(text))) {
      const body = m[1];
      const pm = /^\s*path:\s*(.+)$/m.exec(body);
      if (!pm) continue;
      const p = pm[1].trim();
      let content = body.replace(/^\s*path:\s*.+$/m, '');
      content = content.replace(/^\s*content:\s*/, '');
      edits.push({ type: 'new', path: p, content });
    }
    return edits;
  }

  /** 把解析出的改动真实写回工作区文件（驱动模式核心） */
  async _applyEdits(edits) {
    const folder =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!folder) {
      // 未打开工作区：退化为临时文档打开，便于手动保存
      for (const e of edits) {
        const content = e.type === 'new' ? e.content : e.replace;
        const doc = await vscode.workspace.openTextDocument({ content });
        await vscode.window.showTextDocument(doc);
      }
      return { applied: edits.length, skipped: 0, changedFiles: [], noWorkspace: true };
    }
    const root = folder.uri.fsPath;
    let applied = 0;
    let skipped = 0;
    const changedFiles = [];
    for (const e of edits) {
      try {
        const abs = path.join(root, e.path);
        if (e.type === 'new') {
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(path.dirname(abs))
          );
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(abs),
            Buffer.from(e.content, 'utf8')
          );
          changedFiles.push(e.path);
          applied++;
        } else {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
          const text = doc.getText();
          const idx = text.indexOf(e.search);
          if (idx < 0) {
            skipped++;
            continue;
          }
          const newText =
            text.slice(0, idx) + e.replace + text.slice(idx + e.search.length);
          const we = new vscode.WorkspaceEdit();
          we.replace(
            vscode.Uri.file(abs),
            new vscode.Range(0, 0, doc.lineCount, 0),
            newText
          );
          const ok = await vscode.workspace.applyEdit(we);
          if (ok) {
            changedFiles.push(e.path);
            applied++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        skipped++;
      }
    }
    if (changedFiles.length) {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(path.join(root, changedFiles[0]))
      );
      await vscode.window.showTextDocument(doc);
    }
    return { applied, skipped, changedFiles };
  }

  _collectAssistant(task) {
    let s = '';
    const conv = Array.isArray(task.conversation) ? task.conversation : [];
    for (const c of conv) {
      if (c && c.role === 'assistant' && c.content) s += c.content + '\n';
    }
    if (task.result && task.result.finalAnswer) s += task.result.finalAnswer + '\n';
    return s;
  }

  /** 主流程：建任务/续接 → 轮询 → 渲染结果；驱动模式下解析并落盘改动 */
  async _sendFlow(text, forceAgent = null) {
    const agentMode = forceAgent === null ? this._agentMode : forceAgent;
    if (this._busy) {
      this._status('当前任务执行中，请等待完成或点「停止」', false);
      return;
    }
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    try {
      const client = await this._ensureToken();
      this._busy = true;
      this._renderedConv = 0;

      // 驱动模式每次用最新活动文件上下文，强制新建任务保证上下文新鲜
      if (agentMode) this._taskId = null;

      const goal = agentMode ? this._buildAgentGoal(trimmed) : trimmed;
      this._status(agentMode ? '🤖 驱动中…（飞虹 Code 正在改文件）' : '正在提交任务…', true);

      let taskId = this._taskId;
      if (taskId) {
        const cr = await client.continueTask(taskId, goal);
        if (cr.status === 409) {
          this._busy = false;
          this._view?.webview.postMessage({
            type: 'error',
            text: '上一任务仍在执行中，请等待完成后再继续对话（或点「停止」中止）。',
          });
          return;
        }
        if (cr.status !== 201 || !cr.json || !cr.json.task) {
          const err = (cr.json && (cr.json.error || cr.json.raw)) || ('HTTP ' + cr.status);
          throw new Error('续接失败：' + err);
        }
      } else {
        const cr = await client.createTask(goal);
        if (cr.status !== 201 || !cr.json || !cr.json.task) {
          const err = (cr.json && (cr.json.error || cr.json.raw)) || ('HTTP ' + cr.status);
          throw new Error('建任务失败：' + err);
        }
        taskId = cr.json.task.id;
        this._taskId = taskId;
      }

      const task = await client.pollTask(taskId, (t) => {
        const conv = Array.isArray(t.conversation) ? t.conversation : [];
        for (let i = this._renderedConv; i < conv.length; i++) {
          if (conv[i] && conv[i].role === 'assistant' && conv[i].content) {
            this._view?.webview.postMessage({ type: 'assistant', text: conv[i].content });
          }
        }
        this._renderedConv = conv.length;
        const stepCount = Array.isArray(t.steps) ? t.steps.length : 0;
        this._status(
          (agentMode ? '🤖 驱动中…' : '执行中…') + '（步骤 ' + stepCount + '）',
          true,
          taskId
        );
      });

      if (task.status === 'failed') {
        this._view?.webview.postMessage({
          type: 'error',
          text: '任务失败：' + (task.error || '未知错误') +
            (task.result && task.result.finalAnswer ? '\n\n部分输出：\n' + task.result.finalAnswer : ''),
        });
      } else if (agentMode) {
        const combined = this._collectAssistant(task);
        const edits = this._parseEdits(combined);
        if (edits.length) {
          const res = await this._applyEdits(edits);
          this._view?.webview.postMessage({
            type: 'assistant',
            text:
              '🤖 已应用 ' + res.applied + ' 处改动' +
              (res.skipped ? '，跳过 ' + res.skipped + ' 处（未在文件中匹配到 SEARCH 片段）' : '') +
              (res.noWorkspace ? '（未打开工作区，已作为临时文件打开）' : '') +
              '\n文件：\n' + (res.changedFiles.join('\n') || '（无）'),
          });
        } else {
          this._view?.webview.postMessage({
            type: 'assistant',
            text: '（驱动模式：未检测到可应用的代码改动块，模型可能仅给出文字说明）',
          });
        }
        const cost = task.result ? task.result.costUsd : undefined;
        this._status(
          '✅ 驱动完成' + (typeof cost === 'number' ? '（成本 $' + cost.toFixed(4) + '）' : ''),
          false,
          taskId
        );
        // 驱动模式每轮自包含，清空任务链避免上下文错位
        this._taskId = null;
      } else {
        const finalAnswer = task.result && task.result.finalAnswer;
        if (finalAnswer) {
          this._view?.webview.postMessage({ type: 'assistant', text: finalAnswer });
        }
        const cost = task.result ? task.result.costUsd : undefined;
        this._status(
          '✅ 完成' + (task.result ? '（迭代 ' + task.result.iterations + ' 次' + (typeof cost === 'number' ? '，成本 $' + cost.toFixed(4) : '') + '）' : ''),
          false, taskId
        );
      }
    } catch (e) {
      this._view?.webview.postMessage({
        type: 'error',
        text: (e && e.message ? e.message : String(e)) +
          '\n\n排查提示：\n1. 确认飞虹 Code 后端已启动（一键启动Web控制台.bat，默认 http://127.0.0.1:8080）\n2. 确认设置中 feihong-code.serverUrl 与实际端口一致\n3. 若服务端重启，任务队列会清空，请点「清空」重新发起',
      });
    } finally {
      this._busy = false;
    }
  }

  async stopCurrentTask() {
    if (!this._taskId) {
      this._status('当前没有运行中的任务', false);
      return;
    }
    try {
      const client = await this._ensureToken();
      await client.stopTask(this._taskId);
      this._status('已请求停止任务 ' + this._taskId.slice(0, 8) + '…', false);
    } catch (e) {
      this._view?.webview.postMessage({ type: 'error', text: '停止失败：' + (e.message || e) });
    }
  }

  _status(text, running, taskId) {
    this._view?.webview.postMessage({
      type: 'status',
      text,
      running: !!running,
      taskId: taskId || this._taskId || '',
    });
  }

  _insertCode(code) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.edit((editBuilder) => {
        editBuilder.replace(editor.selection, code);
      });
    } else {
      vscode.workspace.openTextDocument({ content: code }).then((doc) => {
        vscode.window.showTextDocument(doc);
      });
    }
  }

  _getHtml() {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
body{margin:0;padding:12px;font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);background:var(--vscode-editor-background);display:flex;flex-direction:column;height:100vh;box-sizing:border-box}
.header{font-weight:600;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
.header .actions button{background:none;border:none;color:var(--vscode-textLink-foreground);cursor:pointer;font-size:12px;padding:0 4px}
.statusbar{font-size:11px;padding:4px 8px;margin-bottom:8px;border-radius:4px;background:var(--vscode-textBlockQuote-background);color:var(--vscode-descriptionForeground);display:none;align-items:center;justify-content:space-between;gap:6px}
.statusbar.show{display:flex}
.statusbar .stop{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;font-size:11px;padding:2px 8px;cursor:pointer}
.messages{flex:1;overflow-y:auto;margin-bottom:8px}
.msg{margin-bottom:10px;padding:8px 10px;border-radius:6px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.msg.user{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.msg.assistant{background:var(--vscode-textBlockQuote-background)}
.msg.error{background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-inputValidation-errorForeground)}
.msg pre{background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:4px;overflow-x:auto;margin:4px 0}
.msg code{font-family:var(--vscode-editor-font-family)}
.input-row{display:flex;gap:6px}
.input-row textarea{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;padding:6px 8px;font-family:inherit;font-size:13px;resize:none;height:60px}
.input-row button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:0 14px;cursor:pointer;font-weight:500}
.input-row button:hover{background:var(--vscode-button-hoverBackground)}
.input-row button:disabled{opacity:.5;cursor:not-allowed}
.code-block{position:relative}
.code-block .copy-btn{position:absolute;top:4px;right:4px;font-size:11px;padding:2px 6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;opacity:0;transition:opacity .15s}
.code-block:hover .copy-btn{opacity:1}
</style></head><body>
<div class="header"><span>🧠 飞虹 Code</span><span class="actions"><button id="agentBtn">🤖 驱动:关</button><button id="clearBtn">清空</button></span></div>
<div class="statusbar" id="statusbar"><span id="statusText"></span><button class="stop" id="stopBtn" style="display:none">停止</button></div>
<div class="messages" id="messages"></div>
<div class="input-row">
<textarea id="input" placeholder="输入指令，Shift+Enter 换行，Enter 发送..."></textarea>
<button id="sendBtn">发送</button>
</div>
<script>
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const statusbarEl = document.getElementById('statusbar');
const statusTextEl = document.getElementById('statusText');
const stopBtn = document.getElementById('stopBtn');
const agentBtn = document.getElementById('agentBtn');
let agentOn = false;
function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = formatText(text);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  div.querySelectorAll('.code-block').forEach(block => {
    const btn = block.querySelector('.copy-btn');
    btn?.addEventListener('click', () => {
      const code = block.querySelector('code').textContent;
      vscode.postMessage({ type: 'insertCode', code });
    });
  });
}
function formatText(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\`\`\`(\\w*)\\n?([\\s\\S]*?)\`\`\`/g, (m, lang, code) => {
      return '<div class="code-block"><button class="copy-btn">插入</button><pre><code>' + code.trim() + '</code></pre></div>';
    })
    .replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
}
function setStatus(text, running, taskId) {
  statusTextEl.textContent = text + (taskId ? ' · 任务 ' + String(taskId).slice(0, 8) : '');
  statusbarEl.classList.toggle('show', !!text);
  stopBtn.style.display = running && taskId ? '' : 'none';
  sendBtn.disabled = !!running;
}
function send() {
  const text = inputEl.value.trim();
  if (!text || sendBtn.disabled) return;
  addMsg('user', text);
  vscode.postMessage({ type: 'send', text });
  inputEl.value = '';
}
sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
agentBtn.addEventListener('click', () => {
  agentOn = !agentOn;
  agentBtn.textContent = '🤖 驱动:' + (agentOn ? '开' : '关');
  vscode.postMessage({ type: 'agentToggle', on: agentOn });
});
document.getElementById('clearBtn').addEventListener('click', () => {
  messagesEl.innerHTML = '';
  setStatus('', false, '');
  vscode.postMessage({ type: 'clear' });
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
window.addEventListener('message', (e) => {
  const d = e.data;
  if (d.type === 'user') addMsg('user', d.text);
  else if (d.type === 'assistant') addMsg('assistant', d.text);
  else if (d.type === 'error') addMsg('error', d.text);
  else if (d.type === 'status') setStatus(d.text, d.running, d.taskId);
  else if (d.type === 'agentState') { agentOn = d.on; agentBtn.textContent = '🤖 驱动:' + (agentOn ? '开' : '关'); }
});
</script></body></html>`;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };

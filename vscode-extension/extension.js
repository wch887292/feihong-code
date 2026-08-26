'use strict';
/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * VS Code 薄壳扩展（纯 JS，免构建）：
 *  - 行内补全：把光标前后缀 POST 到本地 /api/completion，结果包装为 InlineCompletionItem
 *  - 侧边栏对话：Webview 调 submitTask / continueTask，轮询 getTask 渲染结果
 *  - 逻辑下沉到 agent 端，扩展只做 UI 与协议桥接（符合"薄壳"原则）
 *
 * O2（补全质量）：此处对补全结果做客户端轻量后处理（去代码围栏、裁剪尾部不完整行、
 * 去除与后缀重复的 prefix），作为服务端后处理就绪前的即时收益。
 */
const vscode = require('vscode');
const { ApiClient } = require('./api-client');
const {
  stripCodeFences,
  trimTrailingPartialLine,
  dedupeAgainstSuffix,
  postProcessCompletion,
} = require('./completion-utils');

let apiClient = null;
let statusBar = null;

function cfg() {
  return vscode.workspace.getConfiguration('fhcode');
}

function ensureClient() {
  if (!apiClient) {
    const c = cfg();
    apiClient = new ApiClient(
      c.get('serverUrl') || 'http://localhost:8080',
      c.get('token') || '',
      c.get('phone') || 'vscode-local',
    );
  }
  return apiClient;
}

async function connect() {
  const client = ensureClient();
  const h = await client.health();
  if (!h.ok) {
    vscode.window.showErrorMessage(
      `飞虹 Code 服务未连接（${client.serverUrl}）。请先在终端运行 "fhcode serve"（或启动桌面版）。`,
    );
    if (statusBar) statusBar.text = '$(error) 飞虹 Code 未连接';
    return false;
  }
  if (!client.token) {
    try {
      await client.login();
    } catch (e) {
      vscode.window.showErrorMessage('飞虹 Code 登录失败：' + e.message);
      return false;
    }
  }
  vscode.window.showInformationMessage(
    `已连接飞虹 Code v${h.version} @ ${client.serverUrl}`,
  );
  if (statusBar) statusBar.text = `$(robot) 飞虹 Code v${h.version}`;
  return true;
}

/* ========== O2：补全结果客户端后处理 ========== */
/* 纯函数已抽离至 ./completion-utils（可单测），此处仅引用 */

/* ========== 行内补全 Provider ========== */
const inlineProvider = {
  async provideInlineCompletionItems(document, position, context, token) {
    const c = cfg();
    if (c.get('enableInlineCompletion') === false) return undefined;
    const client = apiClient;
    if (!client || !client.token) return undefined;
    if (token.isCancellationRequested) return undefined;

    const fileContent = document.getText();
    const cursorOffset = document.offsetAt(position);
    const filePath = document.uri.fsPath;
    const language = document.languageId;

    try {
      const res = await client.completion({
        filePath,
        fileContent,
        cursorOffset,
        mode: 'quick',
        language,
      });
      if (!res || !res.ok || !Array.isArray(res.suggestions) || res.suggestions.length === 0) {
        return undefined;
      }
      const raw = res.suggestions[0];
      const text = typeof raw === 'string' ? raw : raw.text;
      if (!text) return undefined;
      const cleaned = postProcessCompletion(text, fileContent, cursorOffset);
      if (!cleaned) return undefined;
      const range = new vscode.Range(position, position);
      return { items: [new vscode.InlineCompletionItem(cleaned, range)] };
    } catch {
      return undefined;
    }
  },
};

/* ========== 对话 Webview ========== */
class ChatViewProvider {
  constructor() {
    this._view = null;
    this._currentTaskId = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = chatHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'ready') {
        const ok = await connect();
        webviewView.webview.postMessage({ type: 'status', connected: ok });
        return;
      }
      if (msg.type === 'chat') {
        const client = ensureClient();
        if (!client.token) {
          const ok = await connect();
          if (!ok) return;
        }
        try {
          let res;
          if (this._currentTaskId) {
            res = await client.continueTask(this._currentTaskId, msg.text);
          } else {
            res = await client.submitTask(msg.text, cfg().get('modelId') || '');
          }
          if (!res.ok) {
            webviewView.webview.postMessage({ type: 'error', error: res.error });
            return;
          }
          this._currentTaskId = res.task.id;
          webviewView.webview.postMessage({ type: 'taskStarted', taskId: res.task.id });
          this._poll(res.task.id);
        } catch (e) {
          webviewView.webview.postMessage({ type: 'error', error: e.message });
        }
        return;
      }
      if (msg.type === 'stop') {
        if (this._currentTaskId) {
          await ensureClient().stopTask(this._currentTaskId);
        }
        return;
      }
      if (msg.type === 'reset') {
        this._currentTaskId = null;
        return;
      }
    });
  }

  async _poll(taskId) {
    const client = ensureClient();
    for (let i = 0; i < 180; i++) {
      if (!this._view) return;
      try {
        const t = await client.getTask(taskId);
        if (t && t.task) {
          this._view.webview.postMessage({ type: 'task', task: t.task });
          const st = t.task.status;
          if (st === 'completed' || st === 'failed') {
            this._view.webview.postMessage({ type: 'taskDone', status: st });
            return;
          }
        }
      } catch {
        /* ignore transient */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

function chatHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body{font-family:-apple-system,Segoe UI,Roboto, sans-serif;margin:0;padding:8px;display:flex;flex-direction:column;height:100vh;box-sizing:border-box;background:#1e1e1e;color:#ddd;}
  #status{font-size:11px;color:#888;padding:4px 2px;}
  #log{flex:1;overflow:auto;font-size:13px;line-height:1.5;padding:4px;}
  .msg{border-radius:6px;padding:6px 8px;margin:6px 0;white-space:pre-wrap;word-break:break-word;}
  .user{background:#094771;align-self:flex-end;}
  .agent{background:#2a2a2a;}
  .sys{color:#999;font-size:11px;text-align:center;}
  #bar{display:flex;gap:6px;padding:6px 2px 0;border-top:1px solid #333;}
  textarea{flex:1;resize:none;height:48px;background:#252526;color:#ddd;border:1px solid #444;border-radius:4px;padding:6px;font-family:inherit;font-size:13px;}
  button{background:#0e639c;color:#fff;border:none;border-radius:4px;padding:0 12px;cursor:pointer;}
  button:disabled{opacity:.5;cursor:default;}
</style>
</head>
<body>
  <div id="status">正在连接飞虹 Code…</div>
  <div id="log"></div>
  <div id="bar">
    <textarea id="input" placeholder="把任务发给飞虹 Code（本地私有 Agent）…"></textarea>
    <button id="send">发送</button>
    <button id="stop">停止</button>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const status = document.getElementById('status');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const stop = document.getElementById('stop');

  function add(cls, text){ const d=document.createElement('div'); d.className='msg '+cls; d.textContent=text; log.appendChild(d); log.scrollTop=log.scrollHeight; }
  function setStatus(t){ status.textContent=t; }

  send.onclick = ()=>{
    const text = input.value.trim(); if(!text) return;
    add('user', text); input.value='';
    vscode.postMessage({type:'chat', text});
  };
  stop.onclick = ()=>{ vscode.postMessage({type:'stop'}); setStatus('已请求停止…'); };
  input.addEventListener('keydown', e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='Enter') send.onclick(); });

  window.addEventListener('message', e=>{
    const m = e.data;
    if(m.type==='status'){ setStatus(m.connected?'已连接 ✓':'未连接（先运行 fhcode serve）'); }
    else if(m.type==='taskStarted'){ setStatus('任务运行中…'); }
    else if(m.type==='task'){
      const t=m.task;
      if(Array.isArray(t.conversation)){ t.conversation.forEach(c=>{ if(c.role==='assistant') add('agent', c.content||''); }); }
    }
    else if(m.type==='taskDone'){ setStatus('任务'+m.status+' ✓'); }
    else if(m.type==='error'){ add('sys','⚠️ '+m.error); }
  });
  vscode.postMessage({type:'ready'});
</script>
</body>
</html>`;
}

/* ========== 激活 ========== */
function activate(context) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(robot) 飞虹 Code';
  statusBar.command = 'fhcode.openChat';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const chatProvider = new ChatViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('fhcode.chat', chatProvider),
  );

  if (cfg().get('enableInlineCompletion') !== false) {
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('fhcode.connect', () => connect()),
    vscode.commands.registerCommand('fhcode.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.fhcode');
    }),
    vscode.commands.registerCommand('fhcode.submitSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const sel = editor.document.getText(editor.selection);
      if (!sel) {
        vscode.window.showInformationMessage('请先选中一段代码再发送');
        return;
      }
      const ok = await connect();
      if (!ok) return;
      const res = await ensureClient().submitTask(
        '请分析并改进以下代码：\n\n' + sel,
        cfg().get('modelId') || '',
      );
      if (res.ok) vscode.window.showInformationMessage('已提交任务 ' + res.task.id);
      else vscode.window.showErrorMessage(res.error || '提交失败');
    }),
    vscode.commands.registerCommand('fhcode.toggleInlineCompletion', () => {
      const c = cfg();
      const next = !(c.get('enableInlineCompletion') !== false);
      c.update('enableInlineCompletion', next, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('飞虹 Code 行内补全：' + (next ? '开' : '关'));
    }),
  );

  // 启动即尝试连接，给出状态
  connect().then((ok) => {
    if (!ok && statusBar) statusBar.text = '$(error) 飞虹 Code 未连接';
  });
}

function deactivate() {}

module.exports = { activate, deactivate };

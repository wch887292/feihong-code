/**
 * 飞虹 Code VSCode 插件 - AI 聊天侧边栏
 * Webview 面板，支持对话、代码插入、上下文感知
 */
import * as vscode from 'vscode';
import { FeihongApiClient, ChatMessage } from './api';

export class FeihongChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'feihong-code.chat';
  private view: vscode.WebviewView | undefined;
  private apiClient: FeihongApiClient;
  private messages: ChatMessage[] = [];
  private isLoading = false;

  constructor(apiClient: FeihongApiClient) {
    this.apiClient = apiClient;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    const webview = webviewView.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    webview.html = this.getHtml(webview);

    webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'sendMessage':
          await this.handleUserMessage(message.content);
          break;
        case 'clearChat':
          this.messages = [];
          this.postMessage({ type: 'clear' });
          break;
        case 'insertCode':
          await this.insertCodeAtCursor(message.code);
          break;
        case 'addContext':
          await this.addCurrentFileContext();
          break;
      }
    });

    // 发送欢迎消息
    this.postMessage({
      type: 'message',
      role: 'assistant',
      content: '👋 你好！我是飞虹 Code AI 助手。\n\n我可以帮你：\n- 解释和重构代码\n- 生成单元测试\n- 修复错误\n- 回答编程问题\n\n试试选中代码后右键菜单，或直接输入问题！',
    });
  }

  /** 处理用户消息 */
  private async handleUserMessage(content: string): Promise<void> {
    if (!content.trim() || this.isLoading) return;

    this.isLoading = true;
    this.messages.push({ role: 'user', content });
    this.postMessage({ type: 'message', role: 'user', content });
    this.postMessage({ type: 'loading', show: true });

    try {
      // 添加系统提示
      const systemMsg: ChatMessage = {
        role: 'system',
        content: '你是飞虹 Code AI 编程助手，擅长代码解释、重构、测试生成和错误修复。回答简洁专业，代码用 Markdown 代码块包裹。',
      };

      const resp = await this.apiClient.chat([systemMsg, ...this.messages], {
        temperature: 0.7,
        maxTokens: 2000,
      });

      this.messages.push(resp.message);
      this.postMessage({ type: 'message', role: 'assistant', content: resp.message.content });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.postMessage({
        type: 'message',
        role: 'assistant',
        content: `❌ 请求失败：${errorMsg}\n\n请检查后端服务是否启动（默认 http://localhost:3717），或在设置中修改 feihong-code.backendUrl。`,
      });
    } finally {
      this.isLoading = false;
      this.postMessage({ type: 'loading', show: false });
    }
  }

  /** 在光标处插入代码 */
  private async insertCodeAtCursor(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('没有活动的编辑器');
      return;
    }
    await editor.edit((editBuilder) => {
      editBuilder.replace(editor.selection, code);
    });
  }

  /** 添加当前文件上下文 */
  private async addCurrentFileContext(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('没有活动的编辑器');
      return;
    }
    const doc = editor.document;
    const selection = editor.selection;
    const selectedText = doc.getText(selection);
    const fileContent = selectedText || doc.getText();
    const fileName = vscode.workspace.asRelativePath(doc.uri, false);

    const contextMsg = `当前文件：${fileName}\n语言：${doc.languageId}\n\n代码内容：\n\`\`\`${doc.languageId}\n${fileContent.slice(0, 3000)}\n\`\`\`\n\n请基于以上代码上下文回答。`;

    this.postMessage({ type: 'appendInput', content: contextMsg });
    vscode.window.showInformationMessage(`已添加 ${fileName} 到对话上下文`);
  }

  /** 向 webview 发送消息 */
  private postMessage(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  /** 外部调用：发送命令到聊天 */
  public async sendCommand(command: string, code?: string): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand('feihong-code.chat.focus');
    }
    let content = command;
    if (code) {
      content += `\n\n\`\`\`\n${code}\n\`\`\``;
    }
    await this.handleUserMessage(content);
  }

  /** Webview HTML */
  private getHtml(webview: vscode.Webview): string {
    const nonce = this.getNonce();
    return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>飞虹 Code AI 助手</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; height: 100vh; }
    .header { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; align-items: center; }
    .header h3 { font-size: 13px; font-weight: 600; }
    .header button { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px; padding: 2px 6px; }
    .header button:hover { text-decoration: underline; }
    .messages { flex: 1; overflow-y: auto; padding: 12px; }
    .message { margin-bottom: 12px; padding: 8px 10px; border-radius: 6px; line-height: 1.5; word-wrap: break-word; }
    .message.user { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); }
    .message.assistant { background: var(--vscode-editor-inactiveSelectionBackground); border-left: 3px solid var(--vscode-charts-green); }
    .message pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 6px 0; position: relative; }
    .message code { font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; }
    .message pre code { display: block; }
    .copy-btn { position: absolute; top: 4px; right: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 2px 8px; border-radius: 3px; font-size: 10px; cursor: pointer; opacity: 0; transition: opacity 0.2s; }
    .message pre:hover .copy-btn { opacity: 1; }
    .loading { display: flex; align-items: center; gap: 6px; padding: 8px 10px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .loading .spinner { width: 14px; height: 14px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .input-area { padding: 10px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 6px; align-items: flex-end; }
    .input-area textarea { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px 8px; font-size: 12px; font-family: inherit; resize: none; min-height: 36px; max-height: 120px; outline: none; }
    .input-area textarea:focus { border-color: var(--vscode-focusBorder); }
    .input-area button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .input-area button:hover { background: var(--vscode-button-hoverBackground); }
    .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    .quick-actions { padding: 0 12px 8px; display: flex; gap: 4px; flex-wrap: wrap; }
    .quick-actions button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-secondaryBorder); padding: 3px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; }
    .quick-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <div class="header">
    <h3>🤖 飞虹 Code AI</h3>
    <button id="clearBtn">清空</button>
  </div>
  <div class="quick-actions">
    <button id="addContextBtn">📎 添加当前文件</button>
    <button id="explainBtn">💡 解释代码</button>
    <button id="refactorBtn">🔧 重构</button>
  </div>
  <div class="messages" id="messages"></div>
  <div class="input-area">
    <textarea id="input" placeholder="输入问题，Enter 发送，Shift+Enter 换行..." rows="1"></textarea>
    <button id="sendBtn">发送</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');
    const addContextBtn = document.getElementById('addContextBtn');
    let isLoading = false;

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderMarkdown(text) {
      let html = escapeHtml(text);
      // 代码块
      html = html.replace(/\`\`\`(\w*)\n?([\\s\\S]*?)\`\`\`/g, (m, lang, code) => {
        return '<pre><button class="copy-btn" onclick="copyCode(this)">复制</button><code>' + code.trim() + '</code></pre>';
      });
      // 行内代码
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      // 换行
      html = html.replace(/\\n/g, '<br>');
      return html;
    }

    window.copyCode = function(btn) {
      const code = btn.nextElementSibling.textContent;
      vscode.postMessage({ type: 'insertCode', code });
      btn.textContent = '已插入';
      setTimeout(() => btn.textContent = '复制', 1500);
    };

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.innerHTML = renderMarkdown(content);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setLoading(show) {
      isLoading = show;
      sendBtn.disabled = show;
      let loadingEl = document.getElementById('loading-indicator');
      if (show && !loadingEl) {
        loadingEl = document.createElement('div');
        loadingEl.id = 'loading-indicator';
        loadingEl.className = 'loading';
        loadingEl.innerHTML = '<div class="spinner"></div><span>思考中...</span>';
        messagesEl.appendChild(loadingEl);
      } else if (!show && loadingEl) {
        loadingEl.remove();
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function sendMessage() {
      const content = inputEl.value.trim();
      if (!content || isLoading) return;
      vscode.postMessage({ type: 'sendMessage', content });
      inputEl.value = '';
      inputEl.style.height = 'auto';
    }

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });
    clearBtn.addEventListener('click', () => {
      messagesEl.innerHTML = '';
      vscode.postMessage({ type: 'clearChat' });
    });
    addContextBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'addContext' });
    });
    document.getElementById('explainBtn').addEventListener('click', () => {
      inputEl.value = '请解释以下代码的作用和逻辑：';
      inputEl.focus();
    });
    document.getElementById('refactorBtn').addEventListener('click', () => {
      inputEl.value = '请重构以下代码，提升可读性和性能：';
      inputEl.focus();
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'message':
          addMessage(msg.role, msg.content);
          break;
        case 'loading':
          setLoading(msg.show);
          break;
        case 'clear':
          messagesEl.innerHTML = '';
          break;
        case 'appendInput':
          inputEl.value = (inputEl.value ? inputEl.value + '\\n\\n' : '') + msg.content;
          inputEl.style.height = 'auto';
          inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

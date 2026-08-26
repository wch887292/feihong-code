/**
 * 飞虹 Code VSCode 插件 - 入口文件
 * 激活扩展、注册命令和 Provider
 */
import * as vscode from 'vscode';
import { FeihongApiClient } from './api';
import { FeihongInlineCompletionProvider, FeihongCompletionItemProvider } from './completion';
import { FeihongChatViewProvider } from './chat-view';
import { FeihongChangesViewProvider } from './changes-view';

let apiClient: FeihongApiClient;
let chatViewProvider: FeihongChatViewProvider;
let changesViewProvider: FeihongChangesViewProvider;
let inlineCompletionProvider: vscode.Disposable | undefined;
let completionItemProvider: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext): void {
  console.log('[飞虹 Code] 插件已激活');

  // 初始化 API 客户端
  apiClient = new FeihongApiClient();

  // 注册聊天侧边栏
  chatViewProvider = new FeihongChatViewProvider(apiClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FeihongChatViewProvider.viewType, chatViewProvider),
  );

  // 注册变更审批侧边栏
  changesViewProvider = new FeihongChangesViewProvider(apiClient);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(FeihongChangesViewProvider.viewType, changesViewProvider),
  );

  // 注册补全 Provider
  registerCompletionProviders(context);

  // 注册命令
  registerCommands(context);

  // 监听配置变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('feihong-code')) {
        apiClient.reloadConfig();
        // 如果内联补全开关变化，重新注册
        if (e.affectsConfiguration('feihong-code.enableInlineCompletions')) {
          registerCompletionProviders(context);
        }
      }
    }),
  );

  // 启动时检查后端连接
  checkBackendHealth();
}

/** 注册补全 Provider */
function registerCompletionProviders(context: vscode.ExtensionContext): void {
  // 先释放旧的
  inlineCompletionProvider?.dispose();
  completionItemProvider?.dispose();

  const config = vscode.workspace.getConfiguration('feihong-code');
  const documentSelector: vscode.DocumentSelector = [
    { scheme: 'file', language: '*' },
    { scheme: 'untitled', language: '*' },
  ];

  // 内联补全（ghost text）
  if (config.get<boolean>('enableInlineCompletions', true)) {
    inlineCompletionProvider = vscode.languages.registerInlineCompletionItemProvider(
      documentSelector,
      new FeihongInlineCompletionProvider(apiClient),
    );
    context.subscriptions.push(inlineCompletionProvider);
  }

  // 补全项弹窗（Ctrl+Space）
  completionItemProvider = vscode.languages.registerCompletionItemProvider(
    documentSelector,
    new FeihongCompletionItemProvider(apiClient),
    '.', '(', ',', ' ',
  );
  context.subscriptions.push(completionItemProvider);
}

/** 注册命令 */
function registerCommands(context: vscode.ExtensionContext): void {
  // 打开聊天
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.chat', () => {
      vscode.commands.executeCommand('feihong-code.chat.focus');
    }),
  );

  // 解释选中代码
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.explain', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const code = editor.document.getText(editor.selection);
      await chatViewProvider.sendCommand('请详细解释以下代码的作用、逻辑和关键点：', code);
      vscode.commands.executeCommand('feihong-code.chat.focus');
    }),
  );

  // 重构选中代码
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.refactor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const code = editor.document.getText(editor.selection);
      await chatViewProvider.sendCommand('请重构以下代码，提升可读性、性能和可维护性，保持功能不变：', code);
      vscode.commands.executeCommand('feihong-code.chat.focus');
    }),
  );

  // 生成单元测试
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.generateTests', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const code = editor.document.getText(editor.selection);
      const lang = editor.document.languageId;
      await chatViewProvider.sendCommand(`请为以下 ${lang} 代码生成完整的单元测试，覆盖正常、边界和异常情况：`, code);
      vscode.commands.executeCommand('feihong-code.chat.focus');
    }),
  );

  // 修复诊断错误
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.fixErrors', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
      if (errors.length === 0) {
        vscode.window.showInformationMessage('当前文件没有错误');
        return;
      }
      const errorText = errors.map((e) => `行 ${e.range.start.line + 1}: ${e.message}`).join('\n');
      const code = editor.document.getText();
      await chatViewProvider.sendCommand(
        `以下代码有这些错误，请修复：\n${errorText}\n\n代码：`,
        code,
      );
      vscode.commands.executeCommand('feihong-code.chat.focus');
    }),
  );

  // 开关内联补全
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.toggleInlineCompletions', async () => {
      const config = vscode.workspace.getConfiguration('feihong-code');
      const current = config.get<boolean>('enableInlineCompletions', true);
      await config.update('enableInlineCompletions', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`内联补全已${!current ? '启用' : '禁用'}`);
    }),
  );

  // 设置后端地址
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.setBackendUrl', async () => {
      const config = vscode.workspace.getConfiguration('feihong-code');
      const current = config.get<string>('backendUrl', 'http://localhost:3717');
      const input = await vscode.window.showInputBox({
        prompt: '输入飞虹 Code 后端服务地址',
        value: current,
        placeHolder: 'http://localhost:3717',
      });
      if (input) {
        await config.update('backendUrl', input, vscode.ConfigurationTarget.Global);
        apiClient.reloadConfig();
        vscode.window.showInformationMessage(`后端地址已设置为: ${input}`);
        checkBackendHealth();
      }
    }),
  );

  // 变更审批命令
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code.changes.refresh', () => {
      changesViewProvider.refresh();
    }),
    vscode.commands.registerCommand('feihong-code.changes.accept', async (item: any) => {
      if (item instanceof vscode.TreeItem) {
        // 从 TreeItem 获取 change 对象
        const changeItem = item as any;
        if (changeItem.change) {
          await changesViewProvider.acceptChange(changeItem);
        }
      }
    }),
    vscode.commands.registerCommand('feihong-code.changes.reject', async (item: any) => {
      if (item instanceof vscode.TreeItem) {
        const changeItem = item as any;
        if (changeItem.change) {
          await changesViewProvider.rejectChange(changeItem);
        }
      }
    }),
    vscode.commands.registerCommand('feihong-code.changes.commitAll', async () => {
      await changesViewProvider.commitAll();
    }),
  );

  // 内部命令：补全接受统计
  context.subscriptions.push(
    vscode.commands.registerCommand('feihong-code._onAcceptCompletion', () => {
      // 可用于统计补全接受率
    }),
  );
}

/** 检查后端健康状态 */
async function checkBackendHealth(): Promise<void> {
  const healthy = await apiClient.healthCheck();
  if (!healthy) {
    vscode.window.showWarningMessage(
      `飞虹 Code 后端服务未连接 (${apiClient.getBaseUrl()})。请启动后端服务或运行 "飞虹 Code: 设置后端服务地址" 命令修改地址。`,
      '设置地址',
      '稍后提醒',
    ).then((choice) => {
      if (choice === '设置地址') {
        vscode.commands.executeCommand('feihong-code.setBackendUrl');
      }
    });
  } else {
    console.log('[飞虹 Code] 后端服务连接正常');
  }
}

export function deactivate(): void {
  console.log('[飞虹 Code] 插件已停用');
}

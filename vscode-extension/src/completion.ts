/**
 * 飞虹 Code VSCode 插件 - 代码补全 Provider
 * 实现内联补全（ghost text）和补全项弹窗
 */
import * as vscode from 'vscode';
import { FeihongApiClient, CompletionSuggestion } from './api';

/**
 * 内联补全 Provider（ghost text，Tab 接受）
 */
export class FeihongInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private apiClient: FeihongApiClient;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastRequest: { key: string; promise: Promise<vscode.InlineCompletionList> } | null = null;

  constructor(apiClient: FeihongApiClient) {
    this.apiClient = apiClient;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const config = vscode.workspace.getConfiguration('feihong-code');
    if (!config.get<boolean>('enableInlineCompletions', true)) {
      return [];
    }

    // 防抖
    const debounceMs = config.get<number>('completionDebounceMs', 300);
    await new Promise<void>((resolve) => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(resolve, debounceMs);
    });

    if (token.isCancellationRequested) return [];

    const cursorOffset = document.offsetAt(position);
    const filePath = this.getRelativePath(document);
    const mode = config.get<'quick' | 'full'>('completionMode', 'quick');

    // 缓存：相同上下文不重复请求
    const cacheKey = `${filePath}:${cursorOffset}:${document.getText().slice(Math.max(0, cursorOffset - 100), cursorOffset + 50)}`;
    if (this.lastRequest && this.lastRequest.key === cacheKey) {
      return (await this.lastRequest.promise).items;
    }

    const promise = this.fetchCompletions(document, position, filePath, cursorOffset, mode, token);
    this.lastRequest = { key: cacheKey, promise };

    try {
      const result = await promise;
      return result.items;
    } catch {
      return [];
    }
  }

  private async fetchCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    filePath: string,
    cursorOffset: number,
    mode: 'quick' | 'full',
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList> {
    try {
      const resp = await this.apiClient.completion({
        filePath,
        fileContent: document.getText(),
        cursorOffset,
        mode,
        language: document.languageId,
      });

      if (token.isCancellationRequested || !resp.suggestions.length) {
        return new vscode.InlineCompletionList([]);
      }

      const items = resp.suggestions.slice(0, 3).map((s: CompletionSuggestion) => {
        const item = new vscode.InlineCompletionItem(s.text);
        item.range = new vscode.Range(position, position);
        item.command = {
          title: '飞虹 Code 补全',
          command: 'feihong-code._onAcceptCompletion',
          arguments: [{ model: resp.model, latencyMs: resp.latencyMs, cached: resp.cached }],
        };
        return item;
      });

      return new vscode.InlineCompletionList(items);
    } catch (e) {
      return new vscode.InlineCompletionList([]);
    }
  }

  private getRelativePath(document: vscode.TextDocument): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder) {
      return vscode.workspace.asRelativePath(document.uri, false);
    }
    return document.uri.fsPath;
  }
}

/**
 * 补全项 Provider（Ctrl+Space 触发弹窗）
 */
export class FeihongCompletionItemProvider implements vscode.CompletionItemProvider {
  private apiClient: FeihongApiClient;

  constructor(apiClient: FeihongApiClient) {
    this.apiClient = apiClient;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[]> {
    const config = vscode.workspace.getConfiguration('feihong-code');
    const cursorOffset = document.offsetAt(position);
    const filePath = this.getRelativePath(document);

    try {
      const resp = await this.apiClient.completion({
        filePath,
        fileContent: document.getText(),
        cursorOffset,
        mode: 'full',
        language: document.languageId,
      });

      if (token.isCancellationRequested) return [];

      return resp.suggestions.map((s: CompletionSuggestion, idx: number) => {
        const item = new vscode.CompletionItem(
          s.preview || s.text.slice(0, 50),
          this.mapKind(s.kind),
        );
        item.insertText = s.text;
        item.detail = `飞虹 Code · ${s.kind} · ${Math.round(s.confidence * 100)}%`;
        item.documentation = new vscode.MarkdownString('```\n' + s.text + '\n```');
        item.sortText = String(idx).padStart(3, '0');
        item.preselect = idx === 0;
        return item;
      });
    } catch {
      return [];
    }
  }

  private mapKind(kind: string): vscode.CompletionItemKind {
    switch (kind) {
      case 'function': return vscode.CompletionItemKind.Function;
      case 'import': return vscode.CompletionItemKind.Module;
      case 'block': return vscode.CompletionItemKind.Snippet;
      default: return vscode.CompletionItemKind.Text;
    }
  }

  private getRelativePath(document: vscode.TextDocument): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder) {
      return vscode.workspace.asRelativePath(document.uri, false);
    }
    return document.uri.fsPath;
  }
}

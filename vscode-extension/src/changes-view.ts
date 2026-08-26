/**
 * 飞虹 Code VSCode 插件 - 变更审批侧边栏
 * TreeView 展示 AI 生成的变更，支持逐文件接受/拒绝
 */
import * as vscode from 'vscode';
import { FeihongApiClient, ChangeItem } from './api';

class ChangeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly change: ChangeItem,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(change.path, collapsibleState);
    this.tooltip = `${change.path} (${change.status})`;
    this.description = change.status;
    this.iconPath = this.getIcon();
    this.contextValue = change.status;
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.change.status) {
      case 'staged': return new vscode.ThemeIcon('git-stage', new vscode.ThemeColor('charts.foreground'));
      case 'accepted': return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'rejected': return new vscode.ThemeIcon('x', new vscode.ThemeColor('charts.red'));
      case 'conflict': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      default: return new vscode.ThemeIcon('file');
    }
  }
}

export class FeihongChangesViewProvider implements vscode.TreeDataProvider<ChangeTreeItem> {
  public static readonly viewType = 'feihong-code.changes';
  private _onDidChangeTreeData = new vscode.EventEmitter<ChangeTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private apiClient: FeihongApiClient;
  private changes: ChangeItem[] = [];

  constructor(apiClient: FeihongApiClient) {
    this.apiClient = apiClient;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ChangeTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ChangeTreeItem): Promise<ChangeTreeItem[]> {
    if (element) {
      // 变更详情子节点（显示 diff 摘要）
      if (element.change.diff) {
        return [new ChangeTreeItem(
          { ...element.change, path: '查看 diff...', status: element.change.status },
          vscode.TreeItemCollapsibleState.None,
        )];
      }
      return [];
    }
    try {
      this.changes = await this.apiClient.getChanges();
      return this.changes.map((c) =>
        new ChangeTreeItem(c, c.diff ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None),
      );
    } catch {
      return [];
    }
  }

  /** 接受变更 */
  async acceptChange(item: ChangeTreeItem): Promise<void> {
    try {
      await this.apiClient.acceptChange(item.change.id);
      vscode.window.showInformationMessage(`已接受: ${item.change.path}`);
      this.refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`接受失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 拒绝变更 */
  async rejectChange(item: ChangeTreeItem): Promise<void> {
    try {
      await this.apiClient.rejectChange(item.change.id);
      vscode.window.showInformationMessage(`已拒绝: ${item.change.path}`);
      this.refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`拒绝失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 提交所有变更 */
  async commitAll(): Promise<void> {
    try {
      await this.apiClient.commitChanges();
      vscode.window.showInformationMessage('已提交所有变更');
      this.refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`提交失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

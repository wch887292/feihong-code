/**
 * 飞虹 Code VSCode 插件 - 后端 API 客户端
 * 负责与飞虹 Code Express 后端服务通信
 */
import * as vscode from 'vscode';

export interface CompletionRequest {
  filePath: string;
  fileContent: string;
  cursorOffset: number;
  mode?: 'quick' | 'full';
  language?: string;
}

export interface CompletionSuggestion {
  text: string;
  kind: string;
  confidence: number;
  preview: string;
}

export interface CompletionResponse {
  suggestions: CompletionSuggestion[];
  latencyMs: number;
  model: string;
  cached: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  message: ChatMessage;
  model: string;
  latencyMs: number;
}

export interface ChangeItem {
  id: string;
  path: string;
  status: 'staged' | 'accepted' | 'rejected' | 'conflict';
  diff?: string;
  createdAt: string;
}

/**
 * 飞虹 Code 后端 API 客户端
 */
export class FeihongApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('feihong-code');
    this.baseUrl = config.get<string>('backendUrl', 'http://localhost:3717');
    this.apiKey = config.get<string>('apiKey', '');
  }

  /** 重新加载配置 */
  reloadConfig(): void {
    const config = vscode.workspace.getConfiguration('feihong-code');
    this.baseUrl = config.get<string>('backendUrl', 'http://localhost:3717');
    this.apiKey = config.get<string>('apiKey', '');
  }

  /** 获取后端地址 */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** 检查后端是否可用 */
  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** 请求代码补全 */
  async completion(req: CompletionRequest): Promise<CompletionResponse> {
    const resp = await fetch(`${this.baseUrl}/api/completion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(req.mode === 'full' ? 8000 : 4000),
    });
    if (!resp.ok) {
      throw new Error(`补全请求失败: ${resp.status} ${resp.statusText}`);
    }
    return resp.json() as Promise<CompletionResponse>;
  }

  /** 发送聊天消息 */
  async chat(messages: ChatMessage[], options?: {
    temperature?: number;
    maxTokens?: number;
    workspace?: string;
  }): Promise<ChatResponse> {
    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ messages, ...options }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      throw new Error(`聊天请求失败: ${resp.status} ${resp.statusText}`);
    }
    return resp.json() as Promise<ChatResponse>;
  }

  /** 获取变更列表 */
  async getChanges(): Promise<ChangeItem[]> {
    const resp = await fetch(`${this.baseUrl}/api/changes`, {
      headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { changes?: ChangeItem[] };
    return (data.changes || []) as ChangeItem[];
  }

  /** 接受变更 */
  async acceptChange(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/changes/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  }

  /** 拒绝变更 */
  async rejectChange(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/changes/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  }

  /** 提交所有已接受变更 */
  async commitChanges(): Promise<void> {
    await fetch(`${this.baseUrl}/api/changes/commit`, {
      method: 'POST',
    });
  }
}

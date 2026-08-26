/**
 * 飞虹 Code - 协作工具集成 (阶段三-2)
 *
 * 支持主流协作工具集成：
 * - 飞书：消息通知、任务同步、机器人推送
 * - GitHub：PR 自动审查、Issue 管理、提交信息生成
 */
import { logger } from '../shared/logger';

/** 飞书配置 */
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  webhookUrl?: string;
  defaultReceiver?: string;
}

/** GitHub 配置 */
export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  apiBase?: string;
}

/** 消息通知内容 */
export interface NotificationMessage {
  title: string;
  content: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  receiver?: string;
  link?: string;
  data?: Record<string, unknown>;
}

/** PR 审查结果 */
export interface PRReviewResult {
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  status: 'approved' | 'changes_requested' | 'commented';
  summary: string;
  issues: Array<{
    severity: 'critical' | 'major' | 'minor' | 'suggestion';
    file: string;
    line?: number;
    description: string;
    suggestion?: string;
  }>;
  qualityScore: number;
  reviewedAt: string;
}

/**
 * 飞书集成
 */
export class FeishuIntegration {
  private config: FeishuConfig;
  private tenantAccessToken?: string;
  private tokenExpireTime = 0;

  constructor(config: FeishuConfig) {
    this.config = config;
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tokenExpireTime) {
      return this.tenantAccessToken;
    }
    try {
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
      });
      const data = await response.json() as any;
      if (data.code !== 0) throw new Error(`获取飞书令牌失败: ${data.msg}`);
      this.tenantAccessToken = data.tenant_access_token;
      this.tokenExpireTime = Date.now() + (data.expire - 300) * 1000;
      return this.tenantAccessToken!;
    } catch (error) {
      logger.error('feishu token error', { error: String(error) });
      throw error;
    }
  }

  async sendWebhookMessage(message: NotificationMessage): Promise<boolean> {
    if (!this.config.webhookUrl) throw new Error('未配置飞书 Webhook URL');
    const colorMap = { info: 'blue', success: 'green', warning: 'orange', error: 'red' };
    const payload: any = {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: message.title }, template: colorMap[message.type || 'info'] },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: message.content } }],
      },
    };
    if (message.link) {
      payload.card.elements.push({
        tag: 'action',
        actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看详情' }, type: 'primary', url: message.link }],
      });
    }
    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as any;
      if (data.code !== 0 && data.StatusCode !== 0) throw new Error(`飞书 Webhook 发送失败: ${data.msg || data.StatusMessage}`);
      logger.info('feishu webhook sent', { title: message.title });
      return true;
    } catch (error) {
      logger.error('feishu webhook error', { error: String(error) });
      return false;
    }
  }

  async sendMessage(message: NotificationMessage): Promise<boolean> {
    try {
      const token = await this.getTenantAccessToken();
      const receiver = message.receiver || this.config.defaultReceiver;
      if (!receiver) throw new Error('未指定消息接收者');
      const payload = {
        receive_id: receiver,
        msg_type: 'text',
        content: JSON.stringify({ text: `【${message.title}】\n${message.content}` }),
      };
      const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as any;
      if (data.code !== 0) throw new Error(`飞书消息发送失败: ${data.msg}`);
      logger.info('feishu message sent', { title: message.title, receiver });
      return true;
    } catch (error) {
      logger.error('feishu message error', { error: String(error) });
      if (this.config.webhookUrl) return this.sendWebhookMessage(message);
      return false;
    }
  }

  async notifyTaskComplete(taskName: string, result: string, link?: string): Promise<boolean> {
    return this.sendMessage({ title: '✅ 任务完成', content: `任务：${taskName}\n结果：${result}`, type: 'success', link });
  }

  async notifyTaskFailed(taskName: string, error: string): Promise<boolean> {
    return this.sendMessage({ title: '❌ 任务失败', content: `任务：${taskName}\n错误：${error}`, type: 'error' });
  }
}

/**
 * GitHub 集成
 */
export class GitHubIntegration {
  private config: GitHubConfig;
  private apiBase: string;

  constructor(config: GitHubConfig) {
    this.config = config;
    this.apiBase = config.apiBase || 'https://api.github.com';
  }

  async getPR(prNumber: number): Promise<any> {
    const response = await fetch(`${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}`, {
      headers: { 'Authorization': `token ${this.config.token}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!response.ok) throw new Error(`获取 PR 失败: ${response.statusText}`);
    return response.json();
  }

  async getPRFiles(prNumber: number): Promise<any[]> {
    const response = await fetch(`${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}/files`, {
      headers: { 'Authorization': `token ${this.config.token}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!response.ok) throw new Error(`获取 PR 文件失败: ${response.statusText}`);
    return response.json();
  }

  async submitPRReview(prNumber: number, review: PRReviewResult): Promise<boolean> {
    const event = review.status === 'approved' ? 'APPROVE' : review.status === 'changes_requested' ? 'REQUEST_CHANGES' : 'COMMENT';
    const body = `## 飞虹 Code 自动审查报告\n\n**PR**: #${prNumber} ${review.prTitle}\n**审查人**: 飞虹 Code AI\n**质量评分**: ${review.qualityScore}/100\n\n### 审查摘要\n${review.summary}\n\n### 问题列表\n${review.issues.length === 0 ? '无问题' : review.issues.map((issue, i) =>
      `${i + 1}. **[${issue.severity}]** ${issue.file}${issue.line ? `:${issue.line}` : ''}\n   - ${issue.description}${issue.suggestion ? `\n   - 建议: ${issue.suggestion}` : ''}`
    ).join('\n')}\n\n---\n*此审查由飞虹 Code 自动生成，仅供参考*`;

    const response = await fetch(`${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}/reviews`, {
      method: 'POST',
      headers: { 'Authorization': `token ${this.config.token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, body }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`提交 PR 审查失败: ${response.statusText} - ${error}`);
    }
    logger.info('github pr review submitted', { prNumber, status: review.status });
    return true;
  }

  async getIssues(state: 'open' | 'closed' | 'all' = 'open', labels?: string[]): Promise<any[]> {
    const params = new URLSearchParams({ state });
    if (labels) params.set('labels', labels.join(','));
    const response = await fetch(`${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/issues?${params}`, {
      headers: { 'Authorization': `token ${this.config.token}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!response.ok) throw new Error(`获取 Issue 失败: ${response.statusText}`);
    return response.json();
  }

  async createIssue(title: string, body: string, labels?: string[]): Promise<any> {
    const response = await fetch(`${this.apiBase}/repos/${this.config.owner}/${this.config.repo}/issues`, {
      method: 'POST',
      headers: { 'Authorization': `token ${this.config.token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, labels }),
    });
    if (!response.ok) throw new Error(`创建 Issue 失败: ${response.statusText}`);
    return response.json();
  }

  generateCommitMessage(changes: Array<{ file: string; type: string; summary: string }>): string {
    if (changes.length === 0) return 'chore: update';
    const typeMap: Record<string, string> = { added: 'feat', modified: 'fix', deleted: 'chore', renamed: 'refactor' };
    const primaryType = changes[0]?.type || 'modified';
    const prefix = typeMap[primaryType] || 'chore';
    const scope = changes.length > 1 ? 'multiple' : changes[0].file.split('/').pop()?.split('.')[0] || '';
    const summary = changes.length > 1 ? `update ${changes.length} files` : changes[0].summary || `update ${changes[0].file}`;
    let message = `${prefix}${scope ? `(${scope})` : ''}: ${summary}`;
    if (changes.length > 1) {
      message += '\n\nChanges:\n' + changes.map((c) => `- ${c.type}: ${c.file}`).join('\n');
    }
    return message;
  }
}

/**
 * 协作工具管理器
 */
export class CollaborationManager {
  private feishu?: FeishuIntegration;
  private github?: GitHubIntegration;

  constructor(config: { feishu?: FeishuConfig; github?: GitHubConfig }) {
    if (config.feishu) this.feishu = new FeishuIntegration(config.feishu);
    if (config.github) this.github = new GitHubIntegration(config.github);
  }

  getFeishu(): FeishuIntegration | undefined { return this.feishu; }
  getGitHub(): GitHubIntegration | undefined { return this.github; }

  async notifyAll(message: NotificationMessage): Promise<{ feishu: boolean }> {
    const results = { feishu: false };
    if (this.feishu) results.feishu = await this.feishu.sendMessage(message);
    return results;
  }
}

export function createCollaborationManager(config: { feishu?: FeishuConfig; github?: GitHubConfig }): CollaborationManager {
  return new CollaborationManager(config);
}

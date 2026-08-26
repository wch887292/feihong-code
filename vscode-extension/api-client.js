'use strict';
/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 极简 HTTP 客户端：对接本地 `fhcode serve` 的 REST API。
 * 所有端点均来自 src/web/server.ts（运行时由 dist/web/server.js 提供）。
 */
class ApiClient {
  /**
   * @param {string} serverUrl 例如 http://localhost:8080
   * @param {string} token 留空时调用 login 换取
   * @param {string} phone 自动登录手机号
   */
  constructor(serverUrl, token = '', phone = 'vscode-local') {
    this.serverUrl = String(serverUrl || 'http://localhost:8080').replace(/\/+$/, '');
    this.token = token || '';
    this.phone = phone || 'vscode-local';
  }

  _headers(auth = true) {
    const h = { 'Content-Type': 'application/json' };
    if (auth && this.token) h['Authorization'] = 'Bearer ' + this.token;
    return h;
  }

  async _post(path, body, auth = true) {
    const r = await fetch(this.serverUrl + path, {
      method: 'POST',
      headers: this._headers(auth),
      body: JSON.stringify(body ?? {}),
    });
    return r;
  }

  async _get(path, auth = true) {
    const r = await fetch(this.serverUrl + path, { method: 'GET', headers: this._headers(auth) });
    return r;
  }

  /** 健康检查（免鉴权） */
  async health() {
    try {
      const r = await fetch(this.serverUrl + '/api/health');
      if (!r.ok) return { ok: false };
      const j = await r.json();
      return { ok: true, ...j };
    } catch {
      return { ok: false };
    }
  }

  /** 手机号直登，换取 Bearer token（无短信验证，本地会话令牌） */
  async login() {
    const r = await this._post('/api/auth/login', { phone: this.phone }, false);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'login failed');
    this.token = j.token;
    return j;
  }

  /**
   * 行内补全
   * @param {{filePath:string,fileContent:string,cursorOffset:number,mode?:'quick'|'full',language?:string}} params
   */
  async completion(params) {
    const r = await this._post('/api/completion', {
      mode: 'quick',
      ...params,
    });
    return await r.json();
  }

  /** 提交一个新 Agent 任务 */
  async submitTask(goal, modelId) {
    const r = await this._post('/api/tasks', {
      goal,
      modelId: modelId || undefined,
      agentType: 'general',
    });
    return await r.json();
  }

  /** 向已有任务续接一条消息 */
  async continueTask(taskId, message) {
    const r = await this._post('/api/tasks/' + taskId + '/messages', { message });
    return await r.json();
  }

  /** 停止任务 */
  async stopTask(taskId) {
    const r = await this._post('/api/tasks/' + taskId + '/stop', {});
    return await r.json();
  }

  /** 拉取任务详情（含 steps / conversation） */
  async getTask(taskId) {
    const r = await this._get('/api/tasks/' + taskId);
    return await r.json();
  }
}

module.exports = { ApiClient };

/**
 * 飞虹 Code VS Code 扩展 · API 客户端
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 对接 fhcode Web 服务（默认 http://127.0.0.1:8080）真实链路：
 *  - 登录（免签）：POST /api/auth/login {phone} → { token }（手机号须 6-20 位数字）
 *  - 任务：POST /api/tasks（建任务）/ GET /api/tasks/:id（轮询，读请求免签）
 *          POST /api/tasks/:id/messages（多轮续接）/ POST /api/tasks/:id/stop（停止）
 *  - 签名协议（F2 加固后）：/api/ 下写请求需 HMAC-SHA256，密钥 = Bearer 会话令牌本身，
 *    签名串 = `${ts}|${nonce}|${bodyRaw}`，头：x-fh-ts / x-fh-nonce / x-fh-sig
 */
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

class FhApiClient {
  constructor(serverUrl, token = '') {
    this.serverUrl = (serverUrl || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    this.token = token;
  }

  setToken(token) {
    this.token = token;
  }

  /** 底层请求：返回 { status, json } */
  _raw(method, path, bodyRaw, headers = {}, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
      const u = new URL(this.serverUrl + path);
      const lib = u.protocol === 'https:' ? https : http;
      const opts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        timeout: timeoutMs,
      };
      const req = lib.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { json = { raw: data }; }
          resolve({ status: res.statusCode, json });
        });
      });
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', reject);
      if (bodyRaw) req.write(bodyRaw);
      req.end();
    });
  }

  /**
   * 登录（免签）。成功后自动持有 token。
   * @param {string} phone 6-20 位数字手机号
   * @returns {{status:number, json:any}}
   */
  async login(phone) {
    const r = await this._raw('POST', '/api/auth/login', JSON.stringify({ phone }), {}, 8000);
    if (r.status === 200 && r.json && r.json.token) this.setToken(r.json.token);
    return r;
  }

  /** 写请求统一签名头（密钥 = Bearer 令牌，与服务端 F2 派生逻辑同源） */
  _signedHeaders(bodyRaw) {
    if (!this.token) throw new Error('未登录：请先配置手机号（feihong-code.phone）或访问令牌');
    const ts = String(Date.now());
    const nonce = crypto.randomBytes(12).toString('hex');
    const sig = crypto
      .createHmac('sha256', this.token)
      .update(ts + '|' + nonce + '|' + bodyRaw)
      .digest('hex');
    return {
      Authorization: 'Bearer ' + this.token,
      'x-fh-ts': ts,
      'x-fh-nonce': nonce,
      'x-fh-sig': sig,
    };
  }

  /** GET /api/health（4s 超时，用于连接检测） */
  health() {
    return this._raw('GET', '/api/health', null, {}, 4000);
  }

  /** 创建任务：POST /api/tasks { goal, ...extra } → { ok, task } */
  async createTask(goal, extra = {}) {
    const bodyRaw = JSON.stringify(Object.assign({ goal }, extra));
    return this._raw('POST', '/api/tasks', bodyRaw, this._signedHeaders(bodyRaw));
  }

  /** 查询任务（读请求免签）：GET /api/tasks/:id → { ok, task } */
  async getTask(id) {
    const headers = this.token ? { Authorization: 'Bearer ' + this.token } : {};
    return this._raw('GET', '/api/tasks/' + encodeURIComponent(id), null, headers);
  }

  /** 多轮续接：POST /api/tasks/:id/messages { message }（任务运行中返回 409） */
  async continueTask(id, message) {
    const bodyRaw = JSON.stringify({ message });
    return this._raw(
      'POST',
      '/api/tasks/' + encodeURIComponent(id) + '/messages',
      bodyRaw,
      this._signedHeaders(bodyRaw)
    );
  }

  /** 停止任务：POST /api/tasks/:id/stop */
  async stopTask(id) {
    return this._raw(
      'POST',
      '/api/tasks/' + encodeURIComponent(id) + '/stop',
      '{}',
      this._signedHeaders('{}')
    );
  }

  /**
   * 轮询任务直到终态（done / failed）或超时。
   * @param {(task:object)=>void} onTick 每次轮询回调（可用于增量渲染）
   */
  async pollTask(id, onTick, intervalMs = 1200, timeoutMs = 900000) {
    const start = Date.now();
    for (;;) {
      let r;
      try {
        r = await this.getTask(id);
      } catch (e) {
        // 网络抖动不立即失败，继续重试直至超时
        if (Date.now() - start > timeoutMs) throw e;
        await new Promise((res) => setTimeout(res, intervalMs));
        continue;
      }
      if (r.status === 200 && r.json && r.json.task) {
        const task = r.json.task;
        if (onTick) onTick(task);
        if (task.status === 'done' || task.status === 'failed') return task;
      } else if (r.status === 404) {
        throw new Error('任务不存在（可能服务端已重启清空任务队列）');
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error('任务轮询超时（超过 ' + Math.round(timeoutMs / 60000) + ' 分钟），可稍后在 Web 控制台查看结果');
      }
      await new Promise((res) => setTimeout(res, intervalMs));
    }
  }
}

module.exports = { FhApiClient };

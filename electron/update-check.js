/**
 * 飞虹 Code 桌面端更新检查
 *
 * 对标 Today AI 桌面端的更新通道做法（app-update.yml + channel + 静默检查 + 失败降级）：
 * 这里不引入 electron-updater（需要签名与 latest.yml 托管），只用 GitHub Releases API 做
 * 「版本发现 + 显式提示 + 一键跳转下载」，保证：
 *   1. 零新增运行时依赖，打包体积不变；
 *   2. 任何网络/限流/解析失败都静默降级，绝不影响主流程启动；
 *   3. 版本比较走 semver 数值比较，不做字符串比较（避免 v8.9.0 vs v8.12.0 误判）。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const REPO = 'wch887292/feihong-code';
const DEFAULT_ENDPOINT = `https://api.github.com/repos/${REPO}/releases/latest`;
const REQUEST_TIMEOUT_MS = 6000;

/** 把 "v8.12.0" / "8.12.0-beta.1" 解析成可比较的数字数组 */
function parseVersion(v) {
  const core = String(v || '').trim().replace(/^v/i, '').split('-')[0];
  const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

/** a > b 返回 1，相等 0，小于 -1 */
function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': `feihong-code-desktop/${app.getVersion()}`,
          Accept: 'application/vnd.github+json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/**
 * 检查更新。
 * @returns {Promise<{hasUpdate:boolean, current:string, latest:string, url?:string, notes?:string, error?:string}>}
 */
async function checkForUpdates() {
  const current = app.getVersion();
  const endpoint = process.env.FH_UPDATE_ENDPOINT || DEFAULT_ENDPOINT;
  try {
    const release = await fetchJson(endpoint);
    const latest = String(release.tag_name || release.name || '').replace(/^v/i, '');
    if (!latest) return { hasUpdate: false, current, latest: current, error: 'no tag_name' };
    return {
      hasUpdate: compareVersion(latest, current) > 0,
      current,
      latest,
      url: release.html_url,
      notes: typeof release.body === 'string' ? release.body.slice(0, 800) : '',
    };
  } catch (e) {
    // 网络不可达 / 429 限流 / 私有仓库 403 都走这里：静默降级，不打扰用户
    return { hasUpdate: false, current, latest: current, error: e && e.message ? e.message : String(e) };
  }
}

/** 通知去重：同一版本只提示一次，避免每次启动都弹窗 */
function statePath() {
  return path.join(app.getPath('userData'), 'update-state.json');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function shouldNotify(latest) {
  return readState().lastNotified !== latest;
}

function markNotified(latest) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify({ lastNotified: latest, at: Date.now() }), 'utf8');
  } catch {
    /* 写盘失败只是会重复提示，不影响主流程 */
  }
}

module.exports = { checkForUpdates, compareVersion, parseVersion, shouldNotify, markNotified };


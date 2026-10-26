// v78 全链路冒烟测试（2026-10-26）
// 覆盖吴总五项要求：①打开即用(APK内置双令牌) ②本地电脑连接 ③云电脑连接
//              ④同步任务页(CORS) ⑤信息同步(快照上报)
// 说明：本地端口(8082/18085)本地探；云端(sync.klai.top / api.klai.top)线上探；APK 解包探。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');

const TOK_FILE = path.join(os.homedir(), '.feihong-code', 'web-token.json');
const T = JSON.parse(fs.readFileSync(TOK_FILE, 'utf8'));
const SYNC = T.token, BRIDGE = T.bridgeToken;

function req(method, url, headers, body, timeoutMs) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch (e) { return resolve({ ok: false, err: 'bad url' }); }
    const mod = u.protocol === 'https:' ? https : http;
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const h = Object.assign({}, headers || {});
    if (data) h['Content-Type'] = h['Content-Type'] || 'application/json';
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = mod.request(u, { method, headers: h, timeout: timeoutMs || 12000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ ok: true, status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on('timeout', () => { r.destroy(new Error('timeout')); resolve({ ok: false, err: 'timeout', status: 0 }); });
    r.on('error', (e) => resolve({ ok: false, err: e.message, status: 0 }));
    if (data) r.write(data);
    r.end();
  });
}

function localReq(method, url, headers, body) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch (e) { return resolve({ ok: false, err: 'bad url' }); }
    const data = body ? JSON.stringify(body) : null;
    const h = Object.assign({}, headers || {});
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request(u, { method, headers: h, timeout: 8000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ ok: true, status: res.statusCode, body: d }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ ok: false, err: 'timeout', status: 0 }); });
    r.on('error', (e) => resolve({ ok: false, err: e.message, status: 0 }));
    if (data) r.write(data);
    r.end();
  });
}

function mark(b) { return b ? '✅ PASS' : '❌ FAIL'; }
const results = [];
function rec(item, pass, detail) { results.push({ item, pass, detail }); console.log(`${mark(pass)}  ${item} — ${detail}`); }

(async () => {
  console.log('===== v78 全链路冒烟测试 =====');
  console.log('sync token : ' + SYNC.slice(0, 12) + '…  bridge token: ' + BRIDGE.slice(0, 12) + '…');

  // ① 打开即用：APK 内置双令牌
  try {
    const apk = path.join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    if (fs.existsSync(apk)) {
      const tmp = path.join(os.tmpdir(), 'smoke-apk');
      fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
      execSync(`unzip -o -q "${path.resolve(apk)}" "assets/public/js/*" -d "${tmp}"`, { cwd: 'H:/feihong-code' });
      const appJs = fs.readFileSync(path.join(tmp, 'assets/public/js/app.js'), 'utf8');
      const syncJs = fs.readFileSync(path.join(tmp, 'assets/public/js/sync-task.js'), 'utf8');
      const appSync = (appJs.split(SYNC).length - 1);
      const appBridge = (appJs.split(BRIDGE).length - 1);
      const syncSync = (syncJs.split(SYNC).length - 1);
      // 漏注入判定：仅当“赋值位”仍持有占位符（如 var X = '<FH_...>'）才算泄漏；
      // 守卫（.indexOf('<FH_...')）与注释中的占位符是故意保留，不计为漏注入
      const leftover = /=\s*['"]<FH_(DEFAULT|BRIDGE|SYNC)_TOKEN>['"]/.test(appJs + syncJs);
      rec('① 打开即用：APK 内置双令牌', appSync >= 1 && appBridge >= 1 && syncSync >= 1 && !leftover,
        `app.js(sync×${appSync},bridge×${appBridge}) sync-task.js(sync×${syncSync}) 残留占位符=${leftover}`);
    } else rec('① 打开即用：APK', false, '未找到 app-release.apk');
  } catch (e) { rec('① 打开即用：APK', false, '异常 ' + e.message); }

  // ② 本地电脑连接：8082 健康 + bridgeToken 鉴权 + syncToken 拒否
  const h8082 = await localReq('GET', 'http://127.0.0.1:8082/api/health');
  rec('② 本地电脑·8082 健康', h8082.ok && h8082.status === 200, `HTTP ${h8082.status}`);
  const t8082 = await localReq('GET', 'http://127.0.0.1:8082/api/tasks', { Authorization: 'Bearer ' + BRIDGE });
  rec('② 本地电脑·bridgeToken 鉴权', t8082.ok && t8082.status === 200, `HTTP ${t8082.status}（手机直连模式用此令牌）`);
  const s8082 = await localReq('GET', 'http://127.0.0.1:8082/api/tasks', { Authorization: 'Bearer ' + SYNC });
  rec('② 本地电脑·syncToken 应拒', s8082.ok && s8082.status === 401, `HTTP ${s8082.status}（口径正确：8082 认 bridge 不认 sync）`);

  // ③ 云电脑连接：桥接设备在线
  const dev = await req('GET', 'https://api.klai.top/fhrelay/api/bridge/devices', { Authorization: 'Bearer ' + BRIDGE, Origin: 'https://localhost' });
  let online = false;
  try { const j = JSON.parse(dev.body); online = (j.devices || []).some(d => d.name === '家里电脑' && d.status === 'online'); } catch (e) {}
  rec('③ 云电脑·桥接设备在线', dev.ok && dev.status === 200 && online, `HTTP ${dev.status} 家里电脑=online`);

  // ④ 同步任务页：health + 带令牌 200 + CORS 预检 204 + 无令牌 401
  const sh = await req('GET', 'https://sync.klai.top/health');
  rec('④ 同步页·health', sh.ok && sh.status === 200, `HTTP ${sh.status}`);
  const ss = await req('GET', 'https://sync.klai.top/api/sessions', { Authorization: 'Bearer ' + SYNC, Origin: 'https://localhost' });
  rec('④ 同步页·sync 令牌鉴权', ss.ok && ss.status === 200, `HTTP ${ss.status}`);
  const opt = await req('OPTIONS', 'https://sync.klai.top/api/sessions', { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' });
  const acao = (opt.headers && (opt.headers['access-control-allow-origin'] || opt.headers['Access-Control-Allow-Origin'])) || '';
  rec('④ 同步页·CORS 预检', opt.ok && opt.status === 204 && !!acao, `HTTP ${opt.status} ACAO=${acao}`);
  const noTok = await req('GET', 'https://sync.klai.top/api/sessions', { Origin: 'https://localhost' });
  rec('④ 同步页·无令牌应拒', noTok.ok && noTok.status === 401, `HTTP ${noTok.status}`);

  // ⑤ 信息同步：快照上报 POST（与 app.js syncChatSnapshot 同字段：runId/goal/status/messages）
  const sid = 'smoke-' + Date.now();
  const post = await req('POST', 'https://sync.klai.top/api/sessions', { Authorization: 'Bearer ' + SYNC, 'Content-Type': 'application/json' },
    { runId: sid, goal: '手机端对话', status: 'done', messages: [{ role: 'user', content: 'v78 冒烟测试' }, { role: 'assistant', content: 'ok' }] });
  rec('⑤ 信息同步·快照 POST', post.ok && post.status === 200, `HTTP ${post.status} runId=${sid}`);
  const getBack = await req('GET', 'https://sync.klai.top/api/sessions/' + sid, { Authorization: 'Bearer ' + SYNC });
  let roundtrip = false;
  try { const j = JSON.parse(getBack.body); roundtrip = (j.session && j.session.runId === sid); } catch (e) {}
  rec('⑤ 信息同步·回读', getBack.ok && getBack.status === 200 && roundtrip, `HTTP ${getBack.status} 回读一致=${roundtrip}`);

  // 汇总
  const passN = results.filter(r => r.pass).length;
  console.log('===== 汇总 ' + passN + '/' + results.length + ' PASS =====');
  process.exit(passN === results.length ? 0 : 2);
})();

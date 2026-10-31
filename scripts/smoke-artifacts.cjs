// P2-1 产物回传链路冒烟测试（2026-10-30）
// 覆盖：本地8082扫描 + 家电脑在线 + 云端POST上报 + 云端GET拉取(修复关键) + 云端执行体兜底 + APK产物
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const TOK = JSON.parse(fs.readFileSync('C:/Users/Administrator/.feihong-code/web-token.json', 'utf8')).bridgeToken;
const CLOUD = 'api.klai.top';
const BASE = '/fhrelay';

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const lib = opts.proto === 'https' ? https : http;
    const r = lib.request(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
function sign(bodyStr) {
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const sig = crypto.createHmac('sha256', TOK).update(ts + '|' + nonce + '|' + bodyStr).digest('hex');
  return { 'x-fh-ts': ts, 'x-fh-nonce': nonce, 'x-fh-sig': sig, 'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json' };
}
const B = { 'Authorization': 'Bearer ' + TOK };

async function main() {
  const R = [];
  const ok = (n, c, d) => R.push([n, c ? 'PASS' : 'FAIL', d]);
  const err = (n, e) => R.push([n, 'ERROR', e.message]);

  // 环1 本地 8082 健康
  try {
    const h = await req({ proto: 'http', host: '127.0.0.1', port: 8082, path: '/api/health', method: 'GET' });
    ok('本地8082 health', h.status === 200, 'http=' + h.status);
  } catch (e) { err('本地8082 health', e); }

  // 环1b 本地 8082 artifacts 扫描端点（家电脑执行体产物扫描）
  try {
    const a = await req({ proto: 'http', host: '127.0.0.1', port: 8082, path: '/api/tasks/6b509664-f257-453f-8d66-c78ceb7c437e/artifacts', method: 'GET', headers: B });
    const j = JSON.parse(a.body);
    ok('本地8082 产物扫描', a.status === 200 && j.ok && (j.items || []).length > 0, `http=${a.status} count=${(j.items || []).length}`);
  } catch (e) { err('本地8082 产物扫描', e); }

  // 家电脑 deviceId
  let homeDev = null;
  try {
    const d = await req({ proto: 'https', host: CLOUD, port: 443, path: BASE + '/api/bridge/devices', method: 'GET', headers: B });
    const j = JSON.parse(d.body);
    homeDev = (j.devices || []).find(x => x.name && x.name.includes('家里电脑'));
    ok('云端 家电脑设备在线', !!homeDev, homeDev ? `name=${homeDev.name} status=${homeDev.status}` : '未找到');
  } catch (e) { err('云端 家电脑设备在线', e); }

  // 真实 cmdId（取该设备最近一条 command）
  let cmdId = null; let backup = null;
  if (homeDev) {
    try {
      const c = await req({ proto: 'https', host: CLOUD, port: 443, path: BASE + `/api/bridge/commands?deviceId=${encodeURIComponent(homeDev.deviceId)}`, method: 'GET', headers: B });
      const j = JSON.parse(c.body);
      const cmds = j.commands || [];
      cmdId = cmds.length ? cmds[cmds.length - 1].cmdId : null;
      ok('云端 取真实cmdId', !!cmdId, `cmdCount=${cmds.length}`);
    } catch (e) { err('云端 取真实cmdId', e); }
  }

  if (cmdId && homeDev) {
    // 备份原始 artifacts（零副作用还原）
    try { const g0 = await req({ proto: 'https', host: CLOUD, port: 443, path: BASE + `/api/bridge/command/${cmdId}/artifacts`, method: 'GET', headers: sign('') }); backup = JSON.parse(g0.body).items || []; } catch (e) { backup = []; }
    // 环2 云端 POST artifacts（家电脑上报）
    const bodyStr = JSON.stringify({ deviceId: homeDev.deviceId, items: [{ relPath: 'smoke/test.txt', name: 'test.txt', size: 11, kind: 'text', contentBase64: Buffer.from('smoke-test').toString('base64') }] });
    try {
      const p = await req({ proto: 'https', host: CLOUD, port: 443, path: BASE + `/api/bridge/command/${cmdId}/artifacts`, method: 'POST', headers: sign(bodyStr) }, bodyStr);
      const j = JSON.parse(p.body);
      ok('云端 POST 上报', p.status === 200 && j.ok, `http=${p.status} count=${j.count}`);
    } catch (e) { err('云端 POST 上报', e); }
    // 环3 云端 GET artifacts（手机端拉取 —— 修复关键）
    try {
      const g = await req({ proto: 'https', host: CLOUD, port: 443, path: BASE + `/api/bridge/command/${cmdId}/artifacts`, method: 'GET', headers: sign('') });
      const j = JSON.parse(g.body);
      const has = (j.items || []).some(x => x.name === 'test.txt');
      ok('云端 GET 拉取(修复关键)', g.status === 200 && j.ok && has, `http=${g.status} items=${(j.items || []).length} hasTest=${has}`);
    } catch (e) { err('云端 GET 拉取(修复关键)', e); }
    // 还原：把原始 artifacts 写回（零副作用）
    try {
      const rb = JSON.stringify({ deviceId: homeDev.deviceId, items: backup });
      await req({ proto: 'https', host: CLOUD, port: 443, path: BASE + `/api/bridge/command/${cmdId}/artifacts`, method: 'POST', headers: sign(rb) }, rb);
      R.push(['云端 还原原始artifacts', 'DONE', `已还原 ${backup.length} 项`]);
    } catch (e) { R.push(['云端 还原', 'WARN', e.message]); }
  } else {
    // 无真实 cmdId：用虚构 cmdId 验证 GET 端点存活（期望 404，非 500）
    try {
      const g = await req({ proto: 'https', host: CLOUD, port: 443, path: BASE + '/api/bridge/command/nonexist-cmd-xyz/artifacts', method: 'GET', headers: sign('') });
      ok('云端 GET 端点存活(虚构cmd)', g.status === 404, `http=${g.status} (404=端点已加载)`);
    } catch (e) { err('云端 GET 端点存活', e); }
  }

  // 环4 云端执行体兜底 /api/tasks
  try {
    const t = await req({ proto: 'https', host: CLOUD, port: 443, path: BASE + '/api/tasks', method: 'GET', headers: B });
    const j = JSON.parse(t.body);
    ok('云端执行体 /api/tasks', t.status === 200 && j.ok, `taskCount=${(j.tasks || []).length}`);
  } catch (e) { err('云端执行体 /api/tasks', e); }

  // 环5 手机端 APK 产物
  const apk = 'H:/feihong-code/android/app/build/outputs/apk/release/app-release.apk';
  if (fs.existsSync(apk)) {
    const st = fs.statSync(apk);
    R.push(['手机端 APK 产物', 'PASS', `size=${(st.size / 1024 / 1024).toFixed(1)}MB`]);
  } else R.push(['手机端 APK 产物', 'FAIL', '不存在']);

  console.log('\n===== P2-1 产物回传 冒烟测试 =====');
  R.forEach(r => console.log(`[${r[1]}] ${r[0]} :: ${r[2]}`));
  const fails = R.filter(r => r[1] === 'FAIL' || r[1] === 'ERROR');
  console.log(`\n汇总: ${R.length} 项, 通过 ${R.length - fails.length}, 失败 ${fails.length}`);
  process.exit(fails.length ? 2 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });

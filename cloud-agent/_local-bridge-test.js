// 本地电脑端 bridge 新指令能力验证：手机模拟 → 云端 → 本地电脑执行 → 回传
const https = require('https');
const crypto = require('crypto');
const TOKEN = '25dacff5349f22fe4354f8ab34d6beaf9390e119b55fe1ad';
const BASE = 'https://api.klai.top/fhcode';
const DEVICE = 'pc-mtx94tmu-fwqja0';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };
    let payload = null;
    if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Length'] = Buffer.byteLength(payload); }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const bodyRaw = body !== undefined ? payload : '{}';
      const ts = String(Date.now());
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      headers['x-fh-ts'] = ts; headers['x-fh-nonce'] = nonce;
      headers['x-fh-sig'] = crypto.createHmac('sha256', TOKEN).update(`${ts}|${nonce}|${bodyRaw}`).digest('hex');
    }
    const r = https.request(u, { method, headers }, (x) => {
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch {} resolve({ status: x.statusCode, data: j }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function sendAndWait(label, text) {
  console.log(`\n=== ${label} ===`);
  let d = await req('POST', '/api/bridge/command', { deviceId: DEVICE, text });
  if (!d.data.ok) { console.log('下发失败:', JSON.stringify(d.data)); return; }
  const cmdId = d.data.cmdId;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    d = await req('GET', '/api/bridge/command/' + cmdId);
    const c = d.data.command;
    if (c && ['done', 'failed'].includes(c.status)) {
      console.log('状态:', c.status);
      console.log('结果:', JSON.stringify(c.result || c.error, null, 2));
      return;
    }
  }
  console.log('超时');
}

(async () => {
  await sendAndWait('创建文件（本地执行）', '创建文件 本地验证.md 内容 来自本地电脑端执行');
  await sendAndWait('系统状态（本地执行）', '系统状态');
  await sendAndWait('执行命令（本地执行）', '执行命令 echo local-bridge-ok && hostname');
  await sendAndWait('危险拦截', '执行命令 rm -rf /');
})();

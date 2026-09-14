// 端到端验证 v2：公网 → 腾讯云 fhcode → 云端执行体（服务器上真实执行）→ 回传
const https = require('https');
const crypto = require('crypto');
const TOKEN = '25dacff5349f22fe4354f8ab34d6beaf9390e119b55fe1ad';
const BASE = 'https://api.klai.top/fhcode';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN };
    let payload = null;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const bodyRaw = body !== undefined ? payload : '{}';
      const ts = String(Date.now());
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      headers['x-fh-ts'] = ts;
      headers['x-fh-nonce'] = nonce;
      headers['x-fh-sig'] = crypto.createHmac('sha256', TOKEN).update(`${ts}|${nonce}|${bodyRaw}`).digest('hex');
    }
    const r = https.request(u, { method, headers }, (x) => {
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => {
        let j = {};
        try { j = JSON.parse(d); } catch {}
        resolve({ status: x.statusCode, data: j });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function sendAndWait(label, text) {
  console.log(`\n=== ${label} ===`);
  let d = await req('POST', '/api/bridge/command', { deviceId: 'pc-cloud-agent-01', text });
  if (!d.data.ok) { console.log('下发失败:', d.status, JSON.stringify(d.data)); return; }
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
  console.log('超时未完成');
}

(async () => {
  // 1) 设备列表
  let d = await req('GET', '/api/bridge/devices');
  console.log('设备:', d.data.devices?.map((x) => `${x.deviceId}(${x.status})`).join(', '));

  // 2) 创建文件（云端执行）
  await sendAndWait('创建文件', '创建文件 部署验证.md 内容 # fhcode 云电脑路线A部署成功');

  // 3) 系统状态（云端执行）
  await sendAndWait('系统状态', '系统状态');

  // 4) 网页抓取（云端执行）
  await sendAndWait('抓取网页', '抓取网页 https://www.baidu.com');

  // 5) 命令执行
  await sendAndWait('命令执行', '执行命令 echo deployed-by-cloud-agent && hostname');

  // 6) 危险指令应被拒绝
  await sendAndWait('危险指令拦截', '执行命令 rm -rf /');
})();

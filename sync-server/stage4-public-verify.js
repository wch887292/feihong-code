/**
 * 阶段四公网端到端验证：https://sync.klai.top（DNS 未生效前用 SNI+IP 直连）
 * 用法：FHCODE_SYNC_TOKEN=<token> node stage4-public-verify.js
 */
const https = require('https');

const HOST = 'sync.klai.top';
const IP = '111.229.190.132';
const TOKEN = process.env.FHCODE_SYNC_TOKEN || '';
const RUN_ID = 'stage4-public-001';

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request(
      {
        host: IP,
        port: 443,
        path,
        method,
        servername: HOST,
        headers: Object.assign(
          { Host: HOST },
          data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
          TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}
        ),
        timeout: 15000,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(buf); } catch { return buf; } })() }));
      }
    );
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // 1. HTTPS 证书与域名匹配（SNI 验证即证书校验）
  try {
    const r1 = await req('GET', '/health');
    report('HTTPS + 证书 + health', r1.status === 200 && r1.json && r1.json.ok === true, 'status=' + r1.status);
  } catch (e) { report('HTTPS + 证书 + health', false, e.message); }

  // 2. 无 token 401
  try {
    const saved = TOKEN;
    process.env.FHCODE_SYNC_TOKEN = '';
    const r2 = await new Promise((resolve, reject) => {
      const rr = https.request({ host: IP, port: 443, path: '/api/sessions', method: 'GET', servername: HOST, headers: { Host: HOST }, timeout: 10000 }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      rr.on('error', reject); rr.end();
    });
    process.env.FHCODE_SYNC_TOKEN = saved;
    report('无 token 被 401 拦截（经 nginx 反代）', r2 === 401, 'status=' + r2);
  } catch (e) { report('无 token 被 401 拦截（经 nginx 反代）', false, e.message); }

  // 3. 建会话快照
  const r3 = await req('POST', '/api/sessions', { runId: RUN_ID, goal: '阶段四公网验证', status: 'done', messages: [{ role: 'user', content: '公网链路验证' }] });
  report('公网建会话快照', r3.status === 200 || r3.status === 201, 'status=' + r3.status);

  // 4. 下发 goal（done 会话自动置 queued = 手机续聊场景）
  const r4 = await req('POST', `/api/sessions/${RUN_ID}/goals`, { goal: '公网下发验证：请回复同步链路OK' });
  report('公网下发 goal', r4.status === 200 || r4.status === 201, 'status=' + r4.status + ' body=' + JSON.stringify(r4.json).slice(0, 120));

  // 5. 列表确认 queued
  const r5 = await req('GET', '/api/sessions');
  const s5 = (r5.json && r5.json.sessions ? r5.json.sessions : []).find((s) => s.runId === RUN_ID);
  report('列表确认自动置 queued', !!s5 && s5.status === 'queued', 'status=' + (s5 ? s5.status : 'missing'));

  // 6. claim（本机 poller 拉取路径）
  const r6 = await req('POST', `/api/sessions/${RUN_ID}/claim`, {});
  report('claim 拉取远程任务', r6.status === 200, 'status=' + r6.status);

  // 7. 静态页 /m/sync.html 经反代可访问
  const r7 = await req('GET', '/m/sync.html');
  const html = typeof r7.json === 'string' ? r7.json : '';
  report('App 同步页 /m/sync.html 可访问', r7.status === 200 && html.includes('sync') , 'status=' + r7.status + ' len=' + html.length);

  // 8. 默认路由 /m/ 跳转
  const r8 = await new Promise((resolve, reject) => {
    const rr = https.request({ host: IP, port: 443, path: '/m/', method: 'GET', servername: HOST, headers: { Host: HOST }, timeout: 10000 }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, loc: res.headers.location || '' })); });
    rr.on('error', reject); rr.end();
  });
  report('/m/ 默认路由跳转同步页', r8.status === 301 || r8.status === 302 || r8.status === 200, 'status=' + r8.status + ' loc=' + r8.loc);

  // 汇总
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== ${pass}/${results.length} PASS ====`);
  process.exit(pass === results.length ? 0 : 1);
})();

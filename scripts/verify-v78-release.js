/**
 * 一次性验证脚本（2026-10-25 v78 发布前闭环）：
 * 从 web-token.json 直读令牌，不经过人手，杜绝令牌串扰。
 * 验证：sync 三连（health/鉴权/CORS 预检）+ fhrelay 正/负对照。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const t = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.feihong-code', 'web-token.json'), 'utf8'));
const SYNC = t.token;
const BRIDGE = t.bridgeToken;

function curl(url, opts) {
  const parts = ['curl -s -m 12'];
  if (opts.method) parts.push('-X ' + opts.method);
  for (const h of opts.headers || []) parts.push('-H ' + JSON.stringify(h));
  if (opts.data) parts.push('--data ' + JSON.stringify(opts.data));
  if (opts.wantBody) parts.push('-w \\n%{http_code}');
  else parts.push('-o /dev/null -w %{http_code}');
  parts.push(JSON.stringify(url));
  try {
    return execSync(parts.join(' '), { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return 'ERR ' + (e.status || e.message);
  }
}

console.log('== sync.klai.top ==');
console.log('health            :', curl('https://sync.klai.top/health', { wantBody: true }).slice(-200));
console.log('GET sessions 正令牌 :', curl('https://sync.klai.top/api/sessions', { headers: ['Authorization: Bearer ' + SYNC, 'Origin: https://localhost'] }));
console.log('GET sessions 无令牌 :', curl('https://sync.klai.top/api/sessions', { headers: ['Origin: https://localhost'] }));
console.log('OPTIONS 预检       :', curl('https://sync.klai.top/api/sessions', { method: 'OPTIONS', headers: ['Origin: https://localhost', 'Access-Control-Request-Method: POST', 'Access-Control-Request-Headers: authorization,content-type'] }));

console.log('== api.klai.top/fhrelay（桥接） ==');
console.log('devices 正令牌      :', curl('https://api.klai.top/fhrelay/api/bridge/devices', { headers: ['Authorization: Bearer ' + BRIDGE] }));
console.log('devices 无令牌      :', curl('https://api.klai.top/fhrelay/api/bridge/devices', {}));
console.log('devices 乱序令牌    :', curl('https://api.klai.top/fhrelay/api/bridge/devices', { headers: ['Authorization: Bearer deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'] }));

console.log('== 快照上报演练（模拟手机端 syncChatSnapshot） ==');
const runId = 't_verify_' + Date.now().toString(36);
const body = JSON.stringify({
  runId,
  goal: '发布前闭环验证（自动消息，可删）',
  status: 'done',
  messages: [{ role: 'user', content: '连通性测试' }, { role: 'assistant', content: 'pong' }]
});
console.log('POST /api/sessions :', curl('https://sync.klai.top/api/sessions', {
  method: 'POST',
  headers: ['Authorization: Bearer ' + SYNC, 'Content-Type: application/json', 'Origin: https://localhost'],
  data: body,
  wantBody: true
}).slice(-200));
console.log('GET 回读该会话     :', curl('https://sync.klai.top/api/sessions/' + runId, { headers: ['Authorization: Bearer ' + SYNC], wantBody: true }).slice(-300));

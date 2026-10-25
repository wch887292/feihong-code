/**
 * 云执行位（云电脑）冒烟测试：自包含，随机端口起 server
 * 用法：node smoke-cloud.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const LOCAL_TOKEN = 't-local-smoke';
const CLOUD_TOKEN = 't-cloud-smoke';
const PORT = 18900 + Math.floor(Math.random() * 500);

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = httpRequest(
      {
        host: '127.0.0.1', port: PORT, path: p, method,
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          data ? { 'Content-Length': Buffer.byteLength(data) } : {},
          token ? { Authorization: 'Bearer ' + token } : {}
        ),
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const http = require('node:http');
function httpRequest(opts, cb) { return http.request(opts, cb); }

(async () => {
  // 启动 server（双 token）
  const server = spawn('node', [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, {
      FHCODE_SYNC_PORT: String(PORT),
      FHCODE_SYNC_HOST: '127.0.0.1',
      FHCODE_SYNC_TOKEN: LOCAL_TOKEN,
      FHCODE_CLOUD_EXEC_TOKEN: CLOUD_TOKEN,
    }),
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));

  const RUN_ID = 'smoke-cloud-' + Date.now().toString(36);

  try {
    // 建会话（done 状态，模拟已结束任务，续聊场景）
    const r0 = await req('POST', '/api/sessions', { runId: RUN_ID, goal: '云执行位冒烟', status: 'done', messages: [] }, LOCAL_TOKEN);
    report('0. 建会话快照（local token）', r0.status === 200, 'status=' + r0.status);

    // ① 无 token claim cloud goal → 401
    const r1 = await req('POST', `/api/sessions/${RUN_ID}/claim`, { executor: 'cloud' });
    report('1. 无 token 认领云端任务 → 401', r1.status === 401, 'status=' + r1.status);

    // ② local token claim cloud goal → 403（执行端隔离）
    // 先造一个 cloud goal
    await req('POST', `/api/sessions/${RUN_ID}/goals`, { goal: '云端任务A', executor: 'cloud' }, LOCAL_TOKEN);
    const r2 = await req('POST', `/api/sessions/${RUN_ID}/claim`, { executor: 'cloud' }, LOCAL_TOKEN);
    report('2. local token 认领云端任务 → 403（隔离生效）', r2.status === 403, 'status=' + r2.status);

    // ③ cloud-pending 能列出（cloud token）
    const r3 = await req('GET', '/api/sessions/cloud-pending', null, CLOUD_TOKEN);
    const ok3 = r3.status === 200 && r3.json && Array.isArray(r3.json.runIds) && r3.json.runIds.includes(RUN_ID);
    report('3. cloud-pending 列出待执行会话', ok3, 'status=' + r3.status + ' runIds=' + JSON.stringify(r3.json && r3.json.runIds));

    // ③b cloud-pending 用 local token → 403
    const r3b = await req('GET', '/api/sessions/cloud-pending', null, LOCAL_TOKEN);
    report('3b. local token 访问 cloud-pending → 403', r3b.status === 403, 'status=' + r3b.status);

    // ④ cloud token claim → goal running，pending 不再列出
    const r4 = await req('POST', `/api/sessions/${RUN_ID}/claim`, { executor: 'cloud' }, CLOUD_TOKEN);
    const ok4 = r4.status === 200 && r4.json && r4.json.goal && r4.json.goal.status === 'running' && r4.json.goal.executor === 'cloud';
    report('4. cloud token 认领成功 goal=running', ok4, 'status=' + r4.status);
    const r4b = await req('GET', '/api/sessions/cloud-pending', null, CLOUD_TOKEN);
    const ok4b = r4b.json && !r4b.json.runIds.includes(RUN_ID);
    report('4b. 认领后 cloud-pending 不再列出', ok4b, 'runIds=' + JSON.stringify(r4b.json && r4b.json.runIds));

    // ⑤ status done → goal 联动 done
    const r5 = await req('POST', `/api/sessions/${RUN_ID}/status`, { status: 'done' }, CLOUD_TOKEN);
    report('5. 终态回传 done（cloud token）', r5.status === 200 && r5.json && r5.json.status === 'done', 'status=' + r5.status);
    const r5b = await req('GET', `/api/sessions/${RUN_ID}`, null, LOCAL_TOKEN);
    const goalDone = r5b.json && r5b.json.session && (r5b.json.session.goals || []).every((g) => g.status === 'done');
    report('5b. goal 粒度联动 done', goalDone, JSON.stringify((r5b.json && r5b.json.session && r5b.json.session.goals || []).map((g) => g.status)));

    // ⑥ 向后兼容：不传 executor 的 goal，local token 照常认领
    await req('POST', `/api/sessions/${RUN_ID}/goals`, { goal: '本地任务B' }, LOCAL_TOKEN);
    const r6 = await req('POST', `/api/sessions/${RUN_ID}/claim`, {}, LOCAL_TOKEN);
    const ok6 = r6.status === 200 && r6.json && r6.json.goal && r6.json.goal.status === 'running' && (r6.json.goal.executor || 'local') === 'local';
    report('6. 回归：默认 local 行为不变', ok6, 'status=' + r6.status + ' executor=' + (r6.json && r6.json.goal && r6.json.goal.executor));

    // ⑦ cloud goal 与 local goal 共存互不干扰
    await req('POST', `/api/sessions/${RUN_ID}/goals`, { goal: '云端任务C', executor: 'cloud' }, LOCAL_TOKEN);
    await req('POST', `/api/sessions/${RUN_ID}/goals`, { goal: '本地任务D' }, LOCAL_TOKEN);
    const r7a = await req('POST', `/api/sessions/${RUN_ID}/claim`, { executor: 'cloud' }, CLOUD_TOKEN);
    const r7b = await req('POST', `/api/sessions/${RUN_ID}/claim`, {}, LOCAL_TOKEN);
    const ok7 = r7a.json && r7a.json.goal && r7a.json.goal.goal === '云端任务C' && r7b.json && r7b.json.goal && r7b.json.goal.goal === '本地任务D';
    report('7. 双执行端队列互不串台', ok7, 'cloud=' + (r7a.json && r7a.json.goal && r7a.json.goal.goal) + ' local=' + (r7b.json && r7b.json.goal && r7b.json.goal.goal));
  } finally {
    server.kill();
  }

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== ${pass}/${results.length} PASS ====`);
  process.exit(pass === results.length ? 0 : 1);
})();

#!/usr/bin/env node
/**
 * 飞虹 Code 跨端同步 · Smoke 自包含运行器
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
 *
 * 内部启动 server.js（随机端口），等待就绪后跑完整 smoke 用例，最后清理进程。
 * 避免端口残留/环境变量不生效问题。
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const TOKEN = 'smoke-token';
const PORT = 8791 + Math.floor(Math.random() * 50);
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0;
let fail = 0;
const results = [];

function assert(name, cond, detail) {
  if (cond) { pass++; results.push('PASS ' + name); console.log('PASS ' + name); }
  else { fail++; results.push('FAIL ' + name + (detail ? ' | ' + detail : '')); console.log('FAIL ' + name + (detail ? ' | ' + detail : '')); }
}

async function call(method, p, body, tokenOverride) {
  const headers = { 'Content-Type': 'application/json' };
  // null=无token, undefined=默认TOKEN, 字符串=覆盖
  const tk = tokenOverride === null ? '' : (tokenOverride || TOKEN);
  headers['Authorization'] = 'Bearer ' + tk;
  const res = await fetch(BASE + p, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function waitReady(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  // 启动 server
  const server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, FHCODE_SYNC_TOKEN: TOKEN, FHCODE_SYNC_PORT: String(PORT), FHCODE_SYNC_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => console.log('[server] ' + d.toString().trim()));
  server.stderr.on('data', d => console.log('[server-err] ' + d.toString().trim()));

  try {
    const ready = await waitReady();
    if (!ready) { console.log('FAIL server 未就绪'); process.exit(1); }
    console.log('server 已就绪: ' + BASE);

    const runId = 'smoke_' + Date.now().toString(36);

    // 1. 无 token -> 401
    let r = await call('GET', '/api/sessions', undefined, null);
    assert('无 token 访问 GET /api/sessions 返回 401', r.status === 401, '实际: ' + r.status);
    r = await call('POST', '/api/sessions', { runId }, null);
    assert('无 token 访问 POST /api/sessions 返回 401', r.status === 401, '实际: ' + r.status);

    // 2. 保存快照
    r = await call('POST', '/api/sessions', { runId, goal: 'smoke 测试任务', status: 'running', messages: [{role:'user',content:'你好'},{role:'assistant',content:'收到'}] });
    assert('POST /api/sessions 保存快照返回 200', r.status === 200 && r.data && r.data.ok === true, '实际: ' + r.status + ' ' + JSON.stringify(r.data));

    // 3. 列表摘要
    r = await call('GET', '/api/sessions');
    const found = r.data && r.data.sessions && r.data.sessions.find(s => s.runId === runId);
    assert('GET /api/sessions 列表含新会话', r.status === 200 && !!found, '实际: ' + r.status);
    assert('列表摘要字段正确', !!found && found.status === 'running' && found.messageCount === 2, JSON.stringify(found));

    // 4. 完整会话
    r = await call('GET', '/api/sessions/' + runId);
    assert('GET /api/sessions/:runId 返回完整会话', r.status === 200 && r.data && r.data.session && r.data.session.messages.length === 2, '实际: ' + r.status);

    // 5. 不存在 -> 404
    r = await call('GET', '/api/sessions/no_such_run');
    assert('GET 不存在的会话返回 404', r.status === 404, '实际: ' + r.status);

    // 6. 下发 goal
    r = await call('POST', '/api/sessions/' + runId + '/goals', { goal: '远程下发任务 A' });
    assert('POST goals 下发返回 200 且 status=queued', r.status === 200 && r.data && r.data.ok && r.data.goal.status === 'queued', '实际: ' + JSON.stringify(r.data));
    r = await call('POST', '/api/sessions/' + runId + '/goals', { goal: '远程下发任务 B' });
    assert('连续下发第二个 goal 成功', r.status === 200 && r.data.ok, '实际: ' + JSON.stringify(r.data));

    // 7. claim
    r = await call('POST', '/api/sessions/' + runId + '/claim');
    assert('POST claim 拉取 queued goal 成功且 status=running', r.status === 200 && r.data && r.data.ok && r.data.goal.status === 'running', '实际: ' + JSON.stringify(r.data));
    r = await call('POST', '/api/sessions/' + runId + '/claim');
    assert('第二次 claim 拉取第二个 queued goal', r.status === 200 && r.data && r.data.ok && r.data.goal.status === 'running' && r.data.goal.goal === '远程下发任务 B', '实际: ' + JSON.stringify(r.data));
    r = await call('POST', '/api/sessions/' + runId + '/claim');
    assert('队列空时 claim 返回 404', r.status === 404, '实际: ' + r.status);

    // 8. 状态更新
    r = await call('POST', '/api/sessions/' + runId + '/status', { status: 'paused' });
    assert('POST status 更新为 paused 成功', r.status === 200 && r.data && r.data.status === 'paused', '实际: ' + JSON.stringify(r.data));
    r = await call('POST', '/api/sessions/' + runId + '/status', { status: 'done' });
    assert('POST status 更新为 done 成功', r.status === 200 && r.data.status === 'done', '实际: ' + JSON.stringify(r.data));
    r = await call('POST', '/api/sessions/' + runId + '/status', { status: 'bad_status' });
    assert('非法 status 返回 400', r.status === 400, '实际: ' + r.status);

    // 9. 完整会话含 goals
    r = await call('GET', '/api/sessions/' + runId);
    const s = r.data && r.data.session;
    assert('完整会话含 2 个 goal 且均已 running', !!s && s.goals.length === 2 && s.goals.every(g => g.status === 'running'), JSON.stringify(s && s.goals));

    // 10. 错误 token
    r = await call('GET', '/api/sessions', undefined, 'wrong-token');
    assert('错误 token 返回 401', r.status === 401, '实际: ' + r.status);

    console.log('=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
  } finally {
    server.kill('SIGTERM');
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('runner 异常: ' + (e && e.message || e)); process.exit(2); });

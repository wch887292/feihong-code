#!/usr/bin/env node
/**
 * 飞虹 Code 跨端同步 · 阶段三验证脚本（移动端同步页 + 静态托管）
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
 */
'use strict';
const BASE = process.env.FHCODE_SYNC_URL || 'http://127.0.0.1:8792';
const TOKEN = process.env.FHCODE_SYNC_TOKEN || 'smoke-e2e-token';

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : ''));
}

async function api(method, path, body, withToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (withToken !== false) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let json = null, text = '';
  try { text = await res.text(); json = JSON.parse(text); } catch { /* 非JSON */ }
  return { status: res.status, json, text };
}

(async () => {
  // 1. 静态托管：同步任务页
  const r1 = await api('GET', '/m/sync.html');
  report('GET /m/sync.html 返回 200 且含「同步任务」', r1.status === 200 && r1.text.includes('同步任务'), 'status=' + r1.status);

  // 2. 静态托管：JS 与 CSS
  const r2 = await api('GET', '/m/js/sync-task.js');
  report('GET /m/js/sync-task.js 返回 200', r2.status === 200, 'status=' + r2.status);
  const r2b = await api('GET', '/m/css/sync.css');
  report('GET /m/css/sync.css 返回 200', r2b.status === 200, 'status=' + r2b.status);

  // 3. 根路径默认进同步任务页
  const r3 = await api('GET', '/m/');
  report('GET /m/ 进入同步任务页', r3.status === 200 && r3.text.includes('同步任务'), 'status=' + r3.status);

  // 4. 路径穿越防护
  const r4 = await api('GET', '/m/..%2f..%2fsync-server%2fserver.js');
  report('路径穿越请求被拦截（403/404/400）', [400, 403, 404].includes(r4.status), 'status=' + r4.status);

  // 5. API 链路回归：建会话 + 下发 goal + 列表
  const RUN = 'st3-' + Date.now().toString(36);
  const r5 = await api('POST', '/api/sessions', { runId: RUN, goal: '阶段三验证', status: 'queued', messages: [] });
  report('POST /api/sessions 建会话 200', r5.status === 200 && r5.json.ok === true);
  const r6 = await api('POST', '/api/sessions/' + RUN + '/goals', { goal: '验证移动端下发的任务' });
  report('POST goals 下发 200 且 queued', r6.status === 200 && r6.json.goal && r6.json.goal.status === 'queued');
  const r7 = await api('GET', '/api/sessions');
  report('GET /api/sessions 列表含新会话', r7.status === 200 && (r7.json.sessions || []).some((s) => s.runId === RUN));

  // 汇总
  const pass = results.filter((r) => r.pass).length;
  console.log('=== 阶段三结果: ' + pass + ' 通过, ' + (results.length - pass) + ' 失败 ===');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('验证异常:', e.message); process.exit(1); });

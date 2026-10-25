#!/usr/bin/env node
/**
 * 飞虹 Code 跨端同步 · 阶段二端到端验证脚本
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
 *
 * 验证链路：401 拦截 → 建快照 → 下发 goal → 会话自动 queued →
 *           poller 认领执行（mock 执行器）→ 状态 done
 */
'use strict';
const BASE = process.env.FHCODE_SYNC_URL || 'http://127.0.0.1:8791';
const TOKEN = process.env.FHCODE_SYNC_TOKEN || 'smoke-e2e-token';
const RUN_ID = 'e2e-run-' + Date.now().toString(36);

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail: detail || '' });
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' | ' + detail : ''));
}

async function api(method, path, body, withToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (withToken !== false) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

(async () => {
  // 1. 无 token 401
  const r1 = await api('GET', '/api/sessions', null, false);
  report('无 token 访问返回 401', r1.status === 401, 'status=' + r1.status);

  // 2. 建会话快照
  const r2 = await api('POST', '/api/sessions', { runId: RUN_ID, goal: '端到端验证任务', status: 'running', messages: [{ role: 'user', content: '验证' }] });
  report('保存会话快照返回 200', r2.status === 200 && r2.json.ok === true, 'runId=' + RUN_ID);

  // 3. 远程下发 goal
  const r3 = await api('POST', '/api/sessions/' + RUN_ID + '/goals', { goal: '请直接回复一句话：跨端同步链路验证成功' });
  report('下发 goal 返回 200 且 goal 状态 queued', r3.status === 200 && r3.json.goal && r3.json.goal.status === 'queued');

  // 4. 非 running 会话（done 状态，模拟手机续聊场景）下发 goal 后自动置 queued
  const RUNQ = 'e2e-queue-' + Date.now().toString(36);
  await api('POST', '/api/sessions', { runId: RUNQ, goal: '已完成的历史任务', status: 'done', messages: [] });
  await api('POST', '/api/sessions/' + RUNQ + '/goals', { goal: '追加的新任务' });
  const r4 = await api('GET', '/api/sessions');
  const s4 = (r4.json.sessions || []).find((s) => s.runId === RUNQ);
  report('done 会话下发 goal 后自动置 queued', !!s4 && s4.status === 'queued', 'status=' + (s4 ? s4.status : 'missing'));
  // 运行中会话收到 goal 不打断当前执行（保持 running）
  const sRun = (r4.json.sessions || []).find((s) => s.runId === RUN_ID);
  report('running 会话下发 goal 后保持 running', !!sRun && sRun.status === 'running', 'status=' + (sRun ? sRun.status : 'missing'));

  // 5. claim 认领
  const r5 = await api('POST', '/api/sessions/' + RUN_ID + '/claim');
  report('claim 拉取 queued goal 成功', r5.status === 200 && !!r5.json.goal, 'goalId=' + (r5.json.goal ? r5.json.goal.id : '-'));

  // 6. 重复 claim 返回 404（队列已空）
  const r6 = await api('POST', '/api/sessions/' + RUN_ID + '/claim');
  report('队列空时重复 claim 返回 404', r6.status === 404, 'status=' + r6.status);

  // 7. 置 running
  const r7 = await api('POST', '/api/sessions/' + RUN_ID + '/status', { status: 'running' });
  report('更新状态为 running', r7.status === 200 && r7.json.status === 'running');

  // 8. poller 全链路（mock 执行器）：建第二个会话并下发 goal，由 dist 里的 poller 认领执行
  const RUN2 = 'e2e-poll-' + Date.now().toString(36);
  await api('POST', '/api/sessions', { runId: RUN2, goal: 'poller 链路验证', status: 'done', messages: [] });
  await api('POST', '/api/sessions/' + RUN2 + '/goals', { goal: 'mock 任务：无需真实执行' });
  const poller = require('H:/feihong-code/dist/features/sync-client/poller.js');
  let executedGoal = null;
  const executed = await poller.claimAndExecute(BASE, TOKEN, async (goal, runId) => { executedGoal = { goal, runId }; });
  report('poller.claimAndExecute 全链路执行成功', executed === true && executedGoal !== null,
    executedGoal ? 'runId=' + executedGoal.runId : 'not executed');

  // 9. 执行后会话状态应为 done
  const r9 = await api('GET', '/api/sessions/' + RUN2);
  report('poller 执行完后会话状态为 done', r9.status === 200 && r9.json.session && r9.json.session.status === 'done',
    'status=' + (r9.json.session ? r9.json.session.status : 'missing'));

  // 汇总
  const pass = results.filter((r) => r.pass).length;
  console.log('=== 端到端结果: ' + pass + ' 通过, ' + (results.length - pass) + ' 失败 ===');
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('E2E 异常:', e.message); process.exit(1); });

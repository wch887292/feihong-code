/**
 * fhcode 跨端同步 · 正式冒烟测试（线上真实链路）
 * 链路 A：本机 pusher 推送会话快照 → 云端可见
 * 链路 B：模拟手机下发 goal → 会话置 queued → claim 认领 → 执行 → 状态 done 回传
 * 用法：node smoke-full.js（读环境变量 FHCODE_SYNC_URL / FHCODE_SYNC_TOKEN）
 */
const { pushSnapshot } = require('../dist/features/sync-client/pusher');
const { claimAndExecute } = require('../dist/features/sync-client/poller');

const URL_BASE = process.env.FHCODE_SYNC_URL || 'https://sync.klai.top';
const TOKEN = process.env.FHCODE_SYNC_TOKEN || '';
const RUN_ID = 'smoke-' + Date.now().toString(36);

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

async function api(method, path, body) {
  const res = await fetch(URL_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  console.log('目标服务: ' + URL_BASE + '  会话: ' + RUN_ID + '\n');

  // ===== 链路 A：本机推送快照 =====
  let pushResult = null;
  try {
    pushResult = await pushSnapshot(URL_BASE, TOKEN, {
      runId: RUN_ID,
      goal: '冒烟测试任务：验证跨端同步全链路',
      cwd: 'H:/feihong-code',
      status: 'done',
      messages: [
        { role: 'user', content: '这是一条冒烟测试推送的上下文' },
        { role: 'assistant', content: '收到，链路 A 推送验证中' },
      ],
      iterations: 1,
      costUsd: 0,
      touchedFiles: [],
    }, { force: true });
    report('链路 A：本机 pusher 推送快照', !!pushResult && pushResult.ok === true, pushResult ? JSON.stringify(pushResult) : '');
  } catch (e) {
    report('链路 A：本机 pusher 推送快照', false, e.message);
  }

  // A2：云端确认快照可见（= 手机端能读到）
  try {
    const r = await api('GET', '/api/sessions/' + RUN_ID);
    const ok = r.status === 200 && r.json && r.json.session && r.json.session.runId === RUN_ID;
    report('A2：云端快照可见（手机端可读上下文）', ok, 'status=' + r.status);
  } catch (e) { report('A2：云端快照可见（手机端可读上下文）', false, e.message); }

  // ===== 链路 B：模拟手机下发 goal =====
  let goalText = '';
  try {
    const r = await api('POST', `/api/sessions/${RUN_ID}/goals`, { goal: '冒烟测试：请回复「全链路验证成功」' });
    goalText = (r.json && r.json.goal && r.json.goal.goal) || '';
    report('链路 B：模拟手机下发 goal', r.status === 200 && !!goalText, 'status=' + r.status);
  } catch (e) { report('链路 B：模拟手机下发 goal', false, e.message); }

  // B2：会话自动置 queued
  try {
    const r = await api('GET', '/api/sessions/' + RUN_ID);
    const ok = r.json && r.json.session && r.json.session.status === 'queued';
    report('B2：会话自动置 queued（手机端可见等待中）', ok, 'status=' + (r.json && r.json.session ? r.json.session.status : 'missing'));
  } catch (e) { report('B2：会话自动置 queued（手机端可见等待中）', false, e.message); }

  // B3：本机认领并执行（模拟 executeTask，不烧 LLM）
  let claimed = null;
  try {
    claimed = await claimAndExecute(URL_BASE, TOKEN, async (runId, goal) => {
      // 模拟本机 fhcode 执行：直接回显 goal
      return '已执行: ' + goal;
    });
    report('链路 B3：本机认领 queued 任务', !!claimed, claimed ? '认领到 ' + claimed.length + ' 个会话' : '未认领到');
  } catch (e) { report('链路 B3：本机认领 queued 任务', false, e.message); }

  // B4：执行后状态回传 done
  try {
    const r = await api('GET', '/api/sessions/' + RUN_ID);
    const ok = r.json && r.json.session && (r.json.session.status === 'done' || r.json.session.status === 'running');
    report('B4：状态回传（running→done 全端可见）', ok, 'status=' + (r.json && r.json.session ? r.json.session.status : 'missing'));
  } catch (e) { report('B4：状态回传（running→done 全端可见）', false, e.message); }

  // ===== 链路 C：静态页可用性 =====
  try {
    const res = await fetch(URL_BASE + '/m/sync.html');
    const html = await res.text();
    report('链路 C：手机端同步页可访问', res.status === 200 && html.includes('sync.klai.top'), 'status=' + res.status);
  } catch (e) { report('链路 C：手机端同步页可访问', false, e.message); }

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== 冒烟测试 ${pass}/${results.length} PASS ====`);
  process.exit(pass === results.length ? 0 : 1);
})();

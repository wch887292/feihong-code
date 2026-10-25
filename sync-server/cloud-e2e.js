/** 云电脑端到端：公网下发 executor='cloud' 任务 → 云端执行器自动跑 → 轮询终态 */
const URL_BASE = 'https://sync.klai.top';
const TOKEN = process.env.FHCODE_SYNC_TOKEN;
const RUN_ID = 'cloud-e2e-' + Date.now().toString(36);

function api(method, p, body) {
  return fetch(URL_BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
}

(async () => {
  await api('POST', '/api/sessions', { runId: RUN_ID, goal: '云电脑端到端验证', status: 'done', messages: [] });
  const r = await api('POST', `/api/sessions/${RUN_ID}/goals`, {
    goal: '这是一次云电脑端到端验证。请直接回复「云端执行验证成功」七个字，不要调用任何工具，不要读写任何文件。',
    executor: 'cloud',
  });
  console.log('下发云端任务:', r.status, r.json && r.json.goal && r.json.goal.executor);

  // 轮询终态（最长 4 分钟）
  const deadline = Date.now() + 240000;
  let last = '';
  while (Date.now() < deadline) {
    await new Promise((s) => setTimeout(s, 5000));
    const d = await api('GET', `/api/sessions/${RUN_ID}`);
    const s = d.json && d.json.session;
    if (!s) continue;
    if (s.status !== last) {
      console.log('会话状态:', s.status);
      last = s.status;
    }
    if (s.status === 'done' || s.status === 'failed') {
      console.log('goal 终态:', (s.goals || []).map((g) => g.status).join(','));
      console.log(s.status === 'done' ? 'E2E_PASS' : 'E2E_FAIL');
      process.exit(s.status === 'done' ? 0 : 1);
    }
  }
  console.log('E2E_TIMEOUT 最后状态=' + last);
  process.exit(2);
})();

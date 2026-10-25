const URL_BASE = 'https://sync.klai.top';
const TOKEN = process.env.FHCODE_SYNC_TOKEN;
(async () => {
  const res = await fetch(URL_BASE + '/api/sessions/smoke-cli-mvno13wi', {
    headers: { Authorization: 'Bearer ' + TOKEN },
  });
  const d = await res.json();
  const s = d.session || {};
  console.log('会话状态:', s.status);
  console.log('goals:', JSON.stringify((s.goals || []).map((g) => ({ goal: (g.goal || '').slice(0, 20), status: g.status }))));
})();

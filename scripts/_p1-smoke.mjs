// P1 系列冒烟测试：P1-3 新路由 + P1-1 ghost text + P1-2 冲突 badge
const BASE = 'http://127.0.0.1:8099';
let pass = 0, fail = 0, fails = [];

function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

async function req(name, path, { method = 'GET', body, token, expect = 200, okCheck } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(BASE + path, opts);
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    report(name, r.status === expect && (okCheck ? okCheck(data) : true), `HTTP ${r.status}${data?.error ? ' error=' + data.error : ''}`);
  } catch (e) { report(name, false, 'network: ' + e.message); }
}

(async () => {
  const login = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'p1-test' })
  })).json();
  const token = login.token;

  console.log('===== P1-3 补齐的路由 =====');
  await req('GET /api/models/providers', '/api/models/providers', { token, okCheck: (d) => d.ok && Array.isArray(d.providers) && d.total !== undefined });
  await req('GET /api/event-driven/cron', '/api/event-driven/cron', { token, okCheck: (d) => d.ok && Array.isArray(d.cronTasks) });
  await req('GET /api/design-to-code', '/api/design-to-code', { token, okCheck: (d) => d.ok && d.configured !== undefined });

  console.log('\n===== P1-1 ghost text（前端资源）=====');
  try {
    const html = await (await fetch(BASE + '/')).text();
    report('index.html 含 memGhostBar', html.includes('memGhostBar'));
    const ui = await (await fetch(BASE + '/js/ui.js')).text();
    report('ui.js 含 bindGhostTextOnce', ui.includes('bindGhostTextOnce'));
    report('ui.js 含 requestGhost/acceptGhost', ui.includes('requestGhost') && ui.includes('acceptGhost'));
    const api = await (await fetch(BASE + '/js/api.js')).text();
    report('api.js 含 apiCompletion', api.includes('apiCompletion'));
  } catch (e) { report('前端资源可访问', false, e.message); }

  console.log('\n===== P1-2 冲突检测 UI（前端资源 + API）=====');
  await req('POST /api/changes/detect-conflicts', '/api/changes/detect-conflicts', { method: 'POST', token, okCheck: (d) => d.ok && Array.isArray(d.conflicts) });
  try {
    const html = await (await fetch(BASE + '/')).text();
    report('index.html 含 changesConflictCount badge', html.includes('changesConflictCount'));
    const ui = await (await fetch(BASE + '/js/ui.js')).text();
    report('ui.js 含自动冲突检测 _autoConflictChecked', ui.includes('_autoConflictChecked'));
    report('ui.js 含冲突高亮渲染', ui.includes('⚠️ 冲突'));
  } catch (e) { report('前端资源可访问', false, e.message); }

  console.log(`\n========== P1 冒烟结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过'); }
  process.exit(fail > 0 ? 1 : 0);
})();

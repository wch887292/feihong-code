// 飞虹 Code 运行时 API 全量实测（带认证）
const BASE = 'http://127.0.0.1:8099';

async function req(name, method, path, body, token) {
  const t0 = Date.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + path, opts);
    const text = await r.text();
    const ms = Date.now() - t0;
    let preview = text.length > 100 ? text.slice(0, 100) + '…' : text;
    preview = preview.replace(/\n/g, ' ');
    return { name, code: r.status, ms, preview };
  } catch (e) {
    return { name, code: 'ERR', ms: 0, preview: e.message.slice(0, 50) };
  }
}

(async () => {
  // 1. 登录拿 token
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: 'vscode-local' })
  });
  const loginData = await login.json();
  console.log('=== 登录 ===');
  console.log('  POST /api/auth/login  HTTP', login.status, JSON.stringify(loginData).slice(0, 120));
  const token = loginData.token;

  // 2. 全量测试
  const tests = [
    ['GET /api/models', 'GET', '/api/models'],
    ['GET /api/models/providers', 'GET', '/api/models/providers'],
    ['GET /api/multi-agent/roles', 'GET', '/api/multi-agent/roles'],
    ['POST /api/multi-agent/run', 'POST', '/api/multi-agent/run', { goal: '写一个 hello world' }],
    ['GET /api/custom-agents', 'GET', '/api/custom-agents'],
    ['GET /api/custom-agents/categories', 'GET', '/api/custom-agents/categories'],
    ['POST /api/custom-agents/match', 'POST', '/api/custom-agents/match', { text: '审查代码' }],
    ['GET /api/event-driven/config', 'GET', '/api/event-driven/config'],
    ['GET /api/event-driven/events', 'GET', '/api/event-driven/events'],
    ['GET /api/event-driven/cron', 'GET', '/api/event-driven/cron'],
    ['GET /api/mcp/tools', 'GET', '/api/mcp/tools'],
    ['GET /api/mcp/config', 'GET', '/api/mcp/config'],
    ['GET /api/changes', 'GET', '/api/changes'],
    ['POST /api/changes/detect-conflicts', 'POST', '/api/changes/detect-conflicts', {}],
    ['POST /api/completion', 'POST', '/api/completion', { filePath: 'test.ts', cursorOffset: 5, prefix: 'const x = ', suffix: '' }],
    ['POST /api/completion/accept', 'POST', '/api/completion/accept', { filePath: 'test.ts', cursorOffset: 1, text: 'x' }],
    ['POST /api/completion/suggest-next', 'POST', '/api/completion/suggest-next', {}],
    ['GET /api/team/stats', 'GET', '/api/team/stats'],
    ['GET /api/solo/list', 'GET', '/api/solo/list'],
    ['GET /api/workspace', 'GET', '/api/workspace'],
    ['GET /api/skills/market', 'GET', '/api/skills/market'],
    ['GET /api/templates', 'GET', '/api/templates'],
    ['GET /api/nodes', 'GET', '/api/nodes'],
    ['GET /api/office/capabilities', 'GET', '/api/office/capabilities'],
    ['GET /api/git/status', 'GET', '/api/git/status'],
    ['GET /api/memory/stats', 'GET', '/api/memory/stats'],
    ['GET /api/design-to-code', 'GET', '/api/design-to-code'],
    // 死代码模块（CHANGELOG 声称但可能未注册）
    ['POST /api/voice/parse', 'POST', '/api/voice/parse', { text: '打开文件' }],
    ['POST /api/voice/to-code', 'POST', '/api/voice/to-code', { text: '生成排序函数' }],
    ['GET /api/knowledge', 'GET', '/api/knowledge'],
    ['GET /api/knowledge/documents', 'GET', '/api/knowledge/documents'],
    ['POST /api/figma/convert', 'POST', '/api/figma/convert', {}],
    ['GET /api/sso/providers', 'GET', '/api/sso/providers'],
    ['GET /api/collaboration/config', 'GET', '/api/collaboration/config'],
    ['GET /api/plugins', 'GET', '/api/plugins'],
    ['GET /api/plugins/market', 'GET', '/api/plugins/market'],
    // 对照：确实不存在的路由
    ['GET /api/nonexistent-xyz', 'GET', '/api/nonexistent-xyz'],
  ];

  const results = [];
  for (const t of tests) {
    const r = await req(t[0], t[1], t[2], t[3], token);
    results.push(r);
  }
  console.log('\n===== 带认证全量实测 =====');
  for (const r of results) {
    console.log(`  ${String(r.name).padEnd(38)} HTTP ${String(r.code).padEnd(3)} ${String(r.ms).padStart(5)}ms  ${r.preview}`);
  }
})();

// 飞虹 Code 运行时 API 实测脚本
const BASE = 'http://localhost:8099';

async function test(name, method, path, body) {
  const t0 = Date.now();
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + path, opts);
    let text = await r.text();
    const ms = Date.now() - t0;
    let preview = text.length > 90 ? text.slice(0, 90) + '…' : text;
    preview = preview.replace(/\n/g, ' ');
    console.log(`  ${String(name).padEnd(38)} HTTP ${String(r.status).padEnd(3)} ${String(ms).padStart(5)}ms  ${preview}`);
    return r.status;
  } catch (e) {
    console.log(`  ${String(name).padEnd(38)} ERR  ${e.message.slice(0, 60)}`);
    return 'ERR';
  }
}

(async () => {
  console.log('===== 已接线 API 实测 =====');
  await test('GET /api/models', 'GET', '/api/models');
  await test('GET /api/multi-agent/roles', 'GET', '/api/multi-agent/roles');
  await test('GET /api/custom-agents', 'GET', '/api/custom-agents');
  await test('GET /api/custom-agents/categories', 'GET', '/api/custom-agents/categories');
  await test('GET /api/event-driven/config', 'GET', '/api/event-driven/config');
  await test('GET /api/event-driven/events', 'GET', '/api/event-driven/events');
  await test('GET /api/mcp/tools', 'GET', '/api/mcp/tools');
  await test('GET /api/mcp/config', 'GET', '/api/mcp/config');
  await test('GET /api/changes', 'GET', '/api/changes');
  await test('POST /api/changes/detect-conflicts', 'POST', '/api/changes/detect-conflicts', {});
  await test('POST /api/completion', 'POST', '/api/completion', { filePath: 'test.ts', cursorOffset: 5, prefix: 'const x = ', suffix: '' });
  await test('GET /api/memory/stats', 'GET', '/api/memory/stats');
  await test('GET /api/team/stats', 'GET', '/api/team/stats');
  await test('GET /api/solo/list', 'GET', '/api/solo/list');
  await test('GET /api/workspace', 'GET', '/api/workspace');
  await test('GET /api/skills/market', 'GET', '/api/skills/market');
  await test('GET /api/templates', 'GET', '/api/templates');
  await test('GET /api/automations', 'GET', '/api/automations');
  await test('GET /api/nodes', 'GET', '/api/nodes');
  await test('GET /api/office/capabilities', 'GET', '/api/office/capabilities');

  console.log('\n===== 死代码模块 API（CHANGELOG 声称）=====');
  await test('POST /api/voice/parse', 'POST', '/api/voice/parse', { text: '打开文件' });
  await test('POST /api/voice/to-code', 'POST', '/api/voice/to-code', { text: '生成排序函数' });
  await test('GET /api/knowledge', 'GET', '/api/knowledge');
  await test('GET /api/knowledge/documents', 'GET', '/api/knowledge/documents');
  await test('POST /api/figma/convert', 'POST', '/api/figma/convert', {});
  await test('GET /api/sso/providers', 'GET', '/api/sso/providers');
  await test('GET /api/collaboration/config', 'GET', '/api/collaboration/config');
  await test('GET /api/plugins', 'GET', '/api/plugins');
  await test('GET /api/plugins/market', 'GET', '/api/plugins/market');
})();

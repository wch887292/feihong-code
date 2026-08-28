// 飞虹 Code v7.6.0 综合冒烟测试（smoke test）
// 覆盖：健康检查 / 认证 / 核心引擎回归 / 修复API(8模块) / 前端资源 / SWE harness
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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
    const statusOk = r.status === expect;
    const bodyOk = okCheck ? okCheck(data) : true;
    report(name, statusOk && bodyOk, `HTTP ${r.status}${data?.error ? ' error=' + data.error : ''}`);
  } catch (e) {
    report(name, false, 'network: ' + e.message);
  }
}

(async () => {
  console.log('===== [1] 健康检查与认证 =====');
  const health = await (await fetch(BASE + '/api/health')).json();
  report('GET /api/health (version=7.6.0)', health.version === '7.6.0', 'version=' + health.version);

  const login = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: 'smoke-test' })
  })).json();
  report('POST /api/auth/login', !!login.token && login.ok === true);
  const token = login.token;
  report('token 非空', typeof token === 'string' && token.length > 20);

  console.log('\n===== [2] 核心引擎回归（原有 API 不应被破坏）=====');
  await req('GET /api/models', '/api/models', { token, okCheck: (d) => Array.isArray(d.models) });
  await req('GET /api/multi-agent/roles', '/api/multi-agent/roles', { token, okCheck: (d) => Array.isArray(d.roles) });
  await req('GET /api/custom-agents', '/api/custom-agents', { token, okCheck: (d) => Array.isArray(d.agents) });
  await req('GET /api/event-driven/config', '/api/event-driven/config', { token, okCheck: (d) => d.config !== undefined });
  await req('GET /api/mcp/tools', '/api/mcp/tools', { token, okCheck: (d) => d.servers !== undefined });
  await req('GET /api/changes', '/api/changes', { token, okCheck: (d) => d.stats !== undefined });
  await req('GET /api/skills/market', '/api/skills/market', { token, okCheck: (d) => Array.isArray(d.skills) });
  await req('GET /api/office/capabilities', '/api/office/capabilities', { token, okCheck: (d) => Array.isArray(d.capabilities) });
  await req('GET /api/git/status', '/api/git/status', { token, okCheck: (d) => d.isRepo !== undefined });
  await req('GET /api/memory/stats', '/api/memory/stats', { token, okCheck: (d) => d.shortTermFiles !== undefined });
  await req('GET /api/templates', '/api/templates', { token, okCheck: (d) => Array.isArray(d.builtin) });

  console.log('\n===== [3] 修复 API（8 个死代码模块 → 可调用）=====');
  await req('POST /api/voice/parse', '/api/voice/parse', { method: 'POST', body: { text: '打开文件' }, token, okCheck: (d) => d.ok && d.command?.type === 'open_file' });
  await req('GET /api/voice/commands', '/api/voice/commands', { token, okCheck: (d) => Array.isArray(d.commands) });
  await req('GET /api/knowledge/documents', '/api/knowledge/documents', { token, okCheck: (d) => Array.isArray(d.documents) });
  await req('GET /api/knowledge/stats', '/api/knowledge/stats', { token, okCheck: (d) => d.stats !== undefined });
  await req('GET /api/sso/providers', '/api/sso/providers', { token, okCheck: (d) => Array.isArray(d.providers) });
  await req('GET /api/figma/status', '/api/figma/status', { token, okCheck: (d) => d.configured !== undefined });
  await req('GET /api/collaboration/status', '/api/collaboration/status', { token, okCheck: (d) => d.feishu !== undefined && d.github !== undefined });
  await req('GET /api/plugins', '/api/plugins', { token, okCheck: (d) => Array.isArray(d.plugins) });
  await req('GET /api/plugins/market', '/api/plugins/market', { token, okCheck: (d) => Array.isArray(d.plugins) });

  console.log('\n===== [4] 功能闭环（知识库 CRUD + 搜索 / 语音 to-code / 插件市场搜索）=====');
  await req('POST /api/knowledge/document', '/api/knowledge/document', { method: 'POST', body: { title: '冒烟测试文档', content: '冒烟测试内容：验证知识库闭环。', type: 'text', tags: ['smoke'] }, token, okCheck: (d) => d.ok && d.document?.id });
  await req('POST /api/knowledge/search', '/api/knowledge/search', { method: 'POST', body: { query: '冒烟测试' }, token, okCheck: (d) => d.ok && Array.isArray(d.results) && d.results.length > 0 });
  await req('POST /api/voice/to-code', '/api/voice/to-code', { method: 'POST', body: { description: '实现一个求和函数', language: 'typescript' }, token, okCheck: (d) => d.ok && !!d.result?.code });
  await req('GET /api/plugins/market?q=git', '/api/plugins/market?q=git', { token, okCheck: (d) => Array.isArray(d.plugins) });

  console.log('\n===== [5] 前端资源（能力中心面板 / API 封装 / 绑定逻辑）=====');
  try {
    const html = await (await fetch(BASE + '/')).text();
    report('GET / 含 capabilitiesPanel', html.includes('capabilitiesPanel'));
    const api = await (await fetch(BASE + '/js/api.js')).text();
    report('GET /js/api.js 含 apiVoiceParse', api.includes('apiVoiceParse'));
    report('GET /js/api.js 含 apiKnowledgeSearch', api.includes('apiKnowledgeSearch'));
    const ui = await (await fetch(BASE + '/js/ui.js')).text();
    report('GET /js/ui.js 含 bindCapabilitiesOnce', ui.includes('bindCapabilitiesOnce'));
    report('GET /js/ui.js 含 runCapabilityVoice', ui.includes('runCapabilityVoice'));
  } catch (e) { report('前端资源可访问', false, e.message); }

  console.log('\n===== [6] SWE harness 闭环（mock 冒烟）=====');
  try {
    const { execSync } = require('child_process');
    const out = execSync('node scripts/_swe-smoke.mjs', { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 });
    report('SWE harness mock 2/2', out.includes('通过率: 100.0%') || out.includes('rate": 1'), '');
  } catch (e) {
    report('SWE harness mock 2/2', false, '执行失败: ' + (e.message || '').split('\n')[0]);
  }

  console.log(`\n========== 冒烟测试结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过，可继续下一步'); }
  process.exit(fail > 0 ? 1 : 0);
})();

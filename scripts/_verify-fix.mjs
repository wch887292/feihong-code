// 修复后功能闭环验证
const BASE = 'http://127.0.0.1:8099';

async function req(name, method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  const preview = text.length > 110 ? text.slice(0, 110) + '…' : text;
  console.log(`  ${String(name).padEnd(40)} HTTP ${r.status}  ${preview.replace(/\n/g, ' ')}`);
}

(async () => {
  const login = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: 'vscode-local' })
  })).json();
  const token = login.token;

  console.log('===== 语音 to-code（带参数）=====');
  await req('POST /api/voice/to-code', 'POST', '/api/voice/to-code', { description: '生成一个冒泡排序函数', language: 'typescript' }, token);

  console.log('\n===== 知识库 CRUD 闭环 =====');
  await req('POST /api/knowledge/document', 'POST', '/api/knowledge/document', { title: '飞虹Code部署指南', content: '飞虹 Code 支持 npm 全局安装与私有化部署，详见 docs。', type: 'markdown', category: '部署', tags: ['部署', 'npm'] }, token);
  await req('GET /api/knowledge/documents', 'GET', '/api/knowledge/documents', undefined, token);
  await req('GET /api/knowledge/stats', 'GET', '/api/knowledge/stats', undefined, token);
  await req('GET /api/knowledge/categories', 'GET', '/api/knowledge/categories', undefined, token);
  await req('GET /api/knowledge/tags', 'GET', '/api/knowledge/tags', undefined, token);
  await req('POST /api/knowledge/search', 'POST', '/api/knowledge/search', { query: '私有化' }, token);

  console.log('\n===== 插件市场搜索 =====');
  await req('GET /api/plugins/market?q=git', 'GET', '/api/plugins/market?q=git', undefined, token);
  await req('GET /api/plugins/categories', 'GET', '/api/plugins/categories', undefined, token);

  console.log('\n===== 协作 / SSO / Figma 状态 =====');
  await req('GET /api/collaboration/status', 'GET', '/api/collaboration/status', undefined, token);
  await req('GET /api/figma/status', 'GET', '/api/figma/status', undefined, token);
})();

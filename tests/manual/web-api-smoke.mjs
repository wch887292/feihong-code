/**
 * 飞虹 Code Web 控制台 — 全量 API 冒烟测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖 7 个一级页面 + 9 个弹窗对应的全部后端端点。
 * 用法: node tests/manual/web-api-smoke.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:8080';
let TOKEN = '';
let pass = 0, fail = 0;
const failures = [];

function log(ok, name, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function req(path, opts = {}, token = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (token && TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const r = await fetch(BASE + path, { ...opts, headers });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

// ---------- 1. 公开接口 ----------
console.log('\n【公开接口】');
try {
  const h = await req('/api/health', {}, false);
  log(h.status === 200 && h.body.ok, 'GET /api/health', 'v' + h.body.version);
} catch (e) { log(false, 'GET /api/health', e.message); }

try {
  const d = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone: '13800138000' }) }, false);
  log(d.status === 200 && d.body.token, 'POST /api/auth/login', 'token: ' + String(d.body.token).slice(0, 12) + '…');
  TOKEN = d.body.token;
} catch (e) { log(false, 'POST /api/auth/login', e.message); }

try {
  const d = await req('/api/drives', {}, false);
  log(d.status === 200 && Array.isArray(d.body.drives), 'GET /api/drives', d.body.drives?.join(' '));
} catch (e) { log(false, 'GET /api/drives', e.message); }

// ---------- 2. 鉴权验证 ----------
console.log('\n【鉴权】');
{
  const d = await req('/api/tasks', {}, false);
  log(d.status === 401, '未认证访问 /api/tasks → 401（fail-closed）', '实际 ' + d.status);
}
{
  const d = await req('/api/auth/me');
  log(d.status === 200 && d.body.phone === '13800138000', 'GET /api/auth/me（会话令牌）', d.body.phone);
}

// ---------- 3. 工作区与文件 ----------
console.log('\n【工作区与文件浏览】');
let ws = null;
{
  const d = await req('/api/workspace');
  ws = d.body.cwd;
  log(d.status === 200 && ws, 'GET /api/workspace', ws);
}
{
  const d = await req('/api/workspace/list');
  log(d.status === 200 && Array.isArray(d.body.entries), 'GET /api/workspace/list（默认）', d.body.entries?.length + ' 条');
}
{
  const d = await req('/api/workspace/list?path=' + encodeURIComponent('C:\\'));
  log(d.status === 200 && d.body.entries?.length > 0, 'GET /api/workspace/list（C:\\）', d.body.entries?.length + ' 条');
}
{
  const d = await req('/api/workspace/list?path=' + encodeURIComponent('Z:\\不存在的盘'));
  log(d.status === 403, 'GET /api/workspace/list（越权路径）→ 403', '实际 ' + d.status);
}
{
  const d = await req('/api/workspace', { method: 'POST', body: JSON.stringify({ cwd: 'H:\\' }) });
  log(d.status === 200, 'POST /api/workspace（切换 H:\\）', d.body.cwd);
  if (d.status === 200) await req('/api/workspace', { method: 'POST', body: JSON.stringify({ cwd: ws }) });
}
{
  const d = await req('/api/files/read', { method: 'POST', body: JSON.stringify({ path: 'H:\\Muse Code复刻\\package.json' }) });
  log(d.status === 200 && d.body.content?.includes('"name"'), 'POST /api/files/read（读 package.json）', d.body.path);
}
{
  const d = await req('/api/files/read', { method: 'POST', body: JSON.stringify({ path: 'Z:\\nope.txt' }) });
  log(d.status === 403, 'POST /api/files/read（越权路径）→ 403', '实际 ' + d.status);
}
{
  const d = await req('/api/upload', { method: 'POST', body: JSON.stringify({ name: 'smoke-test.txt', mime: 'text/plain', dataBase64: Buffer.from('fhcode smoke test').toString('base64') }) });
  log(d.status === 200 && d.body.path, 'POST /api/upload（上传）', d.body.path);
}

// ---------- 4. 任务队列 ----------
console.log('\n【任务队列】');
let taskId = null;
{
  const d = await req('/api/tasks', { method: 'POST', body: JSON.stringify({ goal: '[冒烟测试] 读取当前工作区 package.json 的 name 字段并返回' }) });
  taskId = d.body.task?.id;
  log(d.status === 201 && taskId, 'POST /api/tasks（创建任务）', taskId);
}
{
  const d = await req('/api/tasks');
  log(d.status === 200 && Array.isArray(d.body.tasks), 'GET /api/tasks（列表）', d.body.tasks?.length + ' 个任务');
}
{
  const d = await req('/api/tasks/' + taskId);
  log(d.status === 200 && d.body.task, 'GET /api/tasks/:id（详情）', 'status=' + d.body.task?.status);
}
{
  const d = await req('/api/tasks/' + taskId + '/messages', { method: 'POST', body: JSON.stringify({ message: '继续：请附带 version 字段' }) });
  // 201=续接成功；409=任务仍在执行中被正确拦截（均符合预期）
  log(d.status === 201 || d.status === 409, 'POST /api/tasks/:id/messages（多轮续接）', d.status === 201 ? '已续接' : '执行中正确拦截(409)');
}
{
  const d = await req('/api/tasks/not-exist-id');
  log(d.status === 404, 'GET /api/tasks/:id（不存在）→ 404', '实际 ' + d.status);
}

// ---------- 5. 自动化 ----------
console.log('\n【自动化】');
let autoId = null;
{
  const d = await req('/api/automations');
  log(d.status === 200 && Array.isArray(d.body.automations), 'GET /api/automations', d.body.automations?.length + ' 条');
}
{
  const d = await req('/api/automations', { method: 'POST', body: JSON.stringify({ name: '冒烟测试指令', goal: '运行 npm test 并汇总结果' }) });
  autoId = d.body.automation?.id;
  log(d.status === 201 && autoId, 'POST /api/automations（创建）', autoId);
}
{
  const d = await req('/api/automations/' + autoId + '/run', { method: 'POST' });
  log(d.status === 201, 'POST /api/automations/:id/run（一键运行）', 'runCount=' + d.body.runCount);
}
{
  const d = await req('/api/automations/' + autoId, { method: 'DELETE' });
  log(d.status === 200, 'DELETE /api/automations/:id（删除）');
}

// ---------- 6. 模板库 ----------
console.log('\n【模板库】');
let tplId = null;
{
  const d = await req('/api/templates');
  log(d.status === 200 && d.body.builtin?.length >= 8, 'GET /api/templates', d.body.builtin?.length + ' 内置 + ' + d.body.user?.length + ' 自定义');
}
{
  const d = await req('/api/templates', { method: 'POST', body: JSON.stringify({ title: '冒烟测试模板', goal: '请审查以下代码', category: '测试' }) });
  tplId = d.body.template?.id;
  log(d.status === 201 && tplId, 'POST /api/templates（创建）', tplId);
}
{
  const d = await req('/api/templates/' + tplId, { method: 'DELETE' });
  log(d.status === 200, 'DELETE /api/templates/:id（删除）');
}

// ---------- 7. 插件市场 ----------
console.log('\n【插件市场】');
{
  const d = await req('/api/skills/market?source=agent-foundry&limit=5', {}, true);
  log(d.status === 200 && Array.isArray(d.body.skills), 'GET /api/skills/market（agent-foundry）', (d.body.skills || []).length + ' 个技能');
}
{
  const d = await req('/api/skills/installed');
  log(d.status === 200 && Array.isArray(d.body.skills), 'GET /api/skills/installed');
}
{
  const d = await req('/api/skills/install', { method: 'POST', body: JSON.stringify({ id: 'smoke:test', name: '冒烟测试技能', source: 'clawhub' }) });
  log(d.status === 200, 'POST /api/skills/install（安装）', d.body.message);
}

// ---------- 8. 办公助理 ----------
console.log('\n【办公助理】');
{
  const d = await req('/api/office/capabilities');
  log(d.status === 200 && d.body.capabilities?.length >= 6, 'GET /api/office/capabilities', d.body.capabilities?.length + ' 个能力');
}

// ---------- 9. 记忆系统 ----------
console.log('\n【记忆系统】');
{
  const d = await req('/api/memory/stats');
  log(d.status === 200, 'GET /api/memory/stats', JSON.stringify(d.body).slice(0, 80));
}
{
  const d = await req('/api/memory/short?date=2026-08-22');
  log(d.status === 200, 'GET /api/memory/short（当日短期记忆）');
}
{
  const d = await req('/api/memory/long');
  log(d.status === 200, 'GET /api/memory/long（长期记忆）');
}
{
  const d = await req('/api/memory/history?limit=5');
  log(d.status === 200 && Array.isArray(d.body.history), 'GET /api/memory/history（总结历史）', d.body.history?.length + ' 条');
}

// ---------- 10. 大模型配置 ----------
console.log('\n【大模型配置】');
let modelId = null;
{
  const d = await req('/api/models');
  log(d.status === 200 && Array.isArray(d.body.models), 'GET /api/models', d.body.models?.length + ' 个配置');
}
{
  const d = await req('/api/models', { method: 'POST', body: JSON.stringify({ name: '冒烟测试模型', apiBase: 'https://example.com/v1', apiKey: 'sk-smoke' }) });
  modelId = d.body.model?.id;
  log(d.status === 200 && modelId, 'POST /api/models（保存配置）', modelId);
}
{
  const d = await req('/api/models/' + modelId + '/default', { method: 'POST' });
  log(d.status === 200, 'POST /api/models/:id/default（设为默认）', 'defaultId=' + d.body.defaultId);
}
{
  const d = await req('/api/models/' + modelId, { method: 'DELETE' });
  log(d.status === 200, 'DELETE /api/models/:id（删除）');
}

// ---------- 11. 打开本地 ----------
console.log('\n【打开本地（仅测失败分支，避免弹出系统窗口）】');
{
  const d = await req('/api/open/folder', { method: 'POST', body: JSON.stringify({ path: 'Z:\\不存在的目录' }) });
  log(d.status === 403, 'POST /api/open/folder（越权）→ 403', '实际 ' + d.status);
}
{
  const d = await req('/api/open/browser', { method: 'POST', body: JSON.stringify({}) });
  log(d.status === 400, 'POST /api/open/browser（缺 url）→ 400', '实际 ' + d.status);
}

// ---------- 汇总 ----------
console.log('\n========================================');
console.log(`总用例: ${pass + fail}  通过: ${pass}  失败: ${fail}`);
if (failures.length) {
  console.log('失败项:');
  failures.forEach((f) => console.log('  ❌ ' + f));
  process.exit(1);
} else {
  console.log('🎉 全部 API 冒烟测试通过');
}

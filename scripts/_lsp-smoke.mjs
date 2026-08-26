// LSP 语义服务冒烟测试
const BASE = 'http://127.0.0.1:8099';
const CWD = encodeURIComponent('H:/Muse Code复刻');
let pass = 0, fail = 0;

function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

async function jget(path, token) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; } catch { return { status: r.status, data: { ok: false, raw: text.slice(0, 60) } }; }
}

(async () => {
  const login = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'lsp-test' })
  })).json();
  const token = login.token;

  console.log('===== LSP 语义服务冒烟 =====');

  // 1. graph 摘要
  const g = await jget(`/api/lsp/graph?cwd=${CWD}`, token);
  report('GET /api/lsp/graph', g.status === 200 && g.data.ok && g.data.summary?.fileCount > 0,
    `files=${g.data.summary?.fileCount} symbols=${g.data.summary?.symbolCount} edges=${g.data.summary?.edgeCount}`);

  // 2. symbols（对 lsp-service.ts 自身）
  const sym = await jget(`/api/lsp/symbols?cwd=${CWD}&file=${encodeURIComponent('H:/Muse Code复刻/src/lsp/lsp-service.ts')}`, token);
  report('GET /api/lsp/symbols', sym.status === 200 && sym.data.ok && Array.isArray(sym.data.symbols) && sym.data.symbols.length > 0,
    `symbols=${sym.data.symbols?.length}`);

  // 3. search
  const s = await jget(`/api/lsp/search?cwd=${CWD}&q=LspService`, token);
  report('GET /api/lsp/search', s.status === 200 && s.data.ok && s.data.symbols?.length > 0, `hits=${s.data.symbols?.length}`);

  // 4. diagnostics（对一个 .ts 文件，可能有错误或为空都算"可调用"）
  const d = await jget(`/api/lsp/diagnostics?cwd=${CWD}&file=${encodeURIComponent('H:/Muse Code复刻/src/lsp/lsp-service.ts')}`, token);
  report('GET /api/lsp/diagnostics', d.status === 200 && d.data.ok && Array.isArray(d.data.diagnostics), `errors=${d.data.diagnostics?.length}`);

  // 5. definition（找 LspService 类定义行——用 graph 摘要返回的符号定位）
  const def = await jget(`/api/lsp/definition?cwd=${CWD}&file=${encodeURIComponent('H:/Muse Code复刻/src/lsp/lsp-service.ts')}&line=100`, token);
  report('GET /api/lsp/definition', def.status === 200 && def.data.ok, def.data.definition ? `→ ${def.data.definition.name}@${def.data.definition.line}` : '（行 100 附近无符号，属正常）');

  // 6. hover
  const h = await jget(`/api/lsp/hover?cwd=${CWD}&file=${encodeURIComponent('H:/Muse Code复刻/src/lsp/lsp-service.ts')}&line=75`, token);
  report('GET /api/lsp/hover', h.status === 200 && h.data.ok, h.data.hover ? `→ ${h.data.hover.name}` : '（行 75 附近无符号，属正常）');

  // 7. 缺参错误处理
  const noFile = await jget(`/api/lsp/symbols?cwd=${CWD}`, token);
  report('缺少 file 参数返回明确错误', noFile.status === 200 && noFile.data.ok === false && !!noFile.data.error, `error=${noFile.data.error}`);

  // 8. 其他已修复 API 回归抽查
  const voice = await (await fetch(BASE + '/api/voice/parse', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ text: '打开文件' }) })).json();
  report('回归: voice/parse 仍 200', voice.ok && voice.command?.type === 'open_file');
  const plugins = await jget('/api/plugins/market', token);
  report('回归: plugins/market 仍 200', plugins.status === 200 && plugins.data.ok);

  console.log(`\n===== LSP 冒烟结果：通过 ${pass}  失败 ${fail} =====`);
  process.exit(fail > 0 ? 1 : 0);
})();

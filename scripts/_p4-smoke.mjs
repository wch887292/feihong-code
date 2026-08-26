// P4 批次冒烟：扩展单测 + Monaco 诊断 + 本地种子 + 补全多候选
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

const root = process.cwd();

console.log('===== P4-1 扩展补全纯函数单测 =====');
try {
  const out = execSync('node --test vscode-extension/test/completion-utils.test.js', { cwd: root, encoding: 'utf8' });
  report('单测 9 项全通过', /# pass 9/.test(out) && /# fail 0/.test(out));
  report('extension.js 引用 completion-utils', readFileSync(join(root, 'vscode-extension/extension.js'), 'utf8').includes("require('./completion-utils')"));
  report('completion-utils 独立模块存在', existsSync(join(root, 'vscode-extension/completion-utils.js')));
} catch { report('扩展单测', false); }

console.log('\n===== P4-2 Monaco 诊断波浪线 =====');
const monaco = readFileSync(join(root, 'src/web/public/js/monaco-editor.js'), 'utf8');
const ui = readFileSync(join(root, 'src/web/public/js/ui.js'), 'utf8');
report('monaco-editor.js 含 registerDiagnostics', monaco.includes('function registerDiagnostics'));
report('monaco-editor.js 含 setModelMarkers 映射', monaco.includes('setModelMarkers') && monaco.includes('MarkerSeverity'));
report('monaco-editor.js 含防抖诊断', monaco.includes('onDidChangeModelContent') && monaco.includes('350'));
report('ui.js 已接 diagnostics 路由', ui.includes('/api/lsp/diagnostics'));
report('FHMonaco 导出 registerDiagnostics', monaco.includes('registerDiagnostics: registerDiagnostics'));

console.log('\n===== P4-3 本地插件市场种子 =====');
const seed = readFileSync(join(root, 'templates/market/index.json'), 'utf8');
const seedIdx = JSON.parse(seed);
report('种子索引含 10 条', Array.isArray(seedIdx.skills) && seedIdx.skills.length === 10);
report('种子 url 用 local: 前缀', seedIdx.skills.every((s) => s.url.startsWith('local:')));
report('run.ts 含本地种子回退', readFileSync(join(root, 'src/cli/run.ts'), 'utf8').includes('templates/market/index.json') && readFileSync(join(root, 'src/cli/run.ts'), 'utf8').includes("startsWith('local:')"));
report('i18n 含本地种子提示', readFileSync(join(root, 'src/shared/i18n.ts'), 'utf8').includes('skillMarket.localSeed'));
report('用户级已装 security-audit（此前实测）', existsSync(join(process.env.USERPROFILE, '.feihong-code/skills/security-audit/SKILL.md')));

console.log('\n===== P4-4 补全多候选 =====');
const engine = readFileSync(join(root, 'src/agent/completion-engine.ts'), 'utf8');
report('parseAndValidate 支持多候选循环', engine.includes('splitCandidates') && engine.includes('results.sort((a, b) => b.confidence'));
report('splitCandidates 识别多代码块', engine.includes('fences.length >= 2'));
report('最多返回 3 候选', engine.includes('.slice(0, 3)'));

// 服务端多候选真实验证（HTTP）
console.log('\n===== P4-4 HTTP /api/completion 多候选 =====');
const BASE = process.env.FH_SMOKE_BASE || 'http://127.0.0.1:8099';
(async () => {
  try {
    const login = await (await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'p4-test' }),
    })).json();
    const d = await fetch(BASE + '/api/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token },
      body: JSON.stringify({ filePath: 'x.ts', fileContent: 'const a = 1;\n', cursorOffset: 12, mode: 'full' }),
    });
    const r = await d.json();
    report('POST /api/completion 可调用', d.status === 200 && r.ok);
    report('返回 suggestions 数组', Array.isArray(r.suggestions));
  } catch (e) { report('completion HTTP', false, String(e)); }

  console.log(`\n========== P4 批次冒烟结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过'); }
  process.exit(fail > 0 ? 1 : 0);
})();

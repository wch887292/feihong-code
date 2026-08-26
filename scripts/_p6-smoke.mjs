// P6 批次冒烟：accept 后 lint + 10 模板补齐 + 多文件 diff 视图 + 安全 CI/SBOM
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}
const root = process.cwd();

console.log('===== P6-1 补全 accept 后自动 lint =====');
const lint = readFileSync(join(root, 'src/agent/lint.ts'), 'utf8');
const server = readFileSync(join(root, 'src/web/server.ts'), 'utf8');
const monaco = readFileSync(join(root, 'src/web/public/js/monaco-editor.js'), 'utf8');
const ui = readFileSync(join(root, 'src/web/public/js/ui.js'), 'utf8');
const ext = readFileSync(join(root, 'vscode-extension/extension.js'), 'utf8');
const apiclient = readFileSync(join(root, 'vscode-extension/api-client.js'), 'utf8');
report('lint.ts 存在且导出 lintSnippet', lint.includes('export function lintSnippet'));
report('lint 支持括号/引号配平+错误模式', lint.includes('openers') && lint.includes('未闭合') && lint.includes('悬空运算符'));
report('server 提供 /api/lint', server.includes("'/api/lint'"));
report('Monaco inline 支持 onAccept 回调', monaco.includes('onAccept') && monaco.includes('onDidChangeModelContent'));
report('Monaco 导出 showLintFeedback', monaco.includes('showLintFeedback: showLintFeedback'));
report('Monaco 记录 activeEditor', monaco.includes('activeEditor = editor'));
report('ui.js 接线 onAccept→lint', ui.includes('lintAfterAccept') && ui.includes('/api/lint'));
report('ui.js lint 追加波浪线+状态栏', ui.includes('showLintFeedback') && ui.includes('校验发现'));
report('扩展 accept 后 lint', ext.includes('enableAcceptLint') && ext.includes('/api/lint'));
report('api-client 提供 lint 方法', apiclient.includes('async lint('));

console.log('\n===== P6-2 Skill 模板仓库 10 个官方模板 =====');
const dirs = readdirSync(join(root, 'templates/skills'), { withFileTypes: true }).filter((d) => d.isDirectory());
report('模板目录数量=10', dirs.length === 10, `（实际 ${dirs.length}）`);
const expected = ['api-design', 'code-review', 'dependency-upgrade', 'doc-gen', 'git-flow', 'onboarding', 'performance', 'refactor', 'security-audit', 'test-gen'];
report('模板清单齐全', expected.every((n) => dirs.some((d) => d.name === n)));
let allSelf = 0;
for (const d of dirs) {
  const md = join(root, 'templates/skills', d.name, 'SKILL.md');
  const c = readFileSync(md, 'utf8');
  if (c.includes('自检与边界') && c.includes('执行步骤') && c.includes('输出格式')) allSelf++;
}
report('全部含 触发/执行步骤/输出格式/自检', allSelf === 10, `（${allSelf}/10）`);

console.log('\n===== P6-3 多文件协同编辑的可视化 diff 视图 =====');
report('ui 含 diff 模式状态 _diffModes', ui.includes('_diffModes'));
report('ui 含折叠集合 _collapsedPaths', ui.includes('_collapsedPaths'));
report('ui 含并排 diff 渲染', ui.includes("mode === 'side'") && ui.includes('grid-template-columns:1fr 1fr'));
report('ui 含并排/内联切换按钮', ui.includes('toggle-mode'));
report('ui 含折叠切换', ui.includes('toggle-collapse'));

console.log('\n===== P6-4 安全 CI（npm audit + SBOM） =====');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
report('package.json 含 security script', (pkg.scripts && pkg.scripts.security) === 'node scripts/_security-check.cjs');
report('安全脚本存在', existsSync(join(root, 'scripts/_security-check.cjs')));
const sbom = join(root, 'artifacts/sbom.json');
report('SBOM 已生成', existsSync(sbom));
if (existsSync(sbom)) {
  const s = JSON.parse(readFileSync(sbom, 'utf8'));
  report('SBOM 格式 CycloneDX 1.5', s.bomFormat === 'CycloneDX' && s.specVersion === '1.5');
  report('SBOM 组件数>=14', Array.isArray(s.components) && s.components.length >= 14, `（${s.components.length}）`);
  report('SBOM 组件含 purl', s.components.every((c) => c.purl));
}
const sc = readFileSync(join(root, 'scripts/_security-check.cjs'), 'utf8');
report('安全脚本含 audit 降级逻辑', sc.includes('网络不可达') && sc.includes('跳过漏洞扫描'));
report('安全脚本含 high/critical 门禁', sc.includes("s === 'high'") && sc.includes('exitCode = 1'));

console.log('\n===== P6-1 HTTP /api/lint =====');
const BASE = process.env.FH_SMOKE_BASE || 'http://127.0.0.1:8099';
(async () => {
  try {
    const login = await (await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'p6-test' }),
    })).json();
    // 错误代码 → 应返回 errors
    const bad = await (await fetch(BASE + '/api/lint', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token },
      body: JSON.stringify({ code: 'const x = (1 + 2;', language: 'typescript' }),
    })).json();
    report('POST /api/lint 返回 errors', bad.ok === true && Array.isArray(bad.errors) && bad.errors.length > 0 && bad.clean === false);
    report('lint 定位行号', bad.errors.some((e) => typeof e.line === 'number'));
    // 合法代码 → clean
    const good = await (await fetch(BASE + '/api/lint', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token },
      body: JSON.stringify({ code: 'function f() {\n  return 1;\n}', language: 'typescript' }),
    })).json();
    report('POST /api/lint 合法代码 clean', good.ok === true && good.clean === true);
  } catch (e) { report('lint HTTP', false, String(e)); }

  console.log(`\n========== P6 批次冒烟结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过'); }
  process.exit(fail > 0 ? 1 : 0);
})();

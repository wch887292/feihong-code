// P5 批次冒烟：跨文件上下文 + 诊断 hover + 市场种子自动注册 + temperature 分层
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

const root = process.cwd();

console.log('===== P5-1 扩展补全上下文增强（跨文件检索） =====');
const ext = readFileSync(join(root, 'vscode-extension/extension.js'), 'utf8');
const server = readFileSync(join(root, 'src/web/server.ts'), 'utf8');
const engine = readFileSync(join(root, 'src/agent/completion-engine.ts'), 'utf8');
report('扩展含 collectCrossFileContext', ext.includes('async function collectCrossFileContext'));
report('扩展解析 import/require 引用', ext.includes("import\\s+[^'\"]+?\\s+from") || ext.includes("import\\\\s+"));
report('扩展优先已打开文档内存内容', ext.includes('vscode.workspace.textDocuments'));
report('扩展文件大小截断保护', ext.includes('CROSS_FILE_MAX_BYTES'));
report('扩展透传 crossFileContext 到请求', ext.includes('crossFileContext,') || ext.includes('crossFileContext: crossFileContext'));
report('server 透传 crossFileContext 字段', server.includes('crossFileContext') && server.includes("body?.crossFileContext"));
report('engine 合并工作区上下文到 prompt', engine.includes('extraCrossFileContext') && engine.includes('【工作区相关文件】'));
report('CompletionRequest 增加 crossFileContext', engine.includes('crossFileContext?: string'));

console.log('\n===== P5-2 诊断 hover 提示 =====');
const monaco = readFileSync(join(root, 'src/web/public/js/monaco-editor.js'), 'utf8');
report('monaco 注册 hover provider', monaco.includes('registerHoverProvider'));
report('hover 展示错误/警告/提示图标', monaco.includes("'错误'") && monaco.includes("'警告'") && monaco.includes("'提示'"));
report('hover 限定当前编辑器模型', monaco.includes('model.uri.toString() !== cur.uri.toString()'));
report('hover 聚合行内多 marker', monaco.includes('getModelMarkers({ resource: model.uri })'));

console.log('\n===== P5-3 市场种子自动注册到本地 skills 索引 =====');
const runTs = readFileSync(join(root, 'src/cli/run.ts'), 'utf8');
const i18n = readFileSync(join(root, 'src/shared/i18n.ts'), 'utf8');
report('install 后调用 discoverSkills 验证', runTs.includes('const discovered = discoverSkills(process.cwd())'));
report('注册确认/警告双分支', runTs.includes('skillMarket.registered') && runTs.includes('skillMarket.notRegisteredWarn'));
report('i18n 注册确认文案', i18n.includes('skillMarket.registered'));
// 实测：重装本地种子，确认输出"已自动注册"且计数>0
try {
  const out = execSync('node dist/cli/index.js skill-market install security-audit --repo https://nonexistent.invalid', { cwd: root, encoding: 'utf8' });
  report('实测 install 输出自动注册确认', out.includes('已自动注册'), '（共 ' + (out.match(/共 (\d+) 个/) || [])[1] + ' 个技能）');
} catch { report('实测 install 输出自动注册确认', false); }

console.log('\n===== P5-4 补全模型调优（temperature 分层） =====');
report('config 含 temperatureQuick', engine.includes('temperatureQuick: number') && engine.includes('temperatureQuick: 0'));
report('config 含 temperatureFull', engine.includes('temperatureFull: number') && engine.includes('temperatureFull: 0.3'));
report('complete 按 mode 分层取温度', engine.includes("mode === 'full' ? this.config.temperatureFull : this.config.temperatureQuick"));

console.log('\n===== P5-1 HTTP /api/completion 透传 crossFileContext =====');
const BASE = process.env.FH_SMOKE_BASE || 'http://127.0.0.1:8099';
(async () => {
  try {
    const login = await (await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'p5-test' }),
    })).json();
    const d = await fetch(BASE + '/api/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token },
      body: JSON.stringify({
        filePath: 'x.ts', fileContent: 'const a = 1;\n', cursorOffset: 12, mode: 'full',
        crossFileContext: '【工作区相关文件】\n### helper.ts\nexport function helper() {}',
      }),
    });
    const r = await d.json();
    report('POST /api/completion 含跨文件上下文可调用', d.status === 200 && r.ok);
    report('返回 suggestions 数组', Array.isArray(r.suggestions));
  } catch (e) { report('completion HTTP', false, String(e)); }

  console.log(`\n========== P5 批次冒烟结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过'); }
  process.exit(fail > 0 ? 1 : 0);
})();

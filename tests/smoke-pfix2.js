// P-fix-2 针对性冒烟：验证今天三处修复在 dist 产物中的行为
// 1. exec.ts cwd 规范化（合法 cwd 正常 / 无效 cwd 回退留痕）
// 2. run-shell.tool bash-ism（合法 cmd 不误报 / 事故命令必报）
// 3. orchestrator 平台段（system prompt 含 cmd 语法速查）
const { runCommand } = require('../dist/tools/shell/exec.js');
const { runShellTool } = require('../dist/tools/shell/run-shell.tool.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail || ''}`); }
}

const ctx = {
  runId: 'smoke-run',
  cwd: 'H:/feihong-code',
  security: { shellAllowlist: [], requireApproval: false, sandboxMode: 'danger-full-access' },
  approve: async () => true,
};

(async () => {
  console.log('\n【1. exec.ts cwd 规范化】');
  const r1 = await runCommand('echo smoke-cwd-ok', 'H:/feihong-code', 30000);
  check('合法 cwd 正常执行', r1.code === 0 && r1.stdout.includes('smoke-cwd-ok'), `code=${r1.code} out=${r1.stdout.slice(0, 60)}`);
  check('合法 cwd 无回退留痕', !r1.stderr.includes('回退到进程目录'), r1.stderr.slice(0, 80));

  const r2 = await runCommand('echo smoke-fallback-ok', 'H:/nonexistent-smoke-dir-xyz', 30000);
  check('无效 cwd 回退后仍能执行', r2.code === 0 && r2.stdout.includes('smoke-fallback-ok'), `code=${r2.code}`);
  check('无效 cwd 有回退留痕', r2.stderr.includes('回退到进程目录') && r2.stderr.includes('nonexistent-smoke-dir-xyz'), r2.stderr.slice(0, 120));

  console.log('\n【2. run-shell bash-ism 检测】');
  const legal = await runShellTool.execute({ command: 'cd /d H:/feihong-code && dir /b' }, ctx);
  check('合法 cmd 命令通过', legal.ok === true, legal.error || '');
  check('合法 cmd 不附语法警告', !legal.output.includes('[命令语法警告]'), legal.output.slice(0, 120));

  const legal2 = await runShellTool.execute({ command: 'echo smoke-2nul-ok 2>nul' }, ctx);
  check('2>nul 合法写法不误报', legal2.ok === true && !legal2.output.includes('[命令语法警告]'), legal2.output.slice(0, 120));

  const bad = await runShellTool.execute({ command: 'ls -la /H/ 2>/dev/null || echo "H: not accessible"' }, ctx);
  check('事故命令附语法警告', bad.output.includes('[命令语法警告]'), bad.output.slice(0, 120));
  check('警告含假成功警示', bad.output.includes('退出码为 0') && bad.output.includes('系统找不到指定的路径'), '');
  check('警告含 cmd 替代速查', bad.output.includes('dir /b') && bad.output.includes('2>nul'), '');

  console.log('\n【3. orchestrator 平台段】');
  const fs = require('fs');
  const orch = fs.readFileSync('./dist/agent/orchestrator.js', 'utf8');
  check('dist 含 Windows cmd 语法速查', orch.includes('Windows shell 语法速查'), '');
  check('dist 含 MSYS 路径禁令', orch.includes('禁止 /h/、/H/、/c/'), '');
  check('dist 含诊断提示', orch.includes('首先怀疑你的命令语法是 bash 风格'), '');
  check('dist 含 cd /d 说明', orch.includes('切换盘符目录必须写全'), '');

  console.log(`\n===== 针对性冒烟结果: ${pass} 通过, ${fail} 失败 =====`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('冒烟异常:', e); process.exit(2); });

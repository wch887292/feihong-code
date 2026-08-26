// P2 系列冒烟测试：P2-1 多窗格 TUI + P2-2 插件真实执行 + P2-3 沙箱权限实测
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

(async () => {
  console.log('===== P2-1 多窗格 TUI =====');
  // 1) 纯渲染层：MultiPaneTui 布局断言
  const { MultiPaneTui } = await import('../dist/cli/multi-pane-tui.js');
  const tui = new MultiPaneTui({ width: 60, height: 20, fileTreeWidth: 16 });
  tui.setStatus({ mode: 'live', state: '运行中', fileCount: 2 });
  tui.setFileTree(['src/', '  main.ts', 'README.md']);
  tui.appendMessage('hello from message pane');
  tui.setDiff({ file: 'src/a.ts', hunks: [{ header: '-1,2 +1,2 @@', lines: [
    { type: 'del', content: 'const x = 1' },
    { type: 'add', content: 'const x = 2' },
    { type: 'ctx', content: 'export x' },
  ] }] });
  const layout = tui.getLayout();
  report('布局含顶栏状态', layout[0].includes('files=2'));
  report('布局含窗格分隔符', layout.some((l) => l.includes('│')));
  report('布局含文件树条目', layout.some((l) => l.includes('main.ts')));
  report('布局含 diff 删除行', layout.some((l) => l.includes('- ') && l.includes('const x = 1')));
  report('布局含 diff 新增行', layout.some((l) => l.includes('+ ') && l.includes('const x = 2')));
  report('布局含底部提示', layout[layout.length - 1].includes('Tab=切换窗格'));
  // 2) 交互切换
  tui.nextPane();
  report('Tab 切换活跃窗格', tui.activePaneName === 'tree');
  tui.setRightMode('messages');
  tui.nextPane();
  const layoutMsg = tui.getLayout();
  report('切回消息模式', tui.activePaneName === 'right' && layoutMsg.some((l) => l.includes('hello from message pane')));
  // 3) CLI 命令入口
  try {
    const out = execSync('node dist/cli/index.js tui 2>&1', { cwd: process.cwd(), encoding: 'utf8' });
    report('fhcode tui 命令输出多窗格布局', out.includes('│') && out.includes('文件树') && out.includes('Diff'));
  } catch { report('fhcode tui 命令可运行', false); }

  console.log('\n===== P2-2 插件生态：第三方插件真实执行 =====');
  const { PluginManager } = await import('../dist/plugins/manager.js');
  const base = mkdtempSync(join(tmpdir(), 'fh-p2-plugin-'));
  try {
    const mgr = new PluginManager(base);
    const plugin = {
      id: 'demo-hello', name: 'Demo Hello', version: '1.0.0', description: '冒烟测试插件',
      author: 'p2-test', keywords: ['demo'], categories: ['test'], entry: 'index.js',
      permissions: ['workspace'], dependencies: [],
      publisher: 'test', verified: true, featured: false, latestVersion: '1.0.0',
    };
    await mgr.installPlugin(plugin);
    // 用真实第三方入口覆盖（activate(api) 注册命令/视图/补全/代码操作）
    const entryDir = join(base, 'plugins', 'demo-hello');
    writeFileSync(join(entryDir, 'index.js'), `
module.exports = { activate(api) {
  api.registerCommand('hello', (who) => 'Hello, ' + who + '!');
  api.registerCommand('add', (a, b) => Number(a) + Number(b));
  api.registerView('panel', { title: 'Demo Panel' });
  api.registerCompletionProvider('typescript', { name: 'demo-ts-provider' });
  api.registerCodeAction('fix-all', { title: 'Fix All' });
  api.log('activated from third-party plugin');
}};`, 'utf8');
    mgr.enablePlugin('demo-hello');
    const hello = await mgr.executeCommand('plugin:demo-hello:hello', 'P2');
    report('executeCommand 真实返回', hello === 'Hello, P2!', `got=${JSON.stringify(hello)}`);
    const add = await mgr.executeCommand('plugin:demo-hello:add', 2, 3);
    report('插件命令可传参计算', add === 5, `got=${add}`);
    report('插件视图已注册', mgr.getViews().includes('plugin:demo-hello:panel'));
    report('插件补全提供者已注册', mgr.getCompletionProviders().includes('plugin:demo-hello:typescript'));
    report('插件代码操作已注册', mgr.getCodeActions().includes('plugin:demo-hello:fix-all'));
    report('插件已启用状态', mgr.getPlugin('demo-hello')?.status === 'enabled');
  } finally { rmSync(base, { recursive: true, force: true }); }

  console.log('\n===== P2-3 沙箱权限实测 =====');
  const sb = await import('../dist/tools/sandbox.js');
  const RULES_EMPTY = { networkAllow: [], networkDeny: [] };
  const RULES_DENY = { networkAllow: [], networkDeny: ['evil.example.com'] };
  const RULES_ALLOW = { networkAllow: ['good.example.com'], networkDeny: [] };
  // 1) read-only：禁写禁执行
  const roWrite = sb.checkSandbox('read-only', 'write_file', { path: 'a.ts' }, RULES_EMPTY);
  report('read-only 拦截写文件', roWrite.blocked === true && /read-only/.test(roWrite.reason || ''));
  const roShell = sb.checkSandbox('read-only', 'run_shell', { command: 'ls' }, RULES_EMPTY);
  report('read-only 拦截 shell', roShell.blocked === true);
  const roRead = sb.checkSandbox('read-only', 'read_file', { path: 'a.ts' }, RULES_EMPTY);
  report('read-only 放行读文件', roRead.blocked === false);
  // 2) container：放行 shell（网络白名单约束）
  const cShell = sb.checkSandbox('container', 'run_shell', { command: 'node --version' }, RULES_EMPTY);
  report('container 放行 shell', cShell.blocked === false);
  const cDeny = sb.checkSandbox('container', 'run_shell', { command: 'curl http://evil.example.com/x' }, RULES_DENY);
  report('container 网络黑名单拦截', cDeny.blocked === true && /evil\.example\.com/.test(cDeny.reason || ''));
  const cAllowMiss = sb.checkSandbox('container', 'run_shell', { command: 'curl http://other.com/x' }, RULES_ALLOW);
  report('container 网络白名单拦截未命中', cAllowMiss.blocked === true);
  const cAllowHit = sb.checkSandbox('container', 'run_shell', { command: 'curl http://good.example.com/x' }, RULES_ALLOW);
  report('container 网络白名单放行命中', cAllowHit.blocked === false);
  // 3) danger-full-access：绕过，但黑名单仍生效
  const df = sb.checkSandbox('danger-full-access', 'run_shell', { command: 'ls' }, RULES_EMPTY);
  report('danger-full-access 放行', df.blocked === false);
  const dfDeny = sb.checkSandbox('danger-full-access', 'run_shell', { command: 'curl http://evil.example.com/x' }, RULES_DENY);
  report('danger-full-access 黑名单仍拦截', dfDeny.blocked === true);
  // 4) normalize 回退 + 描述
  report('normalize 非法值回退 workspace-write', sb.normalizeSandboxMode('bogus') === 'workspace-write');
  report('normalize container/docker', sb.normalizeSandboxMode('docker') === 'container');
  report('describeSandboxMode 可读', typeof sb.describeSandboxMode('container') === 'string' && sb.describeSandboxMode('container').includes('容器'));
  // 5) 容器执行层：docker 可用则真实跑一次挂载写文件；不可用如实记录
  let dockerAvailable = false;
  try { execSync('docker --version 2>&1', { stdio: 'ignore' }); dockerAvailable = true; } catch {}
  if (dockerAvailable) {
    try {
      const { runCommandInContainer } = await import('../dist/tools/shell/exec.js');
      const r = await runCommandInContainer('echo container-ok && node --version', process.cwd(), 60000);
      report('docker 容器执行层真实运行', r.code === 0 && /container-ok/.test(r.stdout), `exit=${r.code}`);
    } catch (e) { report('docker 容器执行层真实运行', false, 'failed: ' + String(e)); }
  } else {
    console.log('  ⚠️ 本机无 docker，容器执行层（runCommandInContainer）逻辑存在但未实测（如实记录）');
  }

  console.log(`\n========== P2 冒烟结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过'); }
  process.exit(fail > 0 ? 1 : 0);
})();

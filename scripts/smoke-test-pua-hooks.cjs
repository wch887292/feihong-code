/**
 * pua-ext hooks 集成冒烟测试
 * 验证：SessionStart/PostToolUse/PreCompact 三个 hooks 正常工作
 */
const { registerSkillHook, runSkillHooks, getSkillHookCount, unregisterSkillHooks } = require('../dist/runtime/hooks');
const { registerPuaHooks, getPuaState, loadPuaConfig, setPuaFlavor, savePuaJournal, __resetPuaStateForTest } = require('../dist/skills/pua-hooks');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  // 测试隔离：重置 builder-journal.md 为初始状态
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const puaDir = path.join(os.homedir(), '.pua');
  if (!fs.existsSync(puaDir)) fs.mkdirSync(puaDir, { recursive: true });
  fs.writeFileSync(path.join(puaDir, 'builder-journal.md'), '# PUA Builder Journal\n\n> 失败计数: 0\n', 'utf8');

  console.log('=== 1. hooks 框架基础 ===');
  check('getSkillHookCount 初始为 0', getSkillHookCount() === 0, 'count=' + getSkillHookCount());

  // 注册一个测试 hook
  let testHookCalled = false;
  registerSkillHook('SessionStart', async (ctx) => {
    testHookCalled = true;
    return { systemInjection: '[TEST] test injection' };
  }, 'test-skill');
  check('registerSkillHook 后 count=1', getSkillHookCount() === 1, 'count=' + getSkillHookCount());

  // 运行 SessionStart hooks
  const result = await runSkillHooks('SessionStart', { cwd: '/tmp', runId: 'test-123', goal: 'test goal' });
  check('SessionStart hook 被调用', testHookCalled);
  check('SessionStart 返回 systemInjection', !!result.systemInjection && result.systemInjection.includes('[TEST]'), result.systemInjection);

  // 运行未注册的事件
  const emptyResult = await runSkillHooks('PreCompact', { cwd: '/tmp', runId: 'test-123' });
  check('未注册事件返回空对象', !emptyResult.systemInjection && !emptyResult.outputInjection);

  // 清理测试 hook
  unregisterSkillHooks('test-skill');
  check('unregisterSkillHooks 后 count=0', getSkillHookCount() === 0, 'count=' + getSkillHookCount());

  console.log('\n=== 2. pua-ext hooks 注册 ===');
  __resetPuaStateForTest();
  registerPuaHooks();
  check('registerPuaHooks 后 count=3', getSkillHookCount() === 3, 'count=' + getSkillHookCount());

  // 幂等性：再次注册不应增加
  registerPuaHooks();
  check('registerPuaHooks 幂等（count 仍为 3）', getSkillHookCount() === 3, 'count=' + getSkillHookCount());

  console.log('\n=== 3. SessionStart hook 功能 ===');
  const cfg = loadPuaConfig();
  check('loadPuaConfig 返回配置', !!cfg && cfg.alwaysOn === true && cfg.flavor === 'alibaba', JSON.stringify(cfg));

  const ssResult = await runSkillHooks('SessionStart', { cwd: '/tmp', runId: 'test-456', goal: '修复 bug' });
  check('SessionStart 返回系统注入', !!ssResult.systemInjection, ssResult.systemInjection?.slice(0, 80));
  check('系统注入包含 [PUA Always-On', ssResult.systemInjection?.includes('[PUA Always-On'));
  check('系统注入包含味道信息', ssResult.systemInjection?.includes('阿里味') || ssResult.systemInjection?.includes('alibaba'));

  const state = getPuaState();
  check('getPuaState 返回状态', !!state, state ? JSON.stringify(state) : 'null');
  check('状态 flavor=alibaba', state?.flavor === 'alibaba');
  check('状态 failureCount=0（初始）', state?.failureCount === 0);

  console.log('\n=== 4. PostToolUse hook 功能 ===');
  // 成功的工具调用不应注入旁白
  const okResult = await runSkillHooks('PostToolUse', { cwd: '/tmp', runId: 'test-789', tool: 'run_shell', ok: true });
  check('成功工具调用无 outputInjection', !okResult.outputInjection);

  // 第一次失败不应注入（count<=1）
  const fail1Result = await runSkillHooks('PostToolUse', { cwd: '/tmp', runId: 'test-789', tool: 'run_shell', ok: false });
  check('第1次失败无 outputInjection', !fail1Result.outputInjection);
  check('第1次失败后 failureCount=1', getPuaState()?.failureCount === 1);

  // 第二次失败应注入 L1 旁白
  const fail2Result = await runSkillHooks('PostToolUse', { cwd: '/tmp', runId: 'test-789', tool: 'run_shell', ok: false });
  check('第2次失败有 outputInjection', !!fail2Result.outputInjection, fail2Result.outputInjection?.slice(0, 80));
  check('第2次失败后 failureCount=2', getPuaState()?.failureCount === 2);
  check('旁白包含 L1/温和失望/第 2 次', fail2Result.outputInjection?.includes('第 2 次') || fail2Result.outputInjection?.includes('L1'));

  // 第三次失败应注入 L2 旁白
  const fail3Result = await runSkillHooks('PostToolUse', { cwd: '/tmp', runId: 'test-789', tool: 'write_file', ok: false });
  check('第3次失败有 outputInjection', !!fail3Result.outputInjection);
  check('第3次失败后 failureCount=3', getPuaState()?.failureCount === 3);
  check('lastFailedTool=write_file', getPuaState()?.lastFailedTool === 'write_file');

  console.log('\n=== 5. PreCompact hook 功能 ===');
  const pcResult = await runSkillHooks('PreCompact', { cwd: '/tmp', runId: 'test-789', messageCount: 50, preservedCount: 10 });
  check('PreCompact 执行无异常', true);
  check('PreCompact 返回空对象（无注入）', !pcResult.systemInjection && !pcResult.outputInjection);

  // 验证 builder-journal.md 被写入
  const journalFile = path.join(os.homedir(), '.pua', 'builder-journal.md');
  check('builder-journal.md 存在', fs.existsSync(journalFile));
  if (fs.existsSync(journalFile)) {
    const content = fs.readFileSync(journalFile, 'utf8');
    check('journal 包含失败计数', content.includes('失败计数'));
    check('journal 包含当前失败计数=3', content.includes('失败计数: 3') || content.includes('失败计数：3'));
  }

  console.log('\n=== 6. 味道切换 ===');
  setPuaFlavor('huawei');
  check('setPuaFlavor(huawei) 后状态 flavor=huawei', getPuaState()?.flavor === 'huawei');
  const cfg2 = loadPuaConfig();
  check('配置文件 flavor=huawei', cfg2.flavor === 'huawei');

  // 切换回 alibaba
  setPuaFlavor('alibaba');
  check('切换回 alibaba', getPuaState()?.flavor === 'alibaba');

  console.log('\n========== 汇总 ==========');
  console.log('PASS: ' + pass + '  FAIL: ' + fail);
  console.log(fail === 0 ? '✅ 全部冒烟测试通过' : '❌ 存在失败项');

  // 清理
  __resetPuaStateForTest();
  unregisterSkillHooks('pua-ext');

  process.exit(fail === 0 ? 0 : 1);
})();

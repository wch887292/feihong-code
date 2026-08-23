/**
 * planner 单元测试：验证目标拆分与过短片段合并（MIN_FRAGMENT_LEN 修复）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeGoal, planTask } from '../../src/agent/planner';

test('decomposeGoal: 空目标返回空数组', () => {
  assert.deepStrictEqual(decomposeGoal(''), []);
  assert.deepStrictEqual(decomposeGoal('   '), []);
});

test('decomposeGoal: 单句目标返回一个子任务', () => {
  const tasks = decomposeGoal('修复登录页面的样式问题');
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].goal, '修复登录页面的样式问题');
});

test('decomposeGoal: 多句目标按句号拆分（每段>=12字）', () => {
  const tasks = decomposeGoal('先读取项目的配置文件内容。然后修改其中的关键配置项。最后运行构建命令验证。');
  assert.ok(tasks.length >= 2, `应拆分为多个子任务，实际 ${tasks.length}`);
});

test('decomposeGoal: 过短片段合并回前一个（MIN_FRAGMENT_LEN 修复）', () => {
  // "先读取配置文件并且修改内容" — "修改内容" 只有4字 < 12，应合并
  const tasks = decomposeGoal('先读取配置文件并且修改内容');
  assert.strictEqual(tasks.length, 1, '过短片段应合并，不应拆成两个无意义子任务');
  assert.ok(tasks[0].goal.includes('读取配置文件'));
  assert.ok(tasks[0].goal.includes('修改内容'));
});

test('decomposeGoal: 足够长的片段正常拆分（每段>=12字）', () => {
  const tasks = decomposeGoal('实现完整的用户登录认证功能并且完善细粒度的权限验证模块');
  // 两段都 >= 12 字，应正常拆分
  assert.ok(tasks.length >= 2, `足够长的片段应正常拆分，实际 ${tasks.length}`);
});

test('decomposeGoal: 子任务包含 id/title/goal', () => {
  const tasks = decomposeGoal('做A。做B。');
  for (const t of tasks) {
    assert.ok(t.id, '应有 id');
    assert.ok(t.title, '应有 title');
    assert.ok(t.goal, '应有 goal');
  }
});

test('planTask: 返回固定四步计划', () => {
  const { messages, plan } = planTask('测试目标');
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].content, '测试目标');
  assert.strictEqual(plan.steps.length, 4);
});

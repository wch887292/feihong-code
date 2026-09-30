/**
 * planner 目标拆解单元测试
 * 覆盖 decomposeGoal 的核心行为（v8.5.0 重构后当前真实 API）。
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 说明：v8.5.0 重构后 firstPrinciplesDecompose / classifyDomain / buildWaves
 * 已被移除，目标拆解统一由 decomposeGoal 提供（返回 SubTask[]，字段 id/title/goal），
 * 子任务彼此独立、适合并行隔离执行。本测试对齐该真实实现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeGoal } from '../../src/agent/planner';

test('decomposeGoal: 空目标返回空数组', () => {
  assert.deepStrictEqual(decomposeGoal(''), []);
  assert.deepStrictEqual(decomposeGoal('   '), []);
});

test('decomposeGoal: 单句目标返回单一子任务', () => {
  const tasks = decomposeGoal('修复登录页面的样式问题');
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].id, 't1');
  assert.strictEqual(tasks[0].title, '主线任务');
  assert.strictEqual(tasks[0].goal, '修复登录页面的样式问题');
});

test('decomposeGoal: 句号分隔的多句目标拆分为多个子任务', () => {
  const tasks = decomposeGoal('修复登录页面的样式问题。实现完整的用户登录认证功能。');
  assert.ok(tasks.length >= 2, `应拆分为多个子任务，实际 ${tasks.length}`);
  assert.strictEqual(tasks[0].goal, '修复登录页面的样式问题');
  assert.strictEqual(tasks[1].goal, '实现完整的用户登录认证功能');
});

test('decomposeGoal: 分号分隔拆分为多个子任务', () => {
  const tasks = decomposeGoal('修复登录页面的样式问题；实现用户注册功能');
  assert.strictEqual(tasks.length, 2);
  assert.strictEqual(tasks[1].goal, '实现用户注册功能');
});

test('decomposeGoal: “并且”连接拆分为多个子任务', () => {
  const tasks = decomposeGoal('修复登录页面的样式问题 并且 实现用户注册功能');
  assert.strictEqual(tasks.length, 2);
  assert.strictEqual(tasks[0].goal, '修复登录页面的样式问题');
  assert.strictEqual(tasks[1].goal, '实现用户注册功能');
});

test('decomposeGoal: “同时”连接拆分为多个子任务', () => {
  const tasks = decomposeGoal('实现用户登录功能同时实现用户退出功能');
  assert.ok(tasks.length >= 2, `“同时”应触发拆分，实际 ${tasks.length}`);
});

test('decomposeGoal: 并列连词回退拆分（和/与/、）', () => {
  // 主分隔符不命中时，回退到“和/与/、”等并列连词再拆
  const tasks = decomposeGoal('实现登录功能并且实现注册功能');
  assert.strictEqual(tasks.length, 2);
});

test('decomposeGoal: 每个子任务具备 id/title/goal 字段', () => {
  const tasks = decomposeGoal('实现登录功能。实现注册功能。');
  assert.ok(tasks.length >= 2, `应为多子任务，实际 ${tasks.length}`);
  for (const t of tasks) {
    assert.ok(t.id, '应有 id');
    assert.ok(t.title, '应有 title');
    assert.ok(t.goal, '应有 goal');
    assert.strictEqual(typeof t.id, 'string');
    assert.strictEqual(typeof t.title, 'string');
    assert.strictEqual(typeof t.goal, 'string');
  }
});

test('decomposeGoal: 子任务 id 按 t1/t2/t3… 顺序编号', () => {
  const tasks = decomposeGoal('修复登录页面的样式问题。实现完整的用户注册功能。重构首页的导航栏结构。');
  const ids = tasks.map((t) => t.id);
  assert.deepStrictEqual(ids, ['t1', 't2', 't3']);
});

test('decomposeGoal: 过短续接片段被合并，不撕碎语义', () => {
  // “实现登录。先测试。再发布” 中“先测试/再发布”均 <5 字，应合并回前一句
  const tasks = decomposeGoal('实现登录。先测试。再发布');
  assert.strictEqual(tasks.length, 1);
  assert.ok(tasks[0].goal.includes('实现登录'));
});

test('decomposeGoal: 拆分出的子任务彼此独立，适合并行执行', () => {
  // 注释明确：生成的子任务目标彼此独立，适合并行隔离执行
  const tasks = decomposeGoal('实现用户登录功能。实现用户注册功能。实现用户退出功能。');
  assert.strictEqual(tasks.length, 3);
  const goals = tasks.map((t) => t.goal);
  assert.ok(goals.every((g) => g && g.length > 0));
  assert.strictEqual(new Set(goals).size, goals.length, '各子任务目标应互不重复');
});

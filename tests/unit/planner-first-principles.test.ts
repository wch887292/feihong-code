/**
 * planner 第一性原理拆解单元测试
 * 验证 firstPrinciplesDecompose 与 buildWaves 的核心行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstPrinciplesDecompose, classifyDomain } from '../../src/agent/planner';
import { buildWaves } from '../../src/agent/parallel-orchestrator';

test('firstPrinciplesDecompose: 空目标返回空数组', () => {
  assert.deepStrictEqual(firstPrinciplesDecompose(''), []);
  assert.deepStrictEqual(firstPrinciplesDecompose('   '), []);
});

test('firstPrinciplesDecompose: 单目标返回一个单元', () => {
  const units = firstPrinciplesDecompose('修复登录页面的样式问题');
  assert.strictEqual(units.length, 1);
  assert.strictEqual(units[0].goal, '修复登录页面的样式问题');
  assert.strictEqual(units[0].category, 'bugfix');
  assert.ok(units[0].domainTags.includes('bugfix'));
});

test('firstPrinciplesDecompose: 多句目标拆分为多个单元', () => {
  const units = firstPrinciplesDecompose('修复登录页面的样式问题。实现完整的用户登录认证功能。');
  assert.ok(units.length >= 2, `应拆分为多个单元，实际 ${units.length}`);
  // 第一个单元应为修复类，第二个应为实现类
  assert.strictEqual(units[0].category, 'bugfix');
  assert.strictEqual(units[1].category, 'feature');
});

test('firstPrinciplesDecompose: 每个单元有 id/title/goal/category/dependsOn/parallelizable/domainTags', () => {
  const units = firstPrinciplesDecompose('做A。做B。');
  for (const u of units) {
    assert.ok(u.id, '应有 id');
    assert.ok(u.title, '应有 title');
    assert.ok(u.goal, '应有 goal');
    assert.ok(typeof u.category === 'string');
    assert.ok(Array.isArray(u.dependsOn));
    assert.ok(typeof u.parallelizable === 'boolean');
    assert.ok(Array.isArray(u.domainTags));
  }
});

test('firstPrinciplesDecompose: 无耦合的独立单元 parallelizable 为 true', () => {
  // 修复登录页 + 实现注册功能：不同文件域、不同类别，应可并行
  const units = firstPrinciplesDecompose('修复登录页面的样式问题。实现用户注册功能。');
  // 两个单元应都标记为 parallelizable（无依赖）
  for (const u of units) {
    assert.ok(u.dependsOn.length === 0, `${u.title} 不应有依赖，实际 dependsOn=${JSON.stringify(u.dependsOn)}`);
  }
});

test('classifyDomain: 修复类识别', () => {
  const tags = classifyDomain('修复登录页面的样式问题');
  assert.ok(tags.includes('bugfix'));
});

test('classifyDomain: 实现类识别', () => {
  const tags = classifyDomain('实现用户注册功能');
  assert.ok(tags.includes('feature'));
});

test('classifyDomain: 重构类识别', () => {
  const tags = classifyDomain('重构登录模块的代码结构');
  assert.ok(tags.includes('refactor'));
});

test('classifyDomain: 识别不出领域时兜底为 general', () => {
  const tags = classifyDomain('做点什么');
  assert.ok(tags.includes('general'));
});

test('buildWaves: 空任务返回空波次', () => {
  const waves = buildWaves([]);
  assert.deepStrictEqual(waves, []);
});

test('buildWaves: 单任务返回一个波次', () => {
  const waves = buildWaves([{ id: 'a', dependsOn: [] }]);
  assert.strictEqual(waves.length, 1);
  assert.deepStrictEqual(waves[0].taskIds, ['a']);
});

test('buildWaves: 无依赖的多个任务在同一波次并行', () => {
  const waves = buildWaves([
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: [] },
    { id: 'c', dependsOn: [] },
  ]);
  assert.strictEqual(waves.length, 1);
  assert.strictEqual(waves[0].taskIds.length, 3);
});

test('buildWaves: 有依赖的任务分波次串行', () => {
  const waves = buildWaves([
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
  ]);
  assert.strictEqual(waves.length, 2);
  assert.deepStrictEqual(waves[0].taskIds, ['a']);
  assert.deepStrictEqual(waves[1].taskIds, ['b']);
});

test('buildWaves: 依赖成环时剔除环依赖不产生死锁', () => {
  // a→b→c→a 成环
  const waves = buildWaves([
    { id: 'a', dependsOn: ['c'] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
  ]);
  // 环被剔除后所有任务应在同一波次完成，不会死锁
  const allIds = waves.flatMap((w) => w.taskIds).sort();
  assert.deepStrictEqual(allIds, ['a', 'b', 'c']);
});

test('buildWaves: 悬空依赖（指向不存在任务）被忽略', () => {
  const waves = buildWaves([
    { id: 'a', dependsOn: ['nonexistent'] },
  ]);
  assert.strictEqual(waves.length, 1);
  assert.deepStrictEqual(waves[0].taskIds, ['a']);
});
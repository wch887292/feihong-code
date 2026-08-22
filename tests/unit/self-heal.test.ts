/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * /self-heal 技能单元测试：验证错误分类、验证命令建议与未知兜底。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSelfHeal } from '../../src/skills/self-heal';

test('self-heal: 编译错误分类', () => {
  const r = runSelfHeal('error TS2307: Cannot find module ./missing');
  assert.equal(r.known, true);
  assert.equal(r.category, 'compile-error');
  assert.ok(r.text.includes('编译错误'));
  assert.ok(r.text.includes('npm run build'));
});

test('self-heal: 运行时错误分类', () => {
  const r = runSelfHeal('TypeError: Cannot read property "name" of undefined');
  assert.equal(r.known, true);
  assert.equal(r.category, 'runtime-error');
  assert.ok(r.text.includes('运行时错误'));
});

test('self-heal: 超时分类', () => {
  const r = runSelfHeal('request timed out ETIMEDOUT');
  assert.equal(r.category, 'timeout');
  assert.ok(r.text.includes('超时'));
});

test('self-heal: 权限拒绝分类', () => {
  const r = runSelfHeal('EACCES: permission denied');
  assert.equal(r.category, 'permission-denied');
  assert.ok(r.text.includes('权限拒绝'));
});

test('self-heal: 模型错误分类', () => {
  const r = runSelfHeal('HTTP 429 rate limit exceeded');
  assert.equal(r.category, 'model-error');
  assert.ok(r.text.includes('模型调用错误'));
});

test('self-heal: 未知错误兜底为人工介入', () => {
  const r = runSelfHeal('某种神秘的量子波动错误');
  assert.equal(r.known, false);
  assert.equal(r.category, 'unknown');
  assert.ok(r.text.includes('需人工介入'));
});

test('self-heal: 上下文并入输出', () => {
  const r = runSelfHeal('syntax error', '运行 npm run build 时');
  assert.ok(r.text.includes('上下文: 运行 npm run build 时'));
});

test('self-heal: 空输入不崩溃', () => {
  const r = runSelfHeal('   ');
  assert.equal(r.known, false);
  assert.equal(r.category, 'unknown');
});

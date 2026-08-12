/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 命令行参数解析测试（覆盖 H3 --max-iterations 失效修复）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { parseArgs } from '../../src/cli/commands';

test('--max-iterations 正确解析（H3 修复）', () => {
  const r = parseArgs(['swe', '--max-iterations', '10']);
  assert.strictEqual(r.flags.maxIterations, 10);
  assert.strictEqual(r.manage?.kind, 'swe');
});

test('其它数字 flag 解析不受影响', () => {
  const r = parseArgs(['swe', '--max-tasks', '4', '--max-retries', '3', '--port', '8080']);
  assert.strictEqual(r.flags.maxTasks, 4);
  assert.strictEqual(r.flags.maxRetries, 3);
  assert.strictEqual(r.flags.port, 8080);
});

test('--max-iterations 非法值被忽略', () => {
  const r = parseArgs(['swe', '--max-iterations', 'abc']);
  assert.strictEqual(r.flags.maxIterations, undefined);
});

test('--max-iterations=N 等号形式也生效', () => {
  const r = parseArgs(['swe', '--max-iterations=7']);
  assert.strictEqual(r.flags.maxIterations, 7);
});

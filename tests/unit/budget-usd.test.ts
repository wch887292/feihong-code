/**
 * core/task-executor · resolveMaxCostUsd 单元测试
 * FH_BUDGET_USD 显式设置时应压过角色策略 maxCostUsd（此前变量只接到告警层，
 * orchestrator 仍被角色 $1 闸拦截——2026-10-01 qwen3 优化任务实测踩坑）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaxCostUsd } from '../../src/core/task-executor';

const ENV_KEY = 'FH_BUDGET_USD';

function withEnv(value: string | undefined, fn: () => void): void {
  const saved = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  }
}

test('resolveMaxCostUsd: FH_BUDGET_USD=100 覆盖角色策略 $1', () => {
  withEnv('100', () => {
    assert.strictEqual(resolveMaxCostUsd(1), 100);
  });
});

test('resolveMaxCostUsd: 未设置时回落角色策略值', () => {
  withEnv(undefined, () => {
    assert.strictEqual(resolveMaxCostUsd(1), 1);
    assert.strictEqual(resolveMaxCostUsd(5), 5);
  });
});

test('resolveMaxCostUsd: 非法值（非数字/负数/零）回落角色策略', () => {
  withEnv('abc', () => assert.strictEqual(resolveMaxCostUsd(1), 1));
  withEnv('-5', () => assert.strictEqual(resolveMaxCostUsd(1), 1));
  withEnv('0', () => assert.strictEqual(resolveMaxCostUsd(1), 1));
});

test('resolveMaxCostUsd: 角色值为 undefined 且无 env 时返回 0（=不限）', () => {
  withEnv(undefined, () => {
    assert.strictEqual(resolveMaxCostUsd(undefined), 0);
    assert.strictEqual(resolveMaxCostUsd(null), 0);
  });
});

test('resolveMaxCostUsd: 小数预算合法（如 0.5）', () => {
  withEnv('0.5', () => {
    assert.strictEqual(resolveMaxCostUsd(1), 0.5);
  });
});

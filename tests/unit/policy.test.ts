/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 策略引擎测试（RBAC + 危险命令黑名单 + 敏感路径，安全基线回归）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { evaluate, DEFAULT_POLICY, type EvalInput } from '../../src/enterprise/policy';

function input(p: Partial<EvalInput>): EvalInput {
  return {
    role: 'developer',
    tool: 'read_file',
    args: {},
    cwd: '/workspace',
    shellAllowlist: [],
    ...p,
  };
}

test('developer 调用 run_tests 直接允许', () => {
  const d = evaluate(DEFAULT_POLICY, input({ tool: 'run_tests' }));
  assert.strictEqual(d.effect, 'allow');
});

test('viewer 调用 write_file 被 RBAC 拒绝', () => {
  const d = evaluate(DEFAULT_POLICY, input({ role: 'viewer', tool: 'write_file' }));
  assert.strictEqual(d.effect, 'deny');
  assert.strictEqual(d.rule, 'rbac');
});

test('run_shell 危险命令被 denyShell 拒绝（admin 也不例外）', () => {
  const d = evaluate(DEFAULT_POLICY, input({ role: 'admin', tool: 'run_shell', args: { command: 'rm -rf /' } }));
  assert.strictEqual(d.effect, 'deny');
  assert.strictEqual(d.rule, 'denyShell');
});

test('developer 调 run_shell 非白名单需审批', () => {
  const d = evaluate(DEFAULT_POLICY, input({ tool: 'run_shell', args: { command: 'ls' } }));
  assert.strictEqual(d.effect, 'approval');
});

test('敏感路径 .env 被拒绝', () => {
  const d = evaluate(DEFAULT_POLICY, input({ tool: 'read_file', args: { path: '.env' } }));
  assert.strictEqual(d.effect, 'deny');
  assert.strictEqual(d.rule, 'denyPaths');
});

/**
 * agent/self-heal 单元测试：验证错误分类、unknown 兜底与新增规则
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../../src/agent/self-heal';

test('classifyError: 编译错误分类', () => {
  const r = classifyError('error TS2307: Cannot find module ./missing', '');
  assert.strictEqual(r.category, 'compile-error');
});

test('classifyError: 运行时错误分类', () => {
  const r = classifyError('TypeError: Cannot read property name of undefined', '');
  assert.strictEqual(r.category, 'runtime-error');
});

test('classifyError: file-not-found 分类（新增规则）', () => {
  const r = classifyError('ENOENT: no such file or directory /foo/bar', '');
  assert.strictEqual(r.category, 'file-not-found');
});

test('classifyError: build-error 分类（新增规则）', () => {
  const r = classifyError('npm error Missing script: build', '');
  assert.strictEqual(r.category, 'build-error');
});

test('classifyError: command-not-found 分类（新增规则）', () => {
  const r = classifyError('git is not recognized as an internal or external command', '');
  assert.strictEqual(r.category, 'command-not-found');
});

test('classifyError: invalid-args 分类（新增规则）', () => {
  const r = classifyError('Invalid arguments: expected string got number', '');
  assert.strictEqual(r.category, 'invalid-args');
});

test('classifyError: 未知错误返回 unknown 兜底（永不返回 null）', () => {
  const r = classifyError('某种完全未知的量子波动错误 xyz123', '');
  assert.strictEqual(r.category, 'unknown');
  assert.ok(r.fixHint.length > 0, 'unknown 也应提供修复建议');
});

test('classifyError: 空输入不崩溃，返回 unknown', () => {
  const r = classifyError('', '');
  assert.strictEqual(r.category, 'unknown');
});

test('classifyError: 返回值始终包含 category/message/fixHint', () => {
  const r = classifyError('any error', '');
  assert.ok('category' in r);
  assert.ok('message' in r);
  assert.ok('fixHint' in r);
  assert.ok(typeof r.category === 'string');
});

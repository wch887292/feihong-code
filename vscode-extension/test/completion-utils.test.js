'use strict';
/**
 * 飞虹 Code 扩展补全纯函数单测（P4-1）
 * 运行：node --test vscode-extension/test/completion-utils.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');
const {
  stripCodeFences,
  trimTrailingPartialLine,
  dedupeAgainstSuffix,
  postProcessCompletion,
} = require('../completion-utils');

test('stripCodeFences 去除代码围栏', () => {
  const input = '```js\nconst x = 1;\n```';
  assert.strictEqual(stripCodeFences(input), 'const x = 1;');
});

test('stripCodeFences 无围栏时原样返回', () => {
  const input = 'const x = 1;';
  assert.strictEqual(stripCodeFences(input), input);
});

test('trimTrailingPartialLine 剔除未闭合短行', () => {
  const input = 'const a = 1;\nunfinished';
  assert.strictEqual(trimTrailingPartialLine(input), 'const a = 1;');
});

test('trimTrailingPartialLine 保留已闭合行', () => {
  const input = 'const a = 1;';
  assert.strictEqual(trimTrailingPartialLine(input), input);
});

test('dedupeAgainstSuffix 去除与后缀重复的前缀', () => {
  const text = ');\nfoo();';
  const suffix = ');\nfoo(); // existing';
  assert.strictEqual(dedupeAgainstSuffix(text, suffix), '');
});

test('dedupeAgainstSuffix 无重复时原样返回', () => {
  assert.strictEqual(dedupeAgainstSuffix('bar();', 'baz();'), 'bar();');
});

test('postProcessCompletion 全流程：围栏+去重+裁剪', () => {
  const content = 'function f() {\n';
  const offset = content.length;
  const raw = '```js\n  return 1;\n```';
  const out = postProcessCompletion(raw, content, offset);
  assert.strictEqual(out, '  return 1;');
});

test('postProcessCompletion 空输入返回空串', () => {
  assert.strictEqual(postProcessCompletion('', 'x', 0), '');
});

test('postProcessCompletion 支持 {suffix} 对象形式（服务端复用）', () => {
  // suffix 以补全结果开头 → 视为重复，返回空
  const out = postProcessCompletion('foo();', { suffix: 'foo(); // more' });
  assert.strictEqual(out, '');
});

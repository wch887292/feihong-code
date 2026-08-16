/**
 * P2-2 子代理摘要返回单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：短结果原样返回 / 长结果截断+标注 / 截断边界 / 空串
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSubTaskAnswer, SUBAGENT_SUMMARY_MAX } from '../../src/agent/subagent-summary';

test('summarizeSubTaskAnswer: 短结果原样返回（不截断）', () => {
  const short = '已完成任务：添加了登录接口并通过测试。';
  const r = summarizeSubTaskAnswer(short);
  assert.equal(r.text, short);
  assert.equal(r.truncated, false);
  assert.equal(r.originalLength, short.length);
});

test('summarizeSubTaskAnswer: 长结果截断并标注原文长度', () => {
  const long = 'x'.repeat(SUBAGENT_SUMMARY_MAX + 500);
  const r = summarizeSubTaskAnswer(long);
  assert.equal(r.truncated, true);
  assert.equal(r.originalLength, SUBAGENT_SUMMARY_MAX + 500);
  assert.match(r.text, /已截断/);
  assert.match(r.text, /100 字符/);
  assert.ok(r.text.length < SUBAGENT_SUMMARY_MAX + 200, '摘要不应远超上限');
});

test('summarizeSubTaskAnswer: 恰好等于上限不截断', () => {
  const exact = 'y'.repeat(SUBAGENT_SUMMARY_MAX);
  const r = summarizeSubTaskAnswer(exact);
  assert.equal(r.truncated, false);
  assert.equal(r.text, exact);
});

test('summarizeSubTaskAnswer: 空串与自定义上限', () => {
  assert.equal(summarizeSubTaskAnswer('').text, '');
  const r = summarizeSubTaskAnswer('hello world', 5);
  assert.equal(r.truncated, true);
  assert.ok(r.text.startsWith('hello'));
});

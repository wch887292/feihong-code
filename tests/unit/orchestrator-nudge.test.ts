/**
 * orchestrator 完成协议单元测试：「叙述即完成」缺陷回归（2026-10-05）
 *
 * 缺陷：免费小模型首轮只输出计划性文字（如「我将创建项目…」）不调工具，
 * 旧逻辑把纯文本当最终答案结束任务，实际未做任何工作。
 * 修复：resolveNoToolCall 完成协议判定 + nudge 引导。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFinalAnswer,
  resolveNoToolCall,
  buildTextOnlyNudgeMessage,
} from '../../src/agent/orchestrator';

test('resolveNoToolCall: 首轮纯文本且无文件改动 → 注入 nudge 继续', () => {
  const r = resolveNoToolCall('我将创建项目，首先规划目录结构', 0, 0);
  assert.strictEqual(r.action, 'nudge');
});

test('resolveNoToolCall: 连续 3 次 nudge 后仍纯文本 → 接受为最终答案（防死循环）', () => {
  const r = resolveNoToolCall('我会继续努力的', 0, 3);
  assert.strictEqual(r.action, 'finish');
  assert.ok(r.action === 'finish' && r.finalAnswer.length >= 0);
});

test('resolveNoToolCall: FINAL: 前缀纯文本 → 直接结束且剥离前缀', () => {
  const r = resolveNoToolCall('FINAL: 已完成全部修改，测试通过', 0, 0);
  assert.strictEqual(r.action, 'finish');
  if (r.action === 'finish') {
    assert.strictEqual(r.finalAnswer, '已完成全部修改，测试通过');
  }
});

test('resolveNoToolCall: 已有工具执行后的纯文本 → 维持原完成语义', () => {
  const r = resolveNoToolCall('任务完成，共修改 3 个文件', 3, 0);
  assert.strictEqual(r.action, 'finish');
});

test('resolveNoToolCall: 空文本且无文件改动 → nudge（不该把空串当完成）', () => {
  const r = resolveNoToolCall('', 0, 0);
  assert.strictEqual(r.action, 'nudge');
});

test('extractFinalAnswer: 剥离 FINAL: 前缀（大小写不敏感、含换行）', () => {
  assert.strictEqual(extractFinalAnswer('final: done'), 'done');
  assert.strictEqual(extractFinalAnswer('FINAL:\n多行总结第一行'), '多行总结第一行');
  assert.strictEqual(extractFinalAnswer('Final:  混合大小写'), '混合大小写');
});

test('extractFinalAnswer: 剥离 think 标签（思考模型兼容）', () => {
  assert.strictEqual(extractFinalAnswer('<think>推理过程…</think>FINAL: 结论'), '结论');
  assert.strictEqual(extractFinalAnswer('<think>成对标签</think>普通答案'), '普通答案');
  // 未闭合 think：剥标签保留正文（可能是忘写闭合标签的真实答案，不宜整段丢弃）
  assert.strictEqual(extractFinalAnswer('<think>被截断未闭合的思考'), '被截断未闭合的思考');
});

test('buildTextOnlyNudgeMessage: 含工具名与 FINAL: 协议说明', () => {
  const m = buildTextOnlyNudgeMessage('我先说说计划');
  assert.ok(m.includes('write_file'), '应引导调用写文件工具');
  assert.ok(m.includes('run_shell'), '应引导调用 shell 工具');
  assert.ok(m.includes('FINAL:'), '应说明 FINAL: 完成协议');
  assert.ok(m.includes('我先说说计划'), '应引用模型原文');
});

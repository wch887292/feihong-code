/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 上下文压缩测试（覆盖 H4 系统指令丢失修复）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { compactContext } from '../../src/agent/context-compactor';
import type { ChatMessage } from '../../src/models/model.interface';

function makeMessages(): ChatMessage[] {
  const sys: ChatMessage = {
    role: 'system',
    content: '你是飞虹 Code，核心指令：必须保护系统安全与用户数据。',
  };
  const msgs: ChatMessage[] = [sys];
  for (let i = 0; i < 30; i++) {
    msgs.push({ role: 'user', content: `第${i}轮需求` });
    msgs.push({ role: 'assistant', content: `第${i}轮回答` });
  }
  return msgs;
}

test('compactContext 始终保留原 system 指令（H4 修复）', () => {
  const { messages } = compactContext(makeMessages(), 10);
  assert.strictEqual(messages[0].role, 'system');
  assert.ok((messages[0].content as string).includes('必须保护系统安全'));
});

test('compactContext 压缩后消息数减少且统计有效', () => {
  const { messages, stats } = compactContext(makeMessages(), 10);
  assert.ok(messages.length < 61, `期望压缩，实际 ${messages.length}`);
  assert.ok(stats.compressedRounds > 0, 'compressedRounds 应大于 0');
  assert.ok(stats.compressedLength > 0);
});

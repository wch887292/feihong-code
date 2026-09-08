/**
 * P3 steer() 中途纠偏单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySteerQueue, createSteerQueue } from '../../src/agent/steer';

test('steer: push 后 drain 取出并清空', () => {
  const q = new InMemorySteerQueue();
  assert.equal(q.size(), 0);
  const msg = q.push({ message: '改方向', focus: '只改 src/' });
  assert.ok(msg.id);
  assert.equal(msg.message, '改方向');
  assert.equal(msg.focus, '只改 src/');
  assert.ok(msg.pushedAt);
  assert.equal(q.size(), 1);

  const drained = q.drain();
  assert.equal(drained.length, 1);
  assert.equal(drained[0].message, '改方向');
  assert.equal(q.size(), 0, 'drain 后应清空');
});

test('steer: 多次 push 按 FIFO 顺序取出', () => {
  const q = createSteerQueue();
  q.push({ message: '第一条' });
  q.push({ message: '第二条' });
  q.push({ message: '第三条' });
  assert.equal(q.size(), 3);

  const drained = q.drain();
  assert.equal(drained.length, 3);
  assert.equal(drained[0].message, '第一条');
  assert.equal(drained[1].message, '第二条');
  assert.equal(drained[2].message, '第三条');
});

test('steer: 空队列 drain 返回空数组', () => {
  const q = new InMemorySteerQueue();
  const drained = q.drain();
  assert.equal(drained.length, 0);
  assert.equal(q.size(), 0);
});

test('steer: push 可自定义 id', () => {
  const q = new InMemorySteerQueue();
  const msg = q.push({ id: 'custom-123', message: '自定义 id' });
  assert.equal(msg.id, 'custom-123');
  const drained = q.drain();
  assert.equal(drained[0].id, 'custom-123');
});

test('steer: drain 后再 push 不影响已取出的消息', () => {
  const q = new InMemorySteerQueue();
  q.push({ message: '第一批' });
  const first = q.drain();
  assert.equal(first.length, 1);

  q.push({ message: '第二批' });
  const second = q.drain();
  assert.equal(second.length, 1);
  assert.equal(second[0].message, '第二批');
  assert.equal(first[0].message, '第一批', '已取出的消息不应被修改');
});

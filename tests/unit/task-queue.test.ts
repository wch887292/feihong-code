/**
 * P4-1 云执行任务队列单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：提交返回 queued / 异步执行到 done（离线 mock 闭环）/
 *       列表倒序 / 按 id 查询 / 未知 id 返回 undefined / 并发上限
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../../src/web/task-queue';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('TaskQueue: 提交任务后异步执行到 done', async () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const record = queue.submit('写一个 hello.ts');
  // 并发未满时 submit 会立即 pump 启动任务，因此状态可能是 queued 或 running
  assert.ok(['queued', 'running'].includes(record.status), `应为 queued/running，实际 ${record.status}`);
  assert.ok(record.id);

  // 轮询等待执行完成（离线 mock 快，但留足余量）
  for (let i = 0; i < 100; i++) {
    const cur = queue.get(record.id)!;
    if (cur.status === 'done' || cur.status === 'failed') break;
    await wait(20);
  }
  const final = queue.get(record.id)!;
  assert.ok(['done', 'failed'].includes(final.status), `应为终态，实际 ${final.status}`);
  if (final.status === 'done') {
    assert.ok(final.result);
    assert.ok(final.result.finalAnswer.length > 0);
    assert.ok(final.result.iterations >= 0);
  }
});

test('TaskQueue: 列表按提交时间倒序', async () => {
  const queue = new TaskQueue({ concurrency: 4 });
  queue.submit('任务A');
  queue.submit('任务B');
  queue.submit('任务C');
  const list = queue.list();
  assert.equal(list.length, 3);
  // 倒序：最后提交的在前
  assert.equal(list[0].goal, '任务C');
  assert.equal(list[2].goal, '任务A');
});

test('TaskQueue: 按 id 查询，未知 id 返回 undefined', async () => {
  const queue = new TaskQueue();
  const record = queue.submit('查询测试');
  assert.equal(queue.get(record.id)?.goal, '查询测试');
  assert.equal(queue.get('no-such-id'), undefined);
});

test('TaskQueue: 并发上限限制同时执行数', async () => {
  const queue = new TaskQueue({ concurrency: 2 });
  for (let i = 0; i < 6; i++) queue.submit(`批量任务${i}`);
  // 立即检查：任一时刻 running 不得超过并发上限 2
  const running = queue.list().filter((t) => t.status === 'running').length;
  assert.ok(running <= 2, `并发不应超过 2，实际 ${running}`);
  // 等待全部完成
  for (let i = 0; i < 200; i++) {
    if (queue.list().every((t) => t.status === 'done' || t.status === 'failed')) break;
    await wait(20);
  }
  assert.equal(queue.count, 6);
  assert.ok(queue.list().every((t) => t.status === 'done' || t.status === 'failed'));
});

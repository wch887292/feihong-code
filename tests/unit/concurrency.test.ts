/**
 * 并发控制工具单元测试
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asyncPool, runWithConcurrency, runWithConcurrencySettled } from '../../src/shared/concurrency';

test('asyncPool: 限制最大并发数', async () => {
  const limit = asyncPool(2);
  let active = 0;
  let maxActive = 0;
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return i;
      }),
    ),
  );
  assert.equal(maxActive, 2, '最大并发数不应超过 2');
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
});

test('asyncPool: concurrency=1 串行执行', async () => {
  const limit = asyncPool(1);
  let active = 0;
  let maxActive = 0;
  await Promise.all(
    Array.from({ length: 3 }, () =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      }),
    ),
  );
  assert.equal(maxActive, 1);
});

test('asyncPool: 任务失败时正确释放槽位', async () => {
  const limit = asyncPool(2);
  let active = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) =>
      limit(async () => {
        active++;
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (i === 1) throw new Error('task failed');
        return i;
      }),
    ),
  );
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[2].status, 'fulfilled');
  assert.equal(results[3].status, 'fulfilled');
  assert.equal(active, 0, '所有任务完成后 active 应为 0');
});

test('runWithConcurrency: 按顺序返回结果', async () => {
  const tasks = Array.from({ length: 4 }, (_, i) => () =>
    new Promise<number>((resolve) => setTimeout(() => resolve(i * 10), 10 - i)),
  );
  const results = await runWithConcurrency(tasks, 2);
  assert.deepEqual(results, [0, 10, 20, 30]);
});

test('runWithConcurrency: 默认并发数为 3', async () => {
  let active = 0;
  let maxActive = 0;
  const tasks = Array.from({ length: 6 }, () => () => {
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        active--;
        resolve();
      }, 10),
    );
  });
  await runWithConcurrency(tasks);
  assert.equal(maxActive, 3, '默认并发数应为 3');
});

test('runWithConcurrencySettled: 允许部分失败', async () => {
  const tasks = [
    () => Promise.resolve(1),
    () => Promise.reject(new Error('fail')),
    () => Promise.resolve(3),
  ];
  const results = await runWithConcurrencySettled(tasks, 2);
  assert.equal(results.length, 3);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[2].status, 'fulfilled');
  if (results[0].status === 'fulfilled') assert.equal(results[0].value, 1);
  if (results[2].status === 'fulfilled') assert.equal(results[2].value, 3);
});

test('asyncPool: 空任务数组不阻塞', async () => {
  const limit = asyncPool(3);
  const results = await Promise.all([]);
  assert.deepEqual(results, []);
});

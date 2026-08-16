/**
 * P5-2 调度入口 webhook 单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：webhook 状态回调（queued/running/done 触发）/
 *       setWebhookUrl 动态注册 / 无 webhook 时不回调 / webhook 失败不阻断任务
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { TaskQueue } from '../../src/web/task-queue';

let server: Server;
let baseUrl = '';
const received: Array<{ event: string; status: string; goal: string }> = [];

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        received.push({ event: p.event, status: p.task?.status, goal: p.task?.goal });
      } catch {
        /* ignore */
      }
      res.statusCode = 200;
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

after(() => {
  server?.close();
});

test('TaskQueue: webhook 在任务生命周期触发状态回调', async () => {
  received.length = 0;
  const queue = new TaskQueue({ concurrency: 1, webhookUrl: baseUrl });
  queue.submit('webhook 测试任务');

  // 等待任务完成（离线 mock 快）
  for (let i = 0; i < 100; i++) {
    if (received.some((r) => r.status === 'done' || r.status === 'failed')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const statuses = received.map((r) => r.status);
  assert.ok(statuses.includes('queued'), `应触发 queued 回调，实际 ${statuses}`);
  assert.ok(statuses.includes('running'), `应触发 running 回调，实际 ${statuses}`);
  assert.ok(statuses.some((s) => s === 'done' || s === 'failed'), `应触发终态回调，实际 ${statuses}`);
  assert.ok(received.every((r) => r.goal === 'webhook 测试任务'));
});

test('TaskQueue: setWebhookUrl 动态注册后生效', async () => {
  received.length = 0;
  const queue = new TaskQueue({ concurrency: 1 }); // 初始无 webhook
  queue.submit('未注册阶段');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(received.length, 0, '未注册 webhook 时不应回调');

  queue.setWebhookUrl(baseUrl);
  queue.submit('注册后任务');
  for (let i = 0; i < 100; i++) {
    if (received.some((r) => r.goal === '注册后任务')) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(received.some((r) => r.goal === '注册后任务'), '注册后应触发回调');
});

test('TaskQueue: webhook 目标不可达不阻断任务执行', async () => {
  const queue = new TaskQueue({ concurrency: 1, webhookUrl: 'http://127.0.0.1:1/none' }); // 端口 1 必然失败
  const record = queue.submit('webhook 失败任务');
  // 任务应正常完成（webhook 失败仅告警）
  for (let i = 0; i < 100; i++) {
    const cur = queue.get(record.id)!;
    if (cur.status === 'done' || cur.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const final = queue.get(record.id)!;
  assert.equal(final.status, 'done', 'webhook 失败不应影响任务完成');
  assert.ok(final.result);
});

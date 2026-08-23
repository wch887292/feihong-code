/**
 * P6-4 跨进程任务队列单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：持久化落盘（每任务一文件）/ 新实例恢复（queued 重新入队执行）/
 *       running 僵尸任务重启后标记 failed / 终态保留可查询 / clearPersisted 清理
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TaskQueue, type TaskRecord } from '../../src/web/task-queue';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('TaskQueue: 提交任务后落盘（每任务一文件，原子写）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-persist-'));
  try {
    const queue = new TaskQueue({ concurrency: 1, persistDir: dir, offline: true });
    const record = queue.submit('持久化任务');
    // 等待终态
    for (let i = 0; i < 100; i++) {
      if (queue.get(record.id)!.status !== 'queued' && queue.get(record.id)!.status !== 'running') break;
      await wait(20);
    }
    const file = join(dir, `${record.id}.json`);
    assert.ok(existsSync(file), '任务文件应落盘');
    const disk = JSON.parse(readFileSync(file, 'utf8')) as TaskRecord;
    assert.equal(disk.id, record.id);
    assert.ok(['done', 'failed'].includes(disk.status), `终态落盘，实际 ${disk.status}`);
    assert.ok(!existsSync(file + '.tmp'), '不应残留 tmp 半写文件');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TaskQueue: 新实例恢复——queued 任务重新入队并执行', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-persist-'));
  try {
    // 手工构造一个 queued 记录文件（模拟另一个进程写入后退出）
    const id = 'recover-queued';
    const record: TaskRecord = {
      id,
      goal: '恢复队列任务',
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(record), 'utf8');

    // 新实例：应恢复该任务并自动执行到终态
    const queue = new TaskQueue({ concurrency: 1, persistDir: dir, offline: true });
    assert.equal(queue.count, 1);
    for (let i = 0; i < 100; i++) {
      if (queue.get(id)!.status === 'done' || queue.get(id)!.status === 'failed') break;
      await wait(20);
    }
    const final = queue.get(id)!;
    assert.ok(['done', 'failed'].includes(final.status), `恢复后应执行到终态，实际 ${final.status}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TaskQueue: running 僵尸任务重启后标记 failed（防僵尸）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-persist-'));
  try {
    // 模拟上次进程崩溃遗留的 running 记录
    const id = 'zombie-running';
    const record: TaskRecord = {
      id,
      goal: '僵尸任务',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(record), 'utf8');

    const queue = new TaskQueue({ concurrency: 1, persistDir: dir, offline: true });
    const zombie = queue.get(id)!;
    assert.equal(zombie.status, 'failed', 'running 僵尸应被标记 failed');
    assert.match(zombie.error ?? '', /进程重启/);
    // 磁盘上也同步为 failed
    const disk = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as TaskRecord;
    assert.equal(disk.status, 'failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TaskQueue: clearPersisted 清理任务文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-persist-'));
  try {
    const queue = new TaskQueue({ concurrency: 1, persistDir: dir, offline: true });
    const record = queue.submit('清理测试');
    assert.ok(existsSync(join(dir, `${record.id}.json`)));
    queue.clearPersisted(record.id);
    assert.ok(!existsSync(join(dir, `${record.id}.json`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TaskQueue: 未配置 persistDir 时纯内存不落盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-persist-'));
  try {
    const queue = new TaskQueue({ concurrency: 1, offline: true }); // 无 persistDir
    queue.submit('内存任务');
    await wait(50);
    assert.equal(readdirSync(dir).length, 0, '无 persistDir 不应写任何文件');
    assert.ok(queue.count >= 1, '任务仍在内存中');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

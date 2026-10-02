/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P3 Routines 测试（T3.1-T3.6，共 13 用例）：
 * cron 解析 / 事件触发 / 持久化 / 补偿 / 互斥与并发上限 / 失败退避
 * 隔离策略：每组用例独立临时目录 + 可控时钟 + 可控 runner。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { nextCronRun, parseCron } from '../../src/runtime/routines/cron';
import {
  RoutineScheduler,
  type RoutineDef,
  type RoutineRunner,
  type TriggerKind,
} from '../../src/runtime/routines/scheduler';

const rootDir = mkdtempSync(join(tmpdir(), 'fhcode-routines-'));
let dirSeq = 0;

function freshDir(): string {
  return join(rootDir, `s${++dirSeq}`);
}

/** 可控时钟 */
function makeClock(initial: Date): { now: () => Date; set: (d: Date) => void } {
  let current = new Date(initial.getTime());
  return { now: () => new Date(current.getTime()), set: (d: Date) => (current = new Date(d.getTime())) };
}

/** 可控 runner：默认立即成功并记录；deferred=true 时挂起等手动放行（并发/互斥测试用） */
function makeRunner(deferred = false): {
  runner: RoutineRunner;
  calls: Array<{ id: string; trigger: TriggerKind }>;
  resolvers: Array<(v: { ok: boolean; output?: string }) => void>;
  releaseAll: (ok?: boolean) => void;
} {
  const calls: Array<{ id: string; trigger: TriggerKind }> = [];
  const resolvers: Array<(v: { ok: boolean; output?: string }) => void> = [];
  const runner: RoutineRunner = async (def, trigger) => {
    calls.push({ id: def.id, trigger });
    if (!deferred) return true;
    return new Promise((resolve) => resolvers.push(resolve));
  };
  return {
    runner,
    calls,
    resolvers,
    releaseAll: (ok = true) => {
      while (resolvers.length) resolvers.shift()!({ ok });
    },
  };
}

const base = new Date(2026, 9, 2, 10, 0, 0, 0); // 2026-10-02 10:00 本地时间

// ---------- T3.1 cron 解析 ----------

test('T3.1a 每分钟与步进：下一分钟精确（秒清零）', () => {
  const from = new Date(2026, 9, 2, 10, 7, 30);
  const next = nextCronRun('* * * * *', from)!;
  assert.deepStrictEqual(
    [next.getHours(), next.getMinutes(), next.getSeconds()],
    [10, 8, 0],
  );

  const next15 = nextCronRun('*/15 * * * *', new Date(2026, 9, 2, 10, 7, 0))!;
  assert.deepStrictEqual(
    [next15.getHours(), next15.getMinutes()],
    [10, 15],
  );
});

test('T3.1b 跨日与指定周几：次日 08:30 与下周一', () => {
  const nextDay = nextCronRun('30 8 * * *', new Date(2026, 9, 2, 10, 0, 0))!;
  assert.deepStrictEqual(
    [nextDay.getMonth() + 1, nextDay.getDate(), nextDay.getHours(), nextDay.getMinutes()],
    [10, 3, 8, 30],
  );

  // 2026-10-05 是周一；从周一 10:00 出发 → 下周一 09:00
  const nextMon = nextCronRun('0 9 * * 1', new Date(2026, 9, 5, 10, 0, 0))!;
  assert.strictEqual(nextMon.getDay(), 1);
  assert.deepStrictEqual([nextMon.getDate(), nextMon.getHours()], [12, 9]);
});

test('T3.1c 跨月与闰年：31 号跳过小月、2 月 29 四年一次', () => {
  // 11 月只有 30 天：从 11-01 出发 → 12-31 12:00
  const dec31 = nextCronRun('0 12 31 * *', new Date(2026, 10, 1, 0, 0, 0))!;
  assert.deepStrictEqual(
    [dec31.getMonth() + 1, dec31.getDate(), dec31.getHours()],
    [12, 31, 12],
  );
  // 2027 无 2/29：直接跳到 2028-02-29
  const leap = nextCronRun('0 0 29 2 *', new Date(2027, 0, 1, 0, 0, 0))!;
  assert.deepStrictEqual(
    [leap.getFullYear(), leap.getMonth() + 1, leap.getDate()],
    [2028, 2, 29],
  );
  // 非法表达式在 addDef 前即被 parseCron 拒绝
  assert.throws(() => parseCron('61 * * * *'), /非法/);
});

// ---------- T3.2 事件触发 ----------

test('T3.2a notifyEvent 匹配事件型 routine 并派发', async () => {
  const dir = freshDir();
  const clock = makeClock(base);
  const r = makeRunner();
  const s = new RoutineScheduler({ dir, runner: r.runner, now: clock.now });
  s.addDef({ id: 'ev1', name: '测试失败即修复', trigger: { kind: 'event', event: 'test.failed' }, action: { type: 'noop' }, enabled: true });
  const results = await s.notifyEvent('test.failed');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].routineId, 'ev1');
  assert.strictEqual(results[0].trigger, 'event');
  assert.strictEqual(r.calls[0].trigger, 'event');
  s.stop();
});

test('T3.2b 事件不匹配 / 已禁用 → 不触发', async () => {
  const dir = freshDir();
  const clock = makeClock(base);
  const r = makeRunner();
  const s = new RoutineScheduler({ dir, runner: r.runner, now: clock.now });
  s.addDef({ id: 'ev2', name: '只听 test.failed', trigger: { kind: 'event', event: 'test.failed' }, action: { type: 'noop' }, enabled: true });
  s.addDef({ id: 'ev3', name: '已禁用', trigger: { kind: 'event', event: 'build.broken' }, action: { type: 'noop' }, enabled: false });
  await s.notifyEvent('build.broken');
  await s.notifyEvent('deploy.done');
  assert.strictEqual(r.calls.length, 0, '不匹配与禁用的都不应触发');
  s.stop();
});

// ---------- T3.3 持久化 ----------

test('T3.3a 定义持久化：跨调度器实例恢复', () => {
  const dir = freshDir();
  const clock = makeClock(base);
  const s1 = new RoutineScheduler({ dir, now: clock.now });
  s1.addDef({ id: 'persist1', name: '每日巡检', trigger: { kind: 'cron', expr: '0 8 * * *' }, action: { type: 'noop' }, enabled: true });
  s1.addDef({ id: 'persist2', name: '事件例程', trigger: { kind: 'event', event: 'x' }, action: { type: 'noop' }, enabled: true });
  s1.stop();

  const s2 = new RoutineScheduler({ dir, now: clock.now });
  const ids = s2.listDefs().map((d) => d.id).sort();
  assert.deepStrictEqual(ids, ['persist1', 'persist2']);
  s2.stop();
});

test('T3.3b 运行状态持久化：lastRun/nextRun 跨实例保留', async () => {
  const dir = freshDir();
  const clock = makeClock(new Date(2026, 9, 2, 7, 59, 0));
  const okRunner: RoutineRunner = async () => true;
  const s1 = new RoutineScheduler({ dir, runner: okRunner, now: clock.now });
  s1.addDef({ id: 'job1', name: '每分钟任务', trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'noop' }, enabled: true });
  clock.set(new Date(2026, 9, 2, 8, 0, 0));
  await s1.tick();
  const before = s1.getState('job1');
  assert.strictEqual(before.lastStatus, 'ok');
  assert.ok(before.lastRunAt);
  assert.ok(before.nextRunAt && new Date(before.nextRunAt) > new Date(2026, 9, 2, 8, 0, 0));
  s1.stop();

  const s2 = new RoutineScheduler({ dir, runner: okRunner, now: clock.now });
  const after = s2.getState('job1');
  assert.strictEqual(after.lastRunAt, before.lastRunAt, 'lastRunAt 应持久化');
  assert.strictEqual(after.nextRunAt, before.nextRunAt, 'nextRunAt 应持久化且不重置');
  s2.stop();
});

// ---------- T3.4 补偿执行 ----------

test('T3.4a 错过窗口：重启后补跑一次（trigger=catchup）', async () => {
  const dir = freshDir();
  const clock = makeClock(new Date(2026, 9, 2, 9, 59, 0));
  const s1 = new RoutineScheduler({ dir, now: clock.now });
  s1.addDef({ id: 'catch1', name: '每小时任务', trigger: { kind: 'cron', expr: '0 * * * *' }, action: { type: 'noop' }, enabled: true });
  s1.stop();
  // 关机 10 小时后恢复
  const clock2 = makeClock(new Date(2026, 9, 2, 19, 30, 0));
  const r = makeRunner();
  const s2 = new RoutineScheduler({ dir, runner: r.runner, now: clock2.now });
  assert.strictEqual(s2.getState('catch1').missFlag, true, 'load 时应置补偿标记');
  await s2.tick();
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(r.calls[0].trigger, 'catchup');
  const st = s2.getState('catch1');
  assert.strictEqual(st.missFlag, false);
  assert.ok(st.nextRunAt && new Date(st.nextRunAt) > new Date(2026, 9, 2, 19, 30, 0), 'nextRunAt 应推进到未来');
  s2.stop();
});

test('T3.4b 补跑不重复；catchUp=false 直接推进不补跑', async () => {
  const dir = freshDir();
  const s1 = new RoutineScheduler({ dir, now: () => new Date(2026, 9, 2, 9, 59, 0) });
  s1.addDef({ id: 'c1', name: '补跑例程', trigger: { kind: 'cron', expr: '0 * * * *' }, action: { type: 'noop' }, enabled: true });
  s1.stop();

  const r = makeRunner();
  const s2 = new RoutineScheduler({ dir, runner: r.runner, now: () => new Date(2026, 9, 2, 19, 30, 0) });
  await s2.tick();
  await s2.tick();
  await s2.tick();
  assert.strictEqual(r.calls.filter((c) => c.id === 'c1').length, 1, '补跑恰好一次，不重复');

  // catchUp=false：错过只推进，不补跑
  const dir2 = freshDir();
  const s3 = new RoutineScheduler({ dir: dir2, now: () => new Date(2026, 9, 2, 9, 59, 0) });
  s3.addDef({ id: 'c2', name: '不补跑例程', trigger: { kind: 'cron', expr: '0 * * * *' }, action: { type: 'noop' }, enabled: true, catchUp: false });
  s3.stop();
  const r2 = makeRunner();
  const s4 = new RoutineScheduler({ dir: dir2, runner: r2.runner, now: () => new Date(2026, 9, 2, 19, 30, 0) });
  await s4.tick();
  assert.strictEqual(r2.calls.filter((c) => c.id === 'c2').length, 0, 'catchUp=false 不补跑');
  assert.ok(s4.getState('c2').nextRunAt && new Date(s4.getState('c2').nextRunAt!) > new Date(2026, 9, 2, 19, 30, 0));
  s2.stop();
  s4.stop();
});

// ---------- T3.5 互斥与并发上限 ----------

test('T3.5a 同一 routine 运行中不重入（互斥）', async () => {
  const dir = freshDir();
  const clock = makeClock(new Date(2026, 9, 2, 9, 59, 0));
  const r = makeRunner(true);
  const s = new RoutineScheduler({ dir, runner: r.runner, now: clock.now, maxConcurrent: 5 });
  s.addDef({ id: 'mutex1', name: '每分钟任务', trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'noop' }, enabled: true });
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  await s.tick(clock.now(), { awaitSettle: false });
  assert.strictEqual(r.calls.length, 1);
  await s.tick(clock.now(), { awaitSettle: false });
  assert.strictEqual(r.calls.length, 1, '运行中再次 tick 不应重入');
  r.releaseAll(true);
  await s.idle();
  s.stop();
});

test('T3.5b 全局并发上限：cap=2 时三个到期任务先派发两个', async () => {
  const dir = freshDir();
  const clock = makeClock(new Date(2026, 9, 2, 9, 58, 0));
  const r = makeRunner(true);
  const s = new RoutineScheduler({ dir, runner: r.runner, now: clock.now, maxConcurrent: 2 });
  const defs: Array<Omit<RoutineDef, 'createdAt'>> = ['p1', 'p2', 'p3'].map((id) => ({
    id,
    name: id,
    trigger: { kind: 'cron', expr: '* * * * *' },
    action: { type: 'noop' },
    enabled: true,
  }));
  for (const d of defs) s.addDef(d);
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  await s.tick(clock.now(), { awaitSettle: false });
  assert.strictEqual(r.calls.length, 2, '并发上限内只派发两个');
  r.resolvers.shift()!({ ok: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await s.tick(clock.now(), { awaitSettle: false });
  assert.strictEqual(r.calls.length, 3, '腾出容量后第三个被派发');
  r.releaseAll(true);
  await s.idle();
  s.stop();
});

// ---------- T3.6 失败退避 ----------

test('T3.6a 失败进入退避：到期前不重试，到期后以 retry 触发，成功归零', async () => {
  const dir = freshDir();
  const clock = makeClock(new Date(2026, 9, 2, 9, 59, 0));
  let shouldFail = true;
  const s = new RoutineScheduler({
    dir,
    now: clock.now,
    maxConcurrent: 5,
    runner: async () => !shouldFail,
  });
  s.addDef({
    id: 'retry1',
    name: '退避例程',
    trigger: { kind: 'cron', expr: '* * * * *' },
    action: { type: 'noop' },
    enabled: true,
    maxRetries: 3,
    backoffBaseSec: 10,
  });
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  await s.tick();
  let st = s.getState('retry1');
  assert.strictEqual(st.lastStatus, 'failed');
  assert.strictEqual(st.failCount, 1);
  assert.strictEqual(new Date(st.nextRetryAt!).getTime(), new Date(2026, 9, 2, 10, 0, 10).getTime(), '首次退避 = base * 2^0 = 10s');

  clock.set(new Date(2026, 9, 2, 10, 0, 5));
  await s.tick();
  assert.strictEqual(s.getState('retry1').failCount, 1, '退避期内不重试');

  clock.set(new Date(2026, 9, 2, 10, 0, 10));
  shouldFail = false;
  await s.tick();
  st = s.getState('retry1');
  assert.strictEqual(st.lastStatus, 'ok');
  assert.strictEqual(st.failCount, 0, '成功后计数归零');
  assert.strictEqual(st.nextRetryAt, undefined);
  s.stop();
});

test('T3.6b 指数退避间隔与 maxRetries 用尽停止', async () => {
  const dir = freshDir();
  const clock = makeClock(new Date(2026, 9, 2, 9, 59, 0));
  const s = new RoutineScheduler({ dir, now: clock.now, maxConcurrent: 5, runner: async () => false });
  s.addDef({
    id: 'retry2',
    name: '始终失败',
    trigger: { kind: 'cron', expr: '* * * * *' },
    action: { type: 'noop' },
    enabled: true,
    maxRetries: 2,
    backoffBaseSec: 10,
  });
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  await s.tick(); // 第 1 次失败 → +10s
  assert.strictEqual(new Date(s.getState('retry2').nextRetryAt!).getTime(), new Date(2026, 9, 2, 10, 0, 10).getTime());

  clock.set(new Date(2026, 9, 2, 10, 0, 10));
  await s.tick(); // retry 第 2 次失败 → +20s（指数）
  assert.strictEqual(new Date(s.getState('retry2').nextRetryAt!).getTime(), new Date(2026, 9, 2, 10, 0, 30).getTime());

  clock.set(new Date(2026, 9, 2, 10, 0, 30));
  await s.tick(); // retry 第 3 次（failCount=3 > maxRetries=2）→ 不再排重试
  const st = s.getState('retry2');
  assert.strictEqual(st.failCount, 3);
  assert.strictEqual(st.nextRetryAt, undefined, '重试额度用尽，停止自动重试');
  s.stop();
});

process.on('exit', () => {
  try {
    rmSync(rootDir, { recursive: true, force: true });
  } catch {
    /* Windows 锁容忍 */
  }
});

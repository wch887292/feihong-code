/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P3 Routines 端到端验证（全离线，不产生任何模型费用）。
 * 覆盖：cron 解析/下一次触发/宏 / 定义与状态持久化 / cron·事件·补偿·重试触发 /
 *       互斥 / 并发上限 / 退避与重试额度 / 禁用语义。
 *
 * 用法: npm run build && node scripts/verify-routines.mjs
 */
import { createRequire } from 'module';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const { parseCron, nextCronRun } = require('../dist/runtime/routines/cron.js');
const { RoutineScheduler } = require('../dist/runtime/routines/scheduler.js');

let pass = 0;
let fail = 0;
const results = [];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      results.push(`  ✅ ${name}`);
    })
    .catch((e) => {
      fail += 1;
      results.push(`  ❌ ${name} — ${e && e.message ? e.message : e}`);
    });
}

const root = mkdtempSync(join(tmpdir(), 'fhcode-verify-routines-'));
let seq = 0;
const freshDir = () => join(root, `s${++seq}`);

const BASE = new Date(2026, 9, 2, 10, 0, 0, 0);
const makeClock = (d) => {
  let cur = new Date(d.getTime());
  return { now: () => new Date(cur.getTime()), set: (x) => (cur = new Date(x.getTime())) };
};

/* ========== cron 引擎（1-7） ========== */

await check('V1 parseCron 合法五字段表达式', () => {
  const f = parseCron('*/15 8-18 1,15 * 1-5');
  if (f.minutes.size !== 4 || f.hours.size !== 11 || f.dows.size !== 5) throw new Error('字段展开不符');
});

await check('V2 parseCron 拒绝非法表达式', () => {
  let threw = false;
  try { parseCron('61 * * * *'); } catch { threw = true; }
  if (!threw) throw new Error('越界数值未拒绝');
});

await check('V3 nextCronRun 每分钟 +1 分钟且秒清零', () => {
  const n = nextCronRun('* * * * *', new Date(2026, 9, 2, 10, 7, 30));
  if (n.getHours() !== 10 || n.getMinutes() !== 8 || n.getSeconds() !== 0) throw new Error(`得到 ${n}`);
});

await check('V4 nextCronRun 每日 08:30 跨日', () => {
  const n = nextCronRun('30 8 * * *', new Date(2026, 9, 2, 10, 0, 0));
  if (n.getDate() !== 3 || n.getHours() !== 8 || n.getMinutes() !== 30) throw new Error(`得到 ${n}`);
});

await check('V5 nextCronRun 步进 */15 从 10:07 → 10:15', () => {
  const n = nextCronRun('*/15 * * * *', new Date(2026, 9, 2, 10, 7, 0));
  if (n.getMinutes() !== 15) throw new Error(`得到 ${n}`);
});

await check('V6 nextCronRun 月末跳过小月（11-01 → 12-31）', () => {
  const n = nextCronRun('0 12 31 * *', new Date(2026, 10, 1, 0, 0, 0));
  if (n.getMonth() !== 11 || n.getDate() !== 31) throw new Error(`得到 ${n}`);
});

await check('V7 宏 @daily 等价 0 0 * * *', () => {
  const a = nextCronRun('@daily', new Date(2026, 9, 2, 10, 0, 0));
  const b = nextCronRun('0 0 * * *', new Date(2026, 9, 2, 10, 0, 0));
  if (a.getTime() !== b.getTime()) throw new Error('宏展开不一致');
});

/* ========== 调度引擎（8-18） ========== */

await check('V8 addDef/listDefs 往返 + id 冲突拒绝', () => {
  const s = new RoutineScheduler({ dir: freshDir(), now: () => new Date(BASE) });
  s.addDef({ id: 'a1', name: 'x', trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'noop' }, enabled: true });
  if (s.listDefs().length !== 1) throw new Error('list 数量不对');
  try { s.addDef({ id: 'a1', name: 'dup', trigger: { kind: 'event', event: 'e' }, action: { type: 'noop' }, enabled: true }); throw new Error('重复 id 未拒绝'); }
  catch (e) { if (!String(e.message).includes('已存在')) throw e; }
});

await check('V9 removeDef 生效且返回布尔', () => {
  const s = new RoutineScheduler({ dir: freshDir(), now: () => new Date(BASE) });
  s.addDef({ id: 'a2', name: 'x', trigger: { kind: 'event', event: 'e' }, action: { type: 'noop' }, enabled: true });
  if (s.removeDef('a2') !== true || s.removeDef('a2') !== false) throw new Error('removeDef 返回值异常');
  if (s.listDefs().length !== 0) throw new Error('删除后仍有残留');
});

await check('V10 setEnabled 禁用后事件不触发', async () => {
  const s = new RoutineScheduler({ dir: freshDir(), now: () => new Date(BASE), runner: async () => true });
  s.addDef({ id: 'a3', name: 'x', trigger: { kind: 'event', event: 'go' }, action: { type: 'noop' }, enabled: true });
  s.setEnabled('a3', false);
  const r = await s.notifyEvent('go');
  if (r.length !== 0) throw new Error('禁用后仍触发');
});

await check('V11 cron 到期触发并推进 nextRunAt', async () => {
  const clock = makeClock(new Date(2026, 9, 2, 9, 59, 0));
  let ran = 0;
  const s = new RoutineScheduler({ dir: freshDir(), now: clock.now, runner: async () => { ran += 1; return true; } });
  s.addDef({ id: 'c1', name: 'x', trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'noop' }, enabled: true });
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  await s.tick();
  if (ran !== 1) throw new Error(`ran=${ran}`);
  const st = s.getState('c1');
  if (st.lastStatus !== 'ok' || new Date(st.nextRunAt) <= new Date(2026, 9, 2, 10, 0, 0)) throw new Error('nextRunAt 未推进');
});

await check('V12 事件触发端到端', async () => {
  let ran = 0;
  const s = new RoutineScheduler({ dir: freshDir(), now: () => new Date(BASE), runner: async () => { ran += 1; return true; } });
  s.addDef({ id: 'e1', name: 'x', trigger: { kind: 'event', event: 'test.failed' }, action: { type: 'noop' }, enabled: true });
  await s.notifyEvent('test.failed');
  if (ran !== 1) throw new Error(`ran=${ran}`);
});

await check('V13 错过窗口补偿：重启后 catchup 恰好一次', async () => {
  const dir = freshDir();
  const s1 = new RoutineScheduler({ dir, now: () => new Date(2026, 9, 2, 9, 59, 0) });
  s1.addDef({ id: 'cu', name: 'x', trigger: { kind: 'cron', expr: '0 * * * *' }, action: { type: 'noop' }, enabled: true });
  let ran = 0;
  const s2 = new RoutineScheduler({ dir, now: () => new Date(2026, 9, 2, 19, 30, 0), runner: async () => { ran += 1; return true; } });
  await s2.tick();
  await s2.tick();
  if (ran !== 1) throw new Error(`补跑次数=${ran}`);
});

await check('V14 catchUp=false 不补跑但推进', async () => {
  const dir = freshDir();
  const s1 = new RoutineScheduler({ dir, now: () => new Date(2026, 9, 2, 9, 59, 0) });
  s1.addDef({ id: 'nc', name: 'x', trigger: { kind: 'cron', expr: '0 * * * *' }, action: { type: 'noop' }, enabled: true, catchUp: false });
  let ran = 0;
  const s2 = new RoutineScheduler({ dir, now: () => new Date(2026, 9, 2, 19, 30, 0), runner: async () => { ran += 1; return true; } });
  await s2.tick();
  if (ran !== 0) throw new Error(`不应补跑，ran=${ran}`);
  if (new Date(s2.getState('nc').nextRunAt) <= new Date(2026, 9, 2, 19, 30, 0)) throw new Error('nextRunAt 未推进');
});

await check('V15 运行中互斥：不重入', async () => {
  const clock = makeClock(new Date(2026, 9, 2, 9, 59, 0));
  let ran = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const s = new RoutineScheduler({ dir: freshDir(), now: clock.now, maxConcurrent: 5, runner: async () => { ran += 1; return gate; } });
  s.addDef({ id: 'm1', name: 'x', trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'noop' }, enabled: true });
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  const p = s.tick(clock.now(), { awaitSettle: false });
  await s.tick(clock.now(), { awaitSettle: false });
  if (ran !== 1) throw new Error(`互斥失败 ran=${ran}`);
  release(true);
  await s.idle();
  await p;
});

await check('V16 全局并发上限：cap=1 三个到期只派一个', async () => {
  const clock = makeClock(new Date(2026, 9, 2, 9, 58, 0));
  let ran = 0;
  const releases = [];
  const s = new RoutineScheduler({
    dir: freshDir(), now: clock.now, maxConcurrent: 1,
    runner: async () => { ran += 1; return new Promise((r) => releases.push(r)); },
  });
  for (const id of ['p1', 'p2', 'p3']) {
    s.addDef({ id, name: id, trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'noop' }, enabled: true });
  }
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  await s.tick(clock.now(), { awaitSettle: false });
  if (ran !== 1) throw new Error(`并发上限失效 ran=${ran}`);
  for (const r of releases) r(true);
  await s.idle();
});

await check('V17 失败退避：到期前不重试，指数间隔', async () => {
  const clock = makeClock(new Date(2026, 9, 2, 9, 59, 0));
  let ran = 0;
  const s = new RoutineScheduler({ dir: freshDir(), now: clock.now, maxConcurrent: 5, runner: async () => { ran += 1; return false; } });
  s.addDef({ id: 'b1', name: 'x', trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'noop' }, enabled: true, maxRetries: 3, backoffBaseSec: 10 });
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  await s.tick();
  clock.set(new Date(2026, 9, 2, 10, 0, 5));
  await s.tick();
  if (ran !== 1) throw new Error('退避期内不应重试');
  clock.set(new Date(2026, 9, 2, 10, 0, 10));
  await s.tick();
  if (ran !== 2) throw new Error('重试未发生');
  const st = s.getState('b1');
  if (new Date(st.nextRetryAt).getTime() !== new Date(2026, 9, 2, 10, 0, 30).getTime()) {
    throw new Error(`第二次退避应为 +20s，实际 ${st.nextRetryAt}`);
  }
});

await check('V18 maxRetries 用尽停止重试 + 状态跨实例持久化', async () => {
  const dir = freshDir();
  const clock = makeClock(new Date(2026, 9, 2, 9, 59, 0));
  const s1 = new RoutineScheduler({ dir, now: clock.now, maxConcurrent: 5, runner: async () => false });
  s1.addDef({ id: 'b2', name: 'x', trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'noop' }, enabled: true, maxRetries: 1, backoffBaseSec: 10 });
  clock.set(new Date(2026, 9, 2, 10, 0, 0));
  await s1.tick();
  clock.set(new Date(2026, 9, 2, 10, 0, 10));
  await s1.tick();
  if (s1.getState('b2').nextRetryAt !== undefined) throw new Error('重试额度用尽后仍排重试');
  const s2 = new RoutineScheduler({ dir, now: clock.now, runner: async () => true });
  const st = s2.getState('b2');
  if (st.lastStatus !== 'failed' || st.failCount !== 2) throw new Error('状态未跨实例持久化');
});

rmSync(root, { recursive: true, force: true });

console.log('P3 Routines 端到端验证');
console.log('----------------------------------------------------------');
for (const line of results) console.log(line);
console.log('----------------------------------------------------------');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹');
process.exit(fail > 0 ? 1 : 0);

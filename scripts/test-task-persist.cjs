/* v8.13.8 回归测试：任务历史持久化（localStorage 配额降级）
 * 目标：证明「大产物 base64 + 长对话」场景下，saveTasks 不再因配额溢出而全量丢失，
 *       且重开任务后历史对话仍在。
 * 用法：node scripts/test-task-persist.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'app-mobile', 'js', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

/* ---------- 迷你 localStorage（可模拟配额溢出） ---------- */
function makeStorage(quotaBytes) {
  const store = new Map();
  return {
    _quota: quotaBytes,
    _used: 0,
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) {
      const size = String(v).length * 2; // UTF-16 字节近似
      const old = store.has(k) ? String(store.get(k)).length * 2 : 0;
      if (this._used - old + size > this._quota) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      this._used += size - old;
      store.set(k, String(v));
    },
    removeItem(k) {
      if (store.has(k)) { this._used -= String(store.get(k)).length * 2; store.delete(k); }
    },
    clear() { store.clear(); this._used = 0; },
    _raw() { return Object.fromEntries(store); },
  };
}

/* ---------- 在 vm 里加载 app.js 的关键片段 ---------- */
function loadApp(storage, quota) {
  const sandbox = {
    localStorage: storage,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, String, Number, Array, Object, Boolean, RegExp, Error, Promise,
    document: { querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, addEventListener(){} }), body: { appendChild(){}, removeChild(){} } },
    window: {},
    fetch: () => Promise.reject(new Error('no network in test')),
    atob: () => '', URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob: function () {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // 只执行需要的函数定义：截取到 "初始化" 之前，避免 init 依赖 DOM
  const cut = src.indexOf('/* ========== 初始化 ========== */');
  const body = cut > 0 ? src.slice(0, cut) : src;
  vm.runInContext(body, sandbox, { filename: APP });
  return sandbox;
}

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}

/* ================= 场景 1：大 base64 产物不再撑爆存储 ================= */
console.log('\n[场景1] 产物 base64 内联 → 持久化瘦身（配额 1MB）');
{
  const storage = makeStorage(1024 * 1024);
  const app = loadApp(storage);
  // 模拟 v8.13.6 的行为：task.artifacts 里内联 base64
  const big = 'A'.repeat(300 * 1024); // 300KB base64
  app.state.tasks = [{
    id: 't1', goal: '做一个网站', type: 'chat', status: 'done', createdAt: new Date().toISOString(),
    messages: [
      { role: 'user', content: '做一个网站' },
      { role: 'assistant', content: '已完成，产物如下' },
    ],
    artifacts: [
      { relPath: 'index.html', name: 'index.html', size: 1200, kind: 'code', contentBase64: big },
    ],
  }];
  const saved = app.saveTasks();
  ok(saved === true, 'saveTasks 成功返回 true');
  const raw = storage.getItem('fh.app.tasks');
  ok(!!raw, 'localStorage 写入成功');
  ok(raw.indexOf(big) === -1, '持久化内容已剥离 base64（体积根除）');
  const parsed = JSON.parse(raw);
  ok(parsed[0].messages.length === 2, '历史消息完整保留（2 条）');
  ok(parsed[0].messages[0].content === '做一个网站', '用户消息内容未丢失');
  ok(parsed[0].messages[1].content === '已完成，产物如下', '助手消息内容未丢失');
  ok(parsed[0].artifacts && parsed[0].artifacts.length === 1, '产物元数据保留');
  ok(parsed[0].artifacts[0].name === 'index.html', '产物文件名保留');
  ok(!('contentBase64' in parsed[0].artifacts[0]), '产物 contentBase64 未进存储');
}

/* ================= 场景 2：超配额时分级降级，历史不丢 ================= */
console.log('\n[场景2] 极端超配额（quota 40KB，20 个大任务）→ 分级降级保住最近历史');
{
  const storage = makeStorage(40 * 1024);
  const app = loadApp(storage);
  app.state.tasks = [];
  // 真实语义：createTask 用 state.tasks.unshift(task) → 最后创建的排在数组头部
  // 因此按时间顺序 0→19 依次 unshift 后，头部是最新任务 task19
  for (let i = 0; i < 20; i++) {
    app.state.tasks.unshift({
      id: 'task' + i, goal: '任务' + i, type: 'chat', status: 'done',
      createdAt: new Date().toISOString(),
      messages: [
        { role: 'user', content: '提问' + i + ' ' + 'x'.repeat(3000) },
        { role: 'assistant', content: '回答' + i + ' ' + 'y'.repeat(3000) },
      ],
    });
  }
  const saved = app.saveTasks();
  ok(saved === true, 'saveTasks 在超配额下仍成功（降级写入）');
  const raw = storage.getItem('fh.app.tasks');
  ok(!!raw, '降级后仍有数据落盘');
  const parsed = JSON.parse(raw);
  ok(parsed.length > 0, '降级后保留了至少 1 个任务，实际=' + parsed.length);
  ok(parsed.length < 20, '确实做了裁剪，实际保留=' + parsed.length);
  const last = parsed[0]; // 头部 = 最新
  ok(last.id === 'task19', '保留了最新的任务（task19）');
  ok(last.messages.length >= 1, '最新任务的消息未被清空');
  ok(last.messages[last.messages.length - 1].content.indexOf('回答19') === 0, '最新消息内容正确');
  // 关键：最新一次会话必须可读（这是用户报障的核心诉求）
  // 40KB 配额下装不下 20×6KB 对话，降到「每任务留最后 1 条」是合理降级；
  // 但必须保证「最新任务存在 + 有内容 + 不为空」
  ok(last.messages.length >= 1, '最新任务至少有 1 条消息可读');
  ok(last.messages[0].content.length > 0, '保留下来的消息内容非空');
}

/* ================= 场景 3：loadTasks 容错旧结构 ================= */
console.log('\n[场景3] 旧数据兼容（无 messages / messages 非数组）');
{
  const storage = makeStorage(1024 * 1024);
  storage.setItem('fh.app.tasks', JSON.stringify([
    { id: 'a', goal: '旧任务' },                                   // 无 messages
    { id: 'b', goal: '坏数据', messages: 'not-an-array' },          // messages 非数组
    { id: 'c', goal: '正常', messages: [{ role: 'user', content: 'hi' }] },
  ]));
  const app = loadApp(storage);
  app.loadTasks();
  ok(app.state.tasks.length === 3, '三条任务全部载入');
  ok(Array.isArray(app.state.tasks[0].messages), '缺失 messages 被补为空数组');
  ok(app.state.tasks[1].messages.length === 0, '非法 messages 被归一为空数组');
  ok(app.state.tasks[2].messages.length === 1, '正常消息不受影响');
  ok(!!app.state.tasks[0].createdAt, '缺失 createdAt 被补齐');
}

/* ================= 场景 4：在线判据统一 ================= */
console.log('\n[场景4] 两端在线判据统一（localPcOnline 与任务下发同源）');
{
  const storage = makeStorage(1024 * 1024);
  const app = loadApp(storage);
  app.state.tasks = [];
  // 场景 A：云端中继可达但家电脑心跳陈旧 → 应判离线（旧逻辑会显示「已连接」）
  app.connState.cloud = true;
  app.connState.local = true;      // 旧逻辑测的是「中继 URL 可达」→ 永远 true
  app.connState.homeOnline = false; // 家电脑真离线
  ok(app.localPcOnline() === false, '家电脑心跳陈旧 → 判离线（修复前会误判已连接）');

  // 场景 B：家电脑心跳新鲜 → 应判在线
  app.connState.homeOnline = true;
  ok(app.localPcOnline() === true, '家电脑心跳新鲜 → 判在线');

  // 场景 C：relay 模式下 homeOnline=false 时不得回退到 connState.local
  app.connState.homeOnline = false;
  app.getPcUrl = function () { return 'https://api.klai.top/fhrelay'; };
  ok(app.localPcOnline() === false, 'relay 模式不得用「中继可达」冒充家电脑在线');
}

/* ================= 场景 5：恢复上次会话 ================= */
console.log('\n[场景5] currentTaskId 持久化与恢复');
{
  const storage = makeStorage(1024 * 1024);
  const app = loadApp(storage);
  app.state.tasks = [{ id: 'last1', goal: '上次会话', type: 'chat', status: 'done', createdAt: new Date().toISOString(), messages: [{ role: 'user', content: '历史问题' }] }];
  app.setCurrentTask('last1');
  ok(storage.getItem('fh.app.currentTask') === 'last1', 'currentTaskId 已持久化');
  app.setCurrentTask(null);
  ok(storage.getItem('fh.app.currentTask') === null, '置 null 时已清除持久化');
}

/* ================= 汇总 ================= */
console.log('\n========== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);

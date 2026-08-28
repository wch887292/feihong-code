#!/usr/bin/env node
/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1-3 eval 跑分基准（本地 mock，离线可跑）：
 *  - 用 ScriptedMockProvider 驱动编排器跑一组标准场景
 *  - 统计：任务完成率 / 平均迭代数 / 工具调用数（工具效率）/ 自愈触发率
 *  - 复用 P0-1 onEvent 事件流计数，不依赖真实模型与网络
 *  - 输出报告表格；可加 --json 输出结构化结果（供后续横向对比）
 *
 * 用法：npm run build && node scripts/eval.mjs [--json]
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);
const __baseDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(__baseDir, '..', 'dist');

const { Orchestrator } = require(join(distDir, 'agent', 'orchestrator.js'));
const { ScriptedMockProvider } = require(join(distDir, 'models', 'providers', 'mock.provider.js'));
const { createDefaultRegistry } = require(join(distDir, 'tools', 'index.js'));
const { EventLog } = require(join(distDir, 'runtime', 'event-log.js'));
const { SessionStore } = require(join(distDir, 'runtime', 'session-store.js'));

const JSON_OUT = process.argv.includes('--json');

/** 标准场景定义：steps 为模型侧预设响应序列 */
const SCENARIOS = [
  {
    name: 'simple-answer',
    desc: '单轮直接回答（无工具）',
    steps: [{ message: { role: 'assistant', content: '任务完成：输出 hello', toolCalls: [] } }],
    expect: { ok: true, minToolCalls: 0 },
  },
  {
    name: 'single-tool',
    desc: '一次写文件完成',
    steps: [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 't1', name: 'write_file', arguments: { path: 'out.txt', content: 'ok' } }],
        },
      },
      { message: { role: 'assistant', content: '已完成写入', toolCalls: [] } },
    ],
    expect: { ok: true, minToolCalls: 1 },
  },
  {
    name: 'multi-tool',
    desc: '勘察→写→总结（多工具）',
    steps: [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 't1', name: 'list_dir', arguments: {} },
            { id: 't2', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } },
          ],
        },
      },
      { message: { role: 'assistant', content: '完成', toolCalls: [] } },
    ],
    expect: { ok: true, minToolCalls: 2 },
  },
  {
    name: 'self-heal',
    desc: '工具失败→自愈反思→成功',
    steps: [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 't1', name: 'write_file', arguments: { path: '../escape.txt', content: 'x' } }],
        },
      },
      { message: { role: 'assistant', content: '已修正路径并完成', toolCalls: [] } },
    ],
    expect: { ok: true, minToolCalls: 1, expectSelfHeal: true },
  },
  {
    name: 'no-tools',
    desc: '多轮但最终回答',
    steps: [
      { message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: 'nope.ts' } }] } },
      { message: { role: 'assistant', content: '文件不存在但任务继续', toolCalls: [] } },
    ],
    expect: { ok: true, minToolCalls: 1 },
  },
];

async function runScenario(scenario) {
  const runId = randomUUID();
  const logDir = mkdtempSync(join(tmpdir(), 'fhcode-eval-'));
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-eval-ws-'));

  const router = { chat: () => Promise.resolve(), getStats: () => [] }; // placeholder 会被下面覆盖
  const stats = { toolCalls: 0, selfHeals: 0 };

  const mockRouter = { chat: async () => mockChat(), getStats: () => [] };
  const provider = new ScriptedMockProvider(scenario.steps);
  mockRouter.chat = async (req) => provider.chat(req);

  try {
    const tools = createDefaultRegistry();
    const eventLog = new EventLog(runId, logDir);
    const session = new SessionStore(runId, cwd);
    const orch = new Orchestrator({
      router: mockRouter,
      tools,
      eventLog,
      session,
      cwd,
      security: { shellAllowlist: [], requireApproval: false },
      maxIterations: 6,
      maxCostUsd: 0,
      onEvent: (ev) => {
        if (ev.type === 'tool.result') stats.toolCalls++;
        if (ev.type === 'self-heal') stats.selfHeals++;
      },
    });
    const result = await orch.run(scenario.name);
    return {
      ok: result.ok,
      iterations: result.iterations,
      toolCalls: stats.toolCalls,
      selfHeals: stats.selfHeals,
      selfHealed: result.selfHealed ?? false,
      finalAnswer: result.finalAnswer.slice(0, 80),
    };
  } finally {
    rmSync(logDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * P6-2 验收型基准任务（SWE-bench 风格本地任务集）：
 *  - setup(cwd)     初始化仓库（可写起始文件）
 *  - steps          模型侧预设动作（驱动真实工具执行）
 *  - check(cwd)     验证**真实产物**（文件存在/内容/命令输出），不依赖 mock 结果
 * 这测的是「编排器 + 工具链 + 沙箱」端到端闭环，而非仅 mock 循环。
 */
const BENCH_TASKS = [
  {
    name: 'bench-write-module',
    desc: '验收: 写出含 add 函数的 calc.ts',
    setup: (cwd) => {
      const { mkdirSync } = require('fs');
      mkdirSync(join(cwd, 'src'), { recursive: true });
    },
    steps: [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 't1', name: 'write_file', arguments: { path: 'src/calc.ts', content: 'export function add(a: number, b: number): number { return a + b; }\n' } },
          ],
        },
      },
      { message: { role: 'assistant', content: '已写出 calc.ts', toolCalls: [] } },
    ],
    check: (cwd) => {
      const { existsSync, readFileSync } = require('fs');
      const f = join(cwd, 'src', 'calc.ts');
      if (!existsSync(f)) return '缺少 src/calc.ts';
      const content = readFileSync(f, 'utf8');
      if (!/export function add/.test(content)) return '未包含 add 函数';
      if (!/a \+ b/.test(content)) return 'add 实现不正确';
      return null;
    },
  },
  {
    name: 'bench-edit-file',
    desc: '验收: edit_file 精确替换',
    setup: (cwd) => {
      const { writeFileSync } = require('fs');
      writeFileSync(join(cwd, 'greet.txt'), 'hello world\n', 'utf8');
    },
    steps: [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 't1', name: 'edit_file', arguments: { path: 'greet.txt', oldText: 'hello', newText: 'hi' } },
          ],
        },
      },
      { message: { role: 'assistant', content: '已替换', toolCalls: [] } },
    ],
    check: (cwd) => {
      const { readFileSync } = require('fs');
      const content = readFileSync(join(cwd, 'greet.txt'), 'utf8');
      if (!content.startsWith('hi')) return `替换失败: ${content.trim()}`;
      return null;
    },
  },
  {
    name: 'bench-grep-write',
    desc: '验收: grep 定位后写入结果文件',
    setup: (cwd) => {
      const { writeFileSync } = require('fs');
      writeFileSync(join(cwd, 'config.json'), '{"port": 8080}\n', 'utf8');
    },
    steps: [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 't1', name: 'grep', arguments: { pattern: '8080', path: '.' } },
            { id: 't2', name: 'write_file', arguments: { path: 'port.txt', content: 'port=8080\n' } },
          ],
        },
      },
      { message: { role: 'assistant', content: '已记录端口', toolCalls: [] } },
    ],
    check: (cwd) => {
      const { existsSync, readFileSync } = require('fs');
      const f = join(cwd, 'port.txt');
      if (!existsSync(f)) return '缺少 port.txt';
      if (!/8080/.test(readFileSync(f, 'utf8'))) return 'port.txt 内容不含 8080';
      return null;
    },
  },
  {
    name: 'bench-shell-script',
    desc: '验收: run_shell 执行并产出文件',
    // 注：命令须避开 shell 注入防护元字符（;|&`$(){}<>!），cp 为无元字符真实命令
    setup: (cwd) => {
      const { writeFileSync } = require('fs');
      writeFileSync(join(cwd, 'src.txt'), 'built-ok', 'utf8');
    },
    steps: [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 't1', name: 'run_shell', arguments: { command: 'cp src.txt built.txt' } },
          ],
        },
      },
      { message: { role: 'assistant', content: '已执行脚本', toolCalls: [] } },
    ],
    check: (cwd) => {
      const { existsSync, readFileSync } = require('fs');
      const f = join(cwd, 'built.txt');
      if (!existsSync(f)) return 'run_shell 未产出 built.txt';
      if (readFileSync(f, 'utf8') !== 'built-ok') return 'built.txt 内容不符';
      return null;
    },
  },
  {
    name: 'bench-sandbox-guard',
    desc: '验收: 沙箱拦截越界写(read-only 生效)',
    sandboxMode: 'read-only',
    steps: [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 't1', name: 'write_file', arguments: { path: 'src/ok.ts', content: 'export const ok = 1;\n' } },
          ],
        },
      },
      { message: { role: 'assistant', content: '完成', toolCalls: [] } },
    ],
    check: (cwd) => {
      // 用 read-only 沙箱语义校验：本任务单独以 sandboxMode=read-only 运行，
      // 期望 write_file 被拦截（不产出文件）——通过 orchestrator 结果判定。
      const { existsSync } = require('fs');
      // 若文件被写出说明沙箱未拦截 → 失败
      if (existsSync(join(cwd, 'src', 'ok.ts'))) return 'read-only 沙箱未拦截 write_file';
      return null;
    },
  },
];

/** 运行验收型基准任务（真实工具 + 可选沙箱模式） */
async function runBenchTask(task) {
  const runId = randomUUID();
  const logDir = mkdtempSync(join(tmpdir(), 'fhcode-eval-'));
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-eval-ws-'));
  const stats = { toolCalls: 0, selfHeals: 0 };
  const provider = new ScriptedMockProvider(task.steps);
  const mockRouter = { chat: async (req) => provider.chat(req), getStats: () => [] };

  try {
    if (task.setup) task.setup(cwd);
    const tools = createDefaultRegistry();
    const eventLog = new EventLog(runId, logDir);
    const session = new SessionStore(runId, cwd);
    // 默认 workspace-write 正常执行；仅 bench-sandbox-guard 任务以 read-only 沙箱运行（验证拦截）
    const security = { shellAllowlist: [], requireApproval: false, sandboxMode: task.sandboxMode ?? 'workspace-write' };
    const orch = new Orchestrator({
      router: mockRouter,
      tools,
      eventLog,
      session,
      cwd,
      security,
      maxIterations: 6,
      maxCostUsd: 0,
      onEvent: (ev) => {
        if (ev.type === 'tool.result') stats.toolCalls++;
        if (ev.type === 'self-heal') stats.selfHeals++;
      },
    });
    const result = await orch.run(task.name);
    const checkErr = task.check ? task.check(cwd) : null;
    return {
      ok: result.ok && checkErr === null,
      iterations: result.iterations,
      toolCalls: stats.toolCalls,
      checkError: checkErr,
      finalAnswer: result.finalAnswer.slice(0, 80),
    };
  } finally {
    rmSync(logDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

function check(scenario, r) {
  const failures = [];
  if (r.ok !== scenario.expect.ok) failures.push(`ok=${r.ok} 期望 ${scenario.expect.ok}`);
  if (r.toolCalls < (scenario.expect.minToolCalls ?? 0)) failures.push(`工具调用 ${r.toolCalls} < ${scenario.expect.minToolCalls}`);
  if (scenario.expect.expectSelfHeal && !r.selfHealed) failures.push('期望触发自愈但未触发');
  return failures;
}

async function main() {
  console.log('=========== P6-2 eval 跑分基准（场景统计 + 验收型任务） ===========\n');

  // 第一部分：标准场景统计
  console.log('--- 场景统计（编排循环） ---');
  const results = [];
  let pass = 0;
  const fails = [];

  for (const sc of SCENARIOS) {
    const r = await runScenario(sc);
    const issues = check(sc, r);
    const ok = issues.length === 0;
    if (ok) pass++;
    else fails.push(`${sc.name}: ${issues.join('; ')}`);
    results.push({ kind: 'scenario', name: sc.name, ok, result: r });
    console.log(
      `  ${ok ? '✅' : '❌'} ${sc.name.padEnd(14)} ${sc.desc.padEnd(18)} ` +
        `ok=${r.ok ? 'Y' : 'N'} iter=${r.iterations} tools=${r.toolCalls} selfHeal=${r.selfHeals}`,
    );
    if (!ok) console.log(`        ${issues.join('; ')}`);
  }

  // 第二部分：验收型基准任务（真实产物验证）
  console.log('\n--- 验收型任务（SWE-bench 风格，验证真实产物） ---');
  for (const task of BENCH_TASKS) {
    const r = await runBenchTask(task);
    const ok = r.ok;
    if (ok) pass++;
    else fails.push(`${task.name}: ${r.checkError ?? '编排失败'}`);
    results.push({ kind: 'bench', name: task.name, ok, result: r });
    console.log(
      `  ${ok ? '✅' : '❌'} ${task.name.padEnd(22)} ${task.desc.padEnd(26)} ` +
        `iter=${r.iterations} tools=${r.toolCalls}${r.checkError ? `  ✗ ${r.checkError}` : ''}`,
    );
  }

  // 汇总指标（场景 + 验收合并）
  const total = results.length;
  const completionRate = pass / total;
  const scenarioStats = results.filter((r) => r.kind === 'scenario');
  const avgIterations = scenarioStats.reduce((s, r) => s + r.result.iterations, 0) / (scenarioStats.length || 1);
  const avgToolCalls = scenarioStats.reduce((s, r) => s + r.result.toolCalls, 0) / (scenarioStats.length || 1);
  const totalSelfHeals = scenarioStats.reduce((s, r) => s + r.result.selfHeals, 0);
  const selfHealRate = totalSelfHeals / (scenarioStats.length || 1);

  console.log('\n------------------------------------------');
  console.log(`通过 ${pass} 项，失败 ${total - pass} 项（场景 ${SCENARIOS.length} + 验收 ${BENCH_TASKS.length}）`);
  console.log(`整体通过率: ${(completionRate * 100).toFixed(0)}%`);
  console.log(`场景平均迭代: ${avgIterations.toFixed(1)} 轮`);
  console.log(`场景平均工具调用（工具效率）: ${avgToolCalls.toFixed(1)} 次/任务`);
  console.log(`场景自愈触发率: ${(selfHealRate * 100).toFixed(0)}%（共 ${totalSelfHeals} 次）`);

  if (JSON_OUT) {
    console.log('\n=== JSON ===');
    console.log(JSON.stringify({
      total,
      pass,
      completionRate,
      avgIterations,
      avgToolCalls,
      selfHealRate,
      scenarios: scenarioStats.map((r) => ({ name: r.name, ok: r.ok, result: r.result })),
      benchTasks: results.filter((r) => r.kind === 'bench').map((r) => ({ name: r.name, ok: r.ok, result: r.result })),
    }, null, 2));
  }

  // O2 回归门禁：基线 JSON 存档 + 对比（本次 pass 低于基线即失败，供 CI 使用）
  const summary = { total, pass, completionRate, timestamp: new Date().toISOString() };
  const baselinePath = argValue('--baseline');
  const savePath = argValue('--save-baseline');
  if (savePath) {
    try {
      writeFileSync(savePath, JSON.stringify(summary, null, 2), 'utf8');
      console.log(`\n[O2] 基线已存档: ${savePath}（pass=${pass}/${total}）`);
    } catch (e) {
      console.warn(`[O2] 基线存档失败: ${e.message}`);
    }
  }
  if (baselinePath && existsSync(baselinePath)) {
    try {
      const base = JSON.parse(readFileSync(baselinePath, 'utf8'));
      const basePass = Number(base.pass ?? -1);
      if (basePass >= 0 && pass < basePass) {
        console.error(`\n[O2] ❌ 回归门禁失败: 本次 pass=${pass}/${total} < 基线 ${basePass}/${base.total ?? '?'}（${baselinePath}）`);
        process.exitCode = 1;
      } else {
        console.log(`\n[O2] ✅ 回归门禁通过: pass=${pass}/${total}（基线 ${basePass}/${base.total ?? '?'}）`);
      }
    } catch (e) {
      console.warn(`[O2] 基线解析失败，跳过对比: ${e.message}`);
    }
  }

  console.log(`\n晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹`);
  process.exitCode = fails.length > 0 ? 1 : process.exitCode;
}

/** 从命令行参数取 --flag 的取值 */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

main().catch((e) => {
  console.error('eval 运行失败:', e);
  process.exit(1);
});

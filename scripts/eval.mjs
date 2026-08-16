#!/usr/bin/env node
/**
 * 飞虹 Code (Muse Code 参照复刻)
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
import { mkdtempSync, rmSync } from 'fs';
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

function check(scenario, r) {
  const failures = [];
  if (r.ok !== scenario.expect.ok) failures.push(`ok=${r.ok} 期望 ${scenario.expect.ok}`);
  if (r.toolCalls < (scenario.expect.minToolCalls ?? 0)) failures.push(`工具调用 ${r.toolCalls} < ${scenario.expect.minToolCalls}`);
  if (scenario.expect.expectSelfHeal && !r.selfHealed) failures.push('期望触发自愈但未触发');
  return failures;
}

async function main() {
  console.log('=========== P1-3 eval 跑分基准（本地 mock） ===========\n');
  const results = [];
  let pass = 0;
  const fails = [];

  for (const sc of SCENARIOS) {
    const r = await runScenario(sc);
    const issues = check(sc, r);
    const ok = issues.length === 0;
    if (ok) pass++;
    else fails.push(`${sc.name}: ${issues.join('; ')}`);
    results.push({ ...sc, result: r, ok });
    console.log(
      `  ${ok ? '✅' : '❌'} ${sc.name.padEnd(14)} ${sc.desc.padEnd(18)} ` +
        `ok=${r.ok ? 'Y' : 'N'} iter=${r.iterations} tools=${r.toolCalls} selfHeal=${r.selfHeals}`,
    );
    if (!ok) console.log(`        ${issues.join('; ')}`);
  }

  // 汇总指标
  const total = results.length;
  const completionRate = results.filter((r) => r.result.ok).length / total;
  const avgIterations = results.reduce((s, r) => s + r.result.iterations, 0) / total;
  const avgToolCalls = results.reduce((s, r) => s + r.result.toolCalls, 0) / total;
  const totalSelfHeals = results.reduce((s, r) => s + r.result.selfHeals, 0);
  const selfHealRate = totalSelfHeals / total;

  console.log('\n------------------------------------------');
  console.log(`通过 ${pass} 项，失败 ${total - pass} 项`);
  console.log(`完成率: ${(completionRate * 100).toFixed(0)}%`);
  console.log(`平均迭代: ${avgIterations.toFixed(1)} 轮`);
  console.log(`平均工具调用（工具效率）: ${avgToolCalls.toFixed(1)} 次/任务`);
  console.log(`自愈触发率: ${(selfHealRate * 100).toFixed(0)}%（共 ${totalSelfHeals} 次）`);

  if (JSON_OUT) {
    console.log('\n=== JSON ===');
    console.log(JSON.stringify({
      total,
      pass,
      completionRate,
      avgIterations,
      avgToolCalls,
      selfHealRate,
      scenarios: results.map((r) => ({ name: r.name, ok: r.ok, result: r.result })),
    }, null, 2));
  }

  console.log(`\n晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹`);
  process.exitCode = fails.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('eval 运行失败:', e);
  process.exit(1);
});

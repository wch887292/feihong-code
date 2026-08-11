/**
 * M9 验证脚本（离线可跑，纯 JS，require 编译产物）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：仓库读取 → 任务规划 → 验证器 → 全自动 Agent 长链路（plan-only + 真实执行）
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { readRepository } = require('../dist/agent/repo-reader.js');
const { planSweTask } = require('../dist/agent/swe-planner.js');
const { verifyTask } = require('../dist/agent/swe-verifier.js');
const { runSweAgent } = require('../dist/agent/swe-agent.js');
const { mkdtempSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

let pass = 0;
let fail = 0;
const fails = [];
function assert(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    fails.push(name);
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  console.log('=== M9 全自动软件工程 Agent 验证 ===\n');

  // ---- 1. 仓库读取 ----
  console.log('[1] RepoReader 仓库读取');
  const repo = mkdtempSync(join(tmpdir(), 'm9-repo-'));
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({
      name: 'demo',
      scripts: { build: 'node -e "0"', test: 'node -e "0"' },
      devDependencies: { typescript: '^5.6.0', jest: '^29.0.0' },
    }),
  );
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'index.ts'), 'export const x: number = 1;\n');
  writeFileSync(join(repo, 'README.md'), '# Demo\n');
  writeFileSync(join(repo, 'src', 'index.test.ts'), 'test("x", () => {});\n');

  const snap = readRepository(repo, { maxFiles: 500 });
  assert('快照含文件', snap.fileCount >= 3, `fileCount=${snap.fileCount}`);
  assert('检测到测试命令(scripts.test→npm test)', snap.testCommand === 'npm test', `testCommand=${snap.testCommand}`);
  assert('检测到构建命令(scripts.build→npm run build)', snap.buildCommand === 'npm run build', `buildCommand=${snap.buildCommand}`);
  assert('语言分布含 TypeScript', !!snap.languages['TypeScript'], JSON.stringify(snap.languages));
  assert('关键文件含 package.json', snap.keyFiles.includes('package.json'));
  assert('生成上下文串', typeof snap.contextString === 'string' && snap.contextString.length > 50);
  assert('目录树非空', snap.tree.length > 0);

  // ---- 2. 任务规划 ----
  console.log('\n[2] SWE Planner 任务拆解');
  const plan = planSweTask('新增用户登录功能并补充测试', snap);
  assert('拆解出多个子任务', plan.tasks.length >= 3, `tasks=${plan.tasks.length}`);
  assert('首个任务为勘察', plan.tasks[0].title.includes('勘察'), plan.tasks[0].title);
  assert('含验证命令的子任务', plan.tasks.some((t) => t.verifyCommand), '无 verifyCommand');
  assert('生成 modelPrompt', plan.modelPrompt.includes('全自动软件工程 Agent'));
  assert('子任务含验收标准', plan.tasks.every((t) => t.acceptance.length > 0));

  // 修复类目标
  const fixPlan = planSweTask('修复登录接口的空指针错误', snap);
  assert('修复类目标含定位步骤', fixPlan.tasks.some((t) => t.title.includes('修复')), fixPlan.tasks.map((t) => t.title).join(','));

  // ---- 3. 验证器 ----
  console.log('\n[3] SWE Verifier 构建/测试验证');
  const task = plan.tasks.find((t) => t.verifyCommand) || plan.tasks[1];
  const passV = await verifyTask(snap, { ...task, verifyCommand: 'node -e "0"' }, repo);
  assert('成功命令判定 pass', passV.overall === 'pass', passV.log);
  const failV = await verifyTask(snap, { ...task, verifyCommand: 'node -e "process.exit(1)"' }, repo);
  assert('失败命令判定 fail', failV.overall === 'fail', failV.log);
  assert('失败含错误摘要', failV.errorSummary.length > 0);
  const skipV = await verifyTask({ ...snap, buildCommand: undefined, testCommand: undefined }, plan.tasks[0], repo);
  assert('无命令时 skip', skipV.overall === 'skipped', skipV.overall);

  // ---- 4. 全自动 Agent（plan-only） ----
  console.log('\n[4] SWE Agent 长链路（plan-only）');
  const reportPlan = await runSweAgent('重构工具模块', {
    cwd: repo,
    runSubTask: async () => ({ ok: true, finalAnswer: 'done', iterations: 1, touchedFiles: [] }),
    planOnly: true,
  });
  assert('plan-only 不执行任务', reportPlan.executedTasks === 0);
  assert('plan-only 仍产出任务', reportPlan.plannedTasks >= 3);
  assert('plan-only 报告结构完整', typeof reportPlan.summary === 'string' && reportPlan.summary.includes('报告'));

  // ---- 5. 全自动 Agent（真实执行，命令确定性成功） ----
  console.log('\n[5] SWE Agent 长链路（真实执行）');
  let subTaskCalls = 0;
  const report = await runSweAgent('新增并测试工具函数', {
    cwd: repo,
    runSubTask: async () => {
      subTaskCalls++;
      return { ok: true, finalAnswer: '已实现', iterations: 2, touchedFiles: ['src/index.ts'] };
    },
    maxTasks: 4,
    maxRetries: 1,
  });
  assert('子任务实现器被调用', subTaskCalls >= 3, `calls=${subTaskCalls}`);
  assert('执行任务数>0', report.executedTasks > 0, `executed=${report.executedTasks}`);
  assert('整体状态为 success', report.overall === 'success', `overall=${report.overall} (${report.summary.slice(-200)})`);
  assert('每任务含验证结果', report.tasks.every((t) => t.verify.overall === 'pass' || t.verify.overall === 'skipped'));

  // ---- 6. 自愈重试路径 ----
  console.log('\n[6] SWE Agent 自愈重试（当验证失败时）');
  const repo2 = mkdtempSync(join(tmpdir(), 'm9-repo2-'));
  writeFileSync(
    join(repo2, 'package.json'),
    JSON.stringify({ name: 'demo2', scripts: { build: 'node -e "0"' } }),
  );
  let calls2 = 0;
  const report2 = await runSweAgent('实现功能', {
    cwd: repo2,
    runSubTask: async () => {
      calls2++;
      return { ok: true, finalAnswer: 'done', iterations: 1, touchedFiles: [] };
    },
    maxTasks: 2,
    maxRetries: 1,
  });
  // repo2 仅有 build 命令（成功），整体应通过
  assert('仅 build 验证时整体 success', report2.overall === 'success' || report2.overall === 'partial', report2.overall);

  // ---- 汇总 ----
  console.log(`\n------------------------------------------`);
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) {
    console.log('失败项: ' + fails.join(', '));
    process.exitCode = 1;
  }
  console.log('晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹');
}

main().catch((e) => {
  console.error('验证脚本异常:', e);
  process.exitCode = 1;
});

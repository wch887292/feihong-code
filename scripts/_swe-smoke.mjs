// SWE-bench harness 闭环冒烟评测（确定性，无需模型/网络）
// 验证 loader → executor → verifier → reporter 全链路真实可执行
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { LocalJsonLoader } = require('../dist/harness/loader.js');
const { MockOrchestratorExecutor } = require('../dist/harness/executor.js');
const { FileExistsVerifier } = require('../dist/harness/verifier.js');
const { Harness } = require('../dist/harness/harness.js');
const { JsonReporter } = require('../dist/harness/reporter.js');

const tmpDir = mkdtempSync(join(tmpdir(), 'fhcode-swe-smoke-'));
const dataFile = join(tmpDir, 'swe-smoke.json');

const instances = [
  {
    instance_id: 'smoke-001',
    repo: 'demo/repo',
    base_commit: 'abc123',
    problem_statement: '修复排序函数：当数组包含负数时排序结果错误，应正确升序排列。',
    patch: '',
    test_patch: '',
    FAIL_TO_PASS: ['test_sort_negative'],
    PASS_TO_PASS: ['test_sort_positive'],
  },
  {
    instance_id: 'smoke-002',
    repo: 'demo/repo',
    base_commit: 'def456',
    problem_statement: '修复缓存模块：key 存在时应返回缓存值而非每次重新计算。',
    patch: '',
    test_patch: '',
    FAIL_TO_PASS: ['test_cache_hit'],
    PASS_TO_PASS: ['test_cache_miss'],
  },
];
writeFileSync(dataFile, JSON.stringify(instances));

(async () => {
  const harness = new Harness({
    loader: new LocalJsonLoader(dataFile),
    executor: new MockOrchestratorExecutor(),
    verifier: new FileExistsVerifier(),
    reporter: new JsonReporter(),
    limit: 2,
    onProgress: (r, i, total) => {
      console.log(`  [${i}/${total}] ${r.instance_id}  runOk=${r.runOk} verified=${r.verified} ok=${r.ok}  iterations=${r.iterations} toolCalls=${r.toolCalls}`);
    },
  });
  const { report, rendered } = await harness.run();
  console.log('\n===== SWE harness 闭环冒烟结果 =====');
  console.log(`  数据集: ${report.meta.split}`);
  console.log(`  执行器: ${report.meta.mode}`);
  console.log(`  总计: ${report.summary.total}  通过: ${report.summary.completed}  通过率: ${(report.summary.rate * 100).toFixed(1)}%`);
  console.log('\n===== 渲染报告（JSON）=====');
  console.log(rendered);
  console.log('\n===== 结论 =====');
  console.log(report.summary.total === 2 && report.summary.completed === 2
    ? '  ✅ harness 闭环真实可执行：loader→executor→verifier→reporter 全链路通过'
    : '  ❌ 闭环异常，请检查');
})();

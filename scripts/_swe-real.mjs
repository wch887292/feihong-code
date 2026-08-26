// 真实模型 SWE harness 闭环实测（读 .env 配置的真实模型 agnes-2.5-flash）
// 诚实标注：验证"真实模型在 harness 循环中能否完成任务（生成率）"；
// 完整 SWE-bench 测试通过率需配 SWE-bench 数据集 + 测试环境（见 P0-1 说明）。
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { LocalJsonLoader } = require('../dist/harness/loader.js');
const { RealModelExecutor } = require('../dist/harness/executor.js');
const { Harness } = require('../dist/harness/harness.js');
const { JsonReporter } = require('../dist/harness/reporter.js');

const tmpDir = mkdtempSync(join(tmpdir(), 'fhcode-swe-real-'));
const dataFile = join(tmpDir, 'swe-real.json');

const instances = [
  {
    instance_id: 'real-001',
    repo: 'demo/repo',
    base_commit: 'a1',
    problem_statement:
      '实现一个 JavaScript 函数 maxOf(a, b)，返回两个参数中较大的值。请将完整实现写入文件 max.js（使用 module.exports = maxOf 导出）。',
    patch: '', test_patch: '',
    FAIL_TO_PASS: ['test_maxof'], PASS_TO_PASS: [],
  },
  {
    instance_id: 'real-002',
    repo: 'demo/repo',
    base_commit: 'a2',
    problem_statement:
      '实现 JavaScript 函数 fibonacci(n)，返回第 n 个斐波那契数（n 从 0 开始，fibonacci(0)=0, fibonacci(1)=1）。请将完整实现写入文件 fib.js（使用 module.exports = fibonacci 导出）。',
    patch: '', test_patch: '',
    FAIL_TO_PASS: ['test_fib'], PASS_TO_PASS: [],
  },
  {
    instance_id: 'real-003',
    repo: 'demo/repo',
    base_commit: 'a3',
    problem_statement:
      '实现 JavaScript 函数 isPalindrome(s)，判断字符串 s 是否是回文（忽略大小写与空白）。请将完整实现写入文件 palindrome.js（使用 module.exports = isPalindrome 导出）。',
    patch: '', test_patch: '',
    FAIL_TO_PASS: ['test_palindrome'], PASS_TO_PASS: [],
  },
];
writeFileSync(dataFile, JSON.stringify(instances));

// 按 instance_id 检查对应文件是否生成且非空
const FILE_MAP = { 'real-001': 'max.js', 'real-002': 'fib.js', 'real-003': 'palindrome.js' };
class MultiFileVerifier {
  constructor() { this.id = 'multi-file-exists'; }
  async verify(cwd, instance) {
    const f = FILE_MAP[instance.instance_id];
    if (!f) return false;
    const p = join(cwd, f);
    return existsSync(p) && readFileSync(p, 'utf8').trim().length > 0;
  }
}

(async () => {
  console.log('===== 真实模型 SWE harness 闭环实测（agnes-2.5-flash）=====');
  const harness = new Harness({
    loader: new LocalJsonLoader(dataFile),
    executor: new RealModelExecutor({ maxIterations: 5 }),
    verifier: new MultiFileVerifier(),
    reporter: new JsonReporter(),
    limit: 3,
    onProgress: (r, i, total) => {
      console.log(`  [${i}/${total}] ${r.instance_id}  ok=${r.ok}  iterations=${r.iterations} toolCalls=${r.toolCalls}`);
    },
  });
  try {
    const { report, rendered } = await harness.run();
    console.log('\n===== 实测结果 =====');
    console.log(`  执行器: ${report.meta.mode}`);
    console.log(`  总计: ${report.summary.total}  生成成功: ${report.summary.completed}  生成率: ${(report.summary.rate * 100).toFixed(1)}%`);
    console.log('\n===== 明细 =====');
    console.log(rendered);
  } catch (e) {
    console.error('评测失败:', e?.message ?? e);
    console.error('（若为模型/网络错误，请检查 .env 中 FH_PROVIDERS 配置与网络连通性）');
  }
})();

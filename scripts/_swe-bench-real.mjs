// SWE-bench 测试通过率跑分（真实模型 + 真实测试断言）
// 背景：官方 SWE-bench(HF) 本机网络不可达（curl timeout），且标准集为 Python 大仓库需 Docker+pytest 环境。
// 本跑分采用 SWE-bench 格式(problem_statement + FAIL_TO_PASS/PASS_TO_PASS)构造自包含 JS 任务，
// 由真实模型(agnes-2.5-flash)修复/实现，预定义测试(测试不交给模型)用 node --test 真实断言验证。
// 输出：真实测试通过率（FAIL_TO_PASS 全过的实例 / 总实例）。
import { existsSync, writeFileSync, readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { LocalJsonLoader } = require('../dist/harness/loader.js');
const { RealModelExecutor } = require('../dist/harness/executor.js');
const { Harness } = require('../dist/harness/harness.js');
const { JsonReporter } = require('../dist/harness/reporter.js');

// ===== 5 个 SWE-bench 格式实例（JS，含预定义测试模板）=====
const TASKS = [
  {
    id: 'swe-js-001', file: 'max.js', signature: 'maxOf(a, b) 返回较大值',
    problem: '实现 JavaScript 函数 maxOf(a, b)，返回两个参数中较大的值；相等时返回该值。请将完整实现写入文件 max.js，使用 module.exports = maxOf 导出。',
    test: `const { test } = require('node:test');
const assert = require('node:assert');
const maxOf = require('../max.js');
test('positive', () => { assert.strictEqual(maxOf(3, 5), 5); });
test('negative', () => { assert.strictEqual(maxOf(-1, -3), -1); });
test('equal', () => { assert.strictEqual(maxOf(7, 7), 7); });
`,
  },
  {
    id: 'swe-js-002', file: 'fib.js', signature: 'fibonacci(n) 返回第 n 个斐波那契数',
    problem: '实现 JavaScript 函数 fibonacci(n)，返回第 n 个斐波那契数（n 从 0 开始，fibonacci(0)=0, fibonacci(1)=1）。请将完整实现写入文件 fib.js，使用 module.exports = fibonacci 导出。',
    test: `const { test } = require('node:test');
const assert = require('node:assert');
const fib = require('../fib.js');
test('base0', () => { assert.strictEqual(fib(0), 0); });
test('base1', () => { assert.strictEqual(fib(1), 1); });
test('fib10', () => { assert.strictEqual(fib(10), 55); });
test('fib15', () => { assert.strictEqual(fib(15), 610); });
`,
  },
  {
    id: 'swe-js-003', file: 'palindrome.js', signature: 'isPalindrome(s) 忽略大小写与空白判断回文',
    problem: '实现 JavaScript 函数 isPalindrome(s)，判断字符串 s 是否是回文（忽略大小写与空白）。请将完整实现写入文件 palindrome.js，使用 module.exports = isPalindrome 导出。',
    test: `const { test } = require('node:test');
const assert = require('node:assert');
const isPal = require('../palindrome.js');
test('phrase', () => { assert.strictEqual(isPal('A man a plan a canal Panama'), true); });
test('not', () => { assert.strictEqual(isPal('hello'), false); });
test('empty', () => { assert.strictEqual(isPal(''), true); });
`,
  },
  {
    id: 'swe-js-004', file: 'findMissing.js', signature: 'findMissing(arr) 返回 [0..n] 中缺失的数',
    problem: '实现 JavaScript 函数 findMissing(arr)，给定包含 n 个互不相同的整数的数组（值来自 0..n），返回缺失的那个数。请将完整实现写入文件 findMissing.js，使用 module.exports = findMissing 导出。',
    test: `const { test } = require('node:test');
const assert = require('node:assert');
const fm = require('../findMissing.js');
test('missing2', () => { assert.strictEqual(fm([0, 1, 3]), 2); });
test('missing0', () => { assert.strictEqual(fm([1, 2]), 0); });
test('missingLast', () => { assert.strictEqual(fm([0, 1, 2, 3]), 4); });
`,
  },
  {
    id: 'swe-js-005', file: 'countWords.js', signature: 'countWords(s) 统计英文单词数',
    problem: '实现 JavaScript 函数 countWords(s)，统计字符串中英文单词的个数（多个连续空白算一个分隔）。请将完整实现写入文件 countWords.js，使用 module.exports = countWords 导出。',
    test: `const { test } = require('node:test');
const assert = require('node:assert');
const cw = require('../countWords.js');
test('two', () => { assert.strictEqual(cw('hello world'), 2); });
test('spaces', () => { assert.strictEqual(cw('  a   b  '), 2); });
test('one', () => { assert.strictEqual(cw('a'), 1); });
test('empty', () => { assert.strictEqual(cw('   '), 0); });
`,
  },
];

const instances = TASKS.map((t) => ({
  instance_id: t.id,
  repo: 'swebench-js-local',
  base_commit: 'local',
  problem_statement: t.problem,
  patch: '', test_patch: '',
  FAIL_TO_PASS: ['all-tests'], PASS_TO_PASS: [],
}));

// 真实测试验证器：注入预定义测试 → node --test 断言 → 全过即通过
class RealTestVerifier {
  constructor() { this.id = 'real-test'; }
  async verify(cwd, instance) {
    const task = TASKS.find((t) => t.id === instance.instance_id);
    if (!task) return false;
    // 被测实现必须存在
    if (!existsSync(join(cwd, task.file))) return false;
    // 注入预定义测试（测试不交给模型，防作弊）
    const testDir = join(cwd, 'test');
    try { require('fs').mkdirSync(testDir, { recursive: true }); } catch {}
    writeFileSync(join(testDir, instance.instance_id + '.test.js'), task.test, 'utf8');
    try {
      const out = execSync('node --test test/', { cwd, encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
      return true; // 退出码 0 = 全过
    } catch {
      return false; // 断言失败或实现报错
    }
  }
}

(async () => {
  console.log('===== SWE-bench 测试通过率跑分（真实模型 agnes-2.5-flash + node --test 断言）=====');
  const tmpDir = mkdtempSync(join(tmpdir(), 'fhcode-swe-bench-'));
  const dataFile = join(tmpDir, 'swe-bench.json');
  writeFileSync(dataFile, JSON.stringify(instances));

  const harness = new Harness({
    loader: new LocalJsonLoader(dataFile),
    executor: new RealModelExecutor({ maxIterations: 5 }),
    verifier: new RealTestVerifier(),
    reporter: new JsonReporter(),
    limit: 5,
    onProgress: (r, i, total) => {
      console.log(`  [${i}/${total}] ${r.instance_id}  ok=${r.ok}  iterations=${r.iterations} toolCalls=${r.toolCalls}`);
    },
  });
  try {
    const { report, rendered } = await harness.run();
    console.log('\n===== 真实测试通过率 =====');
    console.log(`  执行器: ${report.meta.mode}  验证器: real-test(node --test)`);
    console.log(`  总实例: ${report.summary.total}  测试通过: ${report.summary.completed}  通过率: ${(report.summary.rate * 100).toFixed(1)}%`);
    console.log('\n===== 明细 =====');
    for (const r of report.results) {
      console.log(`  ${r.instance_id}: ${r.ok ? '✅ 通过' : '❌ 失败'}  (iterations=${r.iterations}, toolCalls=${r.toolCalls})`);
    }
  } catch (e) {
    console.error('跑分失败:', e?.message ?? e);
    process.exit(1);
  }
})();

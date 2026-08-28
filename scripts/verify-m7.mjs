/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M7 验证脚本：代码分析 + 代码生成 + 代码审查 + 仓库理解 + 测试生成
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __baseDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(__baseDir, '..', 'dist');
const require = createRequire(import.meta.url);

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.log(`  ❌ FAIL: ${msg}`); }
}

// 加载模块
const { analyzeFile, analyzeDirectory, generateReport } = require(join(distDir, 'tools', 'analysis', 'code-analyzer'));
const { generateApiRoute, generateModel, generateToolTemplate, saveGeneratedCode } = require(join(distDir, 'tools', 'generator', 'code-generator'));
const { reviewCode, reviewDirectory, loadReviewRules } = require(join(distDir, 'agent', 'code-review'));
const { analyzeRepo, generateArchitectureSummary, analyzeModuleDependencies } = require(join(distDir, 'agent', 'repo-underwriter'));
const { generateTests, saveTestFile } = require(join(distDir, 'tools', 'generator', 'test-generator'));

console.log('\n飞虹 Code M7 编程自主编写代码能力验证\n');
console.log('='.repeat(60));

// M7-A: 代码分析
console.log('\nM7-A 代码分析器:');
try {
  const result = analyzeFile('test.ts', 'const x = 1; // test\nconsole.log(x);\nif (!obj!.prop) {}');
  assert(result.issues.length > 0, '应检测到问题');
  assert(result.metrics.lines > 0, '应计算行数');
  assert(result.metrics.complexity >= 1, '复杂度应 >= 1');
  console.log('  ✅ 代码分析通过');
} catch (e) {
  console.log(`  ❌ ERROR: ${e.message}`);
  failed++;
}

// M7-B: 代码生成
console.log('\nM7-B 代码生成引擎:');
try {
  const apiRoute = generateApiRoute('GET', '/api/test', 'TestController');
  assert(apiRoute.success && apiRoute.content?.includes('Router'), '应生成 API 路由');
  const model = generateModel('User', { name: 'string', email: 'string' });
  assert(model.success && model.content?.includes('interface User'), '应生成 Model');
  console.log('  ✅ 代码生成通过');
} catch (e) {
  console.log(`  ❌ ERROR: ${e.message}`);
  failed++;
}

// M7-C: 代码审查
console.log('\nM7-C 智能代码审查:');
try {
  const review = reviewCode('test.ts', 'const password = "secret123";\nconsole.log(password);');
  assert(review.issues.length > 0, '应检测到安全问题');
  assert(!review.passed, '应标记为未通过');
  console.log('  ✅ 代码审查通过');
} catch (e) {
  console.log(`  ❌ ERROR: ${e.message}`);
  failed++;
}

// M7-D: 仓库理解
console.log('\nM7-D 仓库理解器:');
try {
  const structure = analyzeRepo(process.cwd());
  assert(structure.files.length > 0, '应分析到文件');
  assert(structure.directories.length >= 0, '应分析到目录');
  const summary = generateArchitectureSummary(structure);
  assert(summary.includes('仓库架构'), '应生成架构摘要');
  console.log('  ✅ 仓库理解通过');
} catch (e) {
  console.log(`  ❌ ERROR: ${e.message}`);
  failed++;
}

// M7-E: 测试生成
console.log('\nM7-E 测试生成器:');
try {
  const tests = generateTests('user.service.ts', 'createUser', [
    { functionName: 'createUser', description: 'should create user', inputs: { name: 'test' }, expectedOutput: { id: 1 } },
  ]);
  assert(tests.content?.includes('describe'), '应生成测试描述');
  assert(tests.content?.includes('createUser'), '应包含函数名');
  console.log('  ✅ 测试生成通过');
} catch (e) {
  console.log(`  ❌ ERROR: ${e.message}`);
  failed++;
}

// 汇总
console.log('\n' + '='.repeat(60));
console.log(`验证结果: 通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.log('❌ M7 验证失败');
  process.exit(1);
} else {
  console.log('✅ M7 验证全部通过');
  console.log('晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹');
}

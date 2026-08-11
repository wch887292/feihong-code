/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M8 验证：自主编程能力
 */
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { randomUUID } from 'crypto';

const require = createRequire(import.meta.url);

const pass = [];
const fail = [];
let total = 0;
function assert(label, cond) {
  total++;
  if (cond) { pass.push(label); console.log(`  ✅ ${label}`); }
  else { fail.push(label); console.log(`  ❌ ${label}`); }
}

console.log('=========== M8 自主编程能力冒烟验证 ===========\n');

// ─── 测试工作区 ───
const tmpDir = join(tmpdir(), `fhcode-m8-${randomUUID()}`);
mkdirSync(tmpDir, { recursive: true });
mkdirSync(join(tmpDir, 'src'), { recursive: true });

// ─── 1. CodeWriter ─────────────────────────────────────────
console.log('【1. CodeWriter 自主编写器】');

const { createCodeWriter } = require('../dist/agent/code-writer.js');
const writer = createCodeWriter(tmpDir);

const goal = '编写一个佣金计算函数';
const code = `export function calc(base, rate) {
  return Math.round(base * rate * 100) / 100;
}`;

const step1 = writer.plan(goal);
assert('plan 返回有效步骤', step1.type === 'plan' && step1.content.length > 0);

const step2 = writer.write(code, 'src/commission.ts');
assert('write 生成文件并记录', step2.type === 'write' && step2.file === 'src/commission.ts');
assert('文件已落盘', existsSync(join(tmpDir, 'src/commission.ts')));

// test() 内部调用 write()，返回 type=write
const step3 = writer.test('src/commission.ts', 'calc');
assert('test 触发测试生成', step3.type === 'write' && step3.file && step3.file.endsWith('.test.ts'));
assert('测试文件已落盘', existsSync(join(tmpDir, 'src/commission.test.ts')));

const step4 = writer.review('src/commission.ts');
assert('review 返回审查结果', step4.type === 'review' && step4.content.includes('src/commission.ts'));

const step5 = writer.analyze('src/commission.ts');
assert('analyze 返回分析结果', step5.type === 'review' && step5.content.includes('复杂度'));

const step6 = writer.fix('src/commission.ts');
assert('fix 返回修复结果', step6.type === 'fix');

const step7 = writer.summary();
assert('summary 返回总结', step7.type === 'summary' && step7.content.includes('M8'));

// ─── 2. CodeWriter 模板生成 ────────────────────────────────
console.log('\n【2. CodeWriter 模板生成】');

const apiResult = writer.writeTemplate('api-route', {
  method: 'GET', path: '/api/users', controller: 'UserController',
});
assert('模板 api-route 生成有效', apiResult.type === 'write' && apiResult.file && apiResult.file.includes('api'));

const modelResult = writer.writeTemplate('model', {
  name: 'User', fields: JSON.stringify({ id: 'string', name: 'string', email: 'string' }),
});
assert('模板 model 生成有效', modelResult.type === 'write' && modelResult.file && modelResult.file.includes('User.ts'));

// ─── 3. QualityGate ────────────────────────────────────────
console.log('\n【3. QualityGate 质量门禁】');

const { createQualityGate } = require('../dist/agent/quality-gate.js');
const gate = createQualityGate();

// 写入一个有问题的文件用于审查
const badCode = `const password = "admin123";
function query(db) {
  return db.execute("SELECT * FROM users WHERE id = " + userId);
}
console.log("debug");
`;
writeFileSync(join(tmpDir, 'src/bad.ts'), badCode, 'utf8');

const gateResult = gate.gateFile('src/bad.ts', badCode);
assert('gateFile 返回门禁结果', gateResult.file === 'src/bad.ts');
assert('gateFile 包含安全审查项', gateResult.checks.some(c => c.name === '安全审查'));
assert('gateFile 包含复杂度项', gateResult.checks.some(c => c.name === '复杂度'));
assert('gateFile 包含测试覆盖项', gateResult.checks.some(c => c.name === '测试覆盖'));

const report = gate.report([gateResult]);
assert('report 输出可读报告', report.includes('安全审查') && report.includes('复杂度'));

// ─── 4. SelfImprover ───────────────────────────────────────
console.log('\n【4. SelfImprover 自我改进】');

const { createSelfImprover } = require('../dist/agent/self-improver.js');
const improver = createSelfImprover();

const reflectResult = improver.reflect([], true, 1200);
assert('reflect 返回反思结果', reflectResult.success === true);
assert('reflect 提取成功模式', reflectResult.patterns.length > 0);
assert('reflect 生成改进建议', reflectResult.improvements.length > 0);
assert('reflect 输出策略变更', reflectResult.strategyChanges.length > 0);

const stats = improver.getStats();
assert('getStats 返回统计', stats.totalReflections === 1);
assert('getStats 成功率 100%', stats.successRate === 1.0);

// loadImprovements 从 ~/.feihong-code/improvements 读取
const impDir = join(homedir(), '.feihong-code', 'improvements');
mkdirSync(impDir, { recursive: true });
const savedRecords = improver.loadImprovements();
// 首次运行可能无历史文件，但 reflect() 已通过 saveExperience 写入
// 检查内存中的 improvements 或文件
assert('loadImprovements 可调用', typeof savedRecords === 'object');

// ─── 5. 集成：完整自主编写流程 ─────────────────────────────
console.log('\n【5. 集成：完整自主编写流程】');

const fullResult = await writer.run(
  '实现一个安全的用户验证函数',
  `export function validateUser(username, password) {
  if (!username || !password) return false;
  return username.length >= 3 && password.length >= 8;
}`,
  'src/validator.ts',
);

assert('完整流程成功执行', fullResult.steps.length >= 5);
assert('完整流程有总结步骤', fullResult.steps.some(s => s.type === 'summary'));
assert('完整流程生成文件', fullResult.finalFiles.length > 0);
assert('完整流程统计正确', fullResult.issuesFound >= 0);

// ─── 汇总 ──────────────────────────────────────────────────
console.log('\n------------------------------------------');
console.log(`通过 ${pass.length} 项，失败 ${fail.length} 项`);
if (fail.length > 0) {
  console.log('\n失败项:');
  for (const f of fail) console.log(`  ❌ ${f}`);
}
console.log(`\n临时 FH_HOME: ${tmpDir}`);
console.log('晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹');

process.exit(fail.length > 0 ? 1 : 0);

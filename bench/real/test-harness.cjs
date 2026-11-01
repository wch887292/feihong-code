#!/usr/bin/env node
/**
 * SWE-bench harness 回归自检：patch 测试文件过滤 + 工作区隔离判据
 *
 * 用法：node bench/real/test-harness.cjs
 *
 * 背景：曾出现两个让跑分失真的缺陷
 *  1) 模型 patch 里混入测试文件改动 → 与官方 test_patch 冲突 → apply 失败
 *  2) grep 工具用了 ripgrep 的 --glob，GNU grep 不支持 → 搜索直接报错中止
 * 本脚本把这两条判据固化为可重复执行的回归。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HARNESS = path.join(__dirname, '..', '..', 'scripts', 'swebench-real.mjs');
let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log(`  ✅ ${name}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
    fail++;
  }
}

function extractFunction(src, name) {
  const lines = src.split('\n');
  const s = lines.findIndex((l) => l.startsWith(`function ${name}`));
  if (s < 0) return null;
  let e = s;
  while (e < lines.length && lines[e] !== '}') e++;
  return lines.slice(s, e + 1).join('\n');
}

console.log('=== SWE-bench harness 回归自检 ===\n');

// ---- 1. stripTestFiles：测试文件改动必须被剔除 ----
console.log('[1] patch 测试文件过滤');
const src = fs.readFileSync(HARNESS, 'utf8');
const stripCode = extractFunction(src, 'stripTestFiles');
if (!stripCode) {
  check('stripTestFiles 函数存在', false, '未找到函数');
} else {
  // eslint-disable-next-line no-eval
  eval(stripCode);
  const demo = [
    'diff --git a/astropy/modeling/separable.py b/astropy/modeling/separable.py',
    '--- a/astropy/modeling/separable.py',
    '+++ b/astropy/modeling/separable.py',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/astropy/modeling/tests/test_separable.py b/astropy/modeling/tests/test_separable.py',
    '--- a/astropy/modeling/tests/test_separable.py',
    '+++ b/astropy/modeling/tests/test_separable.py',
    '@@ -1 +1 @@',
    '-told',
    '+tnew',
    'diff --git a/tests/test_x.py b/tests/test_x.py',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    'diff --git a/src/main.py b/src/main.py',
    '@@ -1 +1 @@',
    '-x',
    '+y',
    '',
  ].join('\n');
  const out = stripTestFiles(demo);
  check('源码 hunk 保留', out.includes('+new'));
  check('嵌套 tests/ 目录剔除', !out.includes('+tnew'));
  check('顶层 tests/ 目录剔除', !out.includes('+b'));
  check('普通源码保留', out.includes('+y'));
  const kept = (out.match(/^diff --git a\/\S+/gm) || []);
  check('只保留 2 个源码文件', kept.length === 2, `实际 ${kept.length}`);
}

// ---- 2. grep 不得再使用 --glob（GNU grep 不支持）----
console.log('\n[2] grep 工具参数');
// 按行取 grep 分支：从 "if (name === 'grep')" 到下一个同级 "if (name ===" 为止
const hLines = src.split('\n');
const gStart = hLines.findIndex((l) => l.includes("if (name === 'grep')"));
let gEnd = gStart + 1;
while (gEnd < hLines.length && !hLines[gEnd].trim().startsWith("if (name ===")) gEnd++;
// 去掉注释行再判断：注释里提到 --glob 是为了说明「不能用」，不算违规
const grepCode = hLines
  .slice(gStart, gEnd)
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');
check(
  'grep 使用 --include 而非 --glob',
  grepCode.includes('--include=') && !grepCode.includes('--glob'),
  `行 ${gStart + 1}..${gEnd}`
);

// ---- 3. 所有 shell 调用必须显式指定 bash（Windows cmd.exe 会让模型 bash 语法全废）----
console.log('\n[3] shell 方言一致性');
const shellCalls = (src.match(/execSync\(/g) || []).length;
const bashCalls = (src.match(/shell: BASH_SHELL/g) || []).length;
check(
  `execSync(${shellCalls}) 均指定 shell: BASH_SHELL(${bashCalls})`,
  shellCalls === bashCalls,
  `execSync=${shellCalls} 指定=${bashCalls}`
);
check('BASH_SHELL 常量已定义', src.includes('const BASH_SHELL'));

// ---- 4. 工作区必须按 instance_id 隔离（防同仓库多实例互相踩踏 base_commit）----
console.log('\n[4] 工作区隔离');
check(
  '工作区路径使用 instance_id',
  /inst\.workdir \|\| inst\.instance_id/.test(src),
  '未找到 instance_id 隔离逻辑'
);

// ---- 5. 隔离器存在且可编译 ----
console.log('\n[5] 未来提交隔离器');
const iso = path.join(__dirname, 'isolate_workdir.py');
check('isolate_workdir.py 存在', fs.existsSync(iso));
if (fs.existsSync(iso)) {
  try {
    execFileSync('python', ['-m', 'py_compile', iso], { stdio: 'pipe' });
    check('isolate_workdir.py 语法正确', true);
  } catch (e) {
    check('isolate_workdir.py 语法正确', false, String(e.message).slice(0, 200));
  }
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);

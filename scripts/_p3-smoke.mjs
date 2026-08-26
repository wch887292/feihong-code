// P3-2 冒烟测试：SWE 成绩对外文案更新验证
import { readFileSync } from 'fs';
import { join } from 'path';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

const root = process.cwd();
const zh = readFileSync(join(root, 'docs/BENCHMARK_REPORT_zh.md'), 'utf8');
const en = readFileSync(join(root, 'docs/BENCHMARK_REPORT_en.md'), 'utf8');
const geo = readFileSync(join(root, 'docs/geo-feihong-code.html'), 'utf8');
const upgrade = readFileSync(join(root, 'docs/UPGRADE_7.2.0.md'), 'utf8');

console.log('===== P3-2 zh 报告 =====');
report('含量化对标章节', zh.includes('十三、SWE-bench 真实成绩对标'));
report('含真实跑分 80%（4/5）', zh.includes('80%（4/5）'));
report('含复现脚本', zh.includes('_swe-bench-real.mjs'));
report('含行业对标 Opus 4.8=88.6%', zh.includes('88.6%'));
report('含豆包 TRAE 78.80%', zh.includes('78.80%'));
report('含诚实声明（不可直接横向对比）', zh.includes('不可直接横向对比'));
report('含污染注记 SWE-ABS', zh.includes('SWE-ABS'));
report('含来源/时间标注', zh.includes('Anthropic') && zh.includes('2026'));
report('原无依据定性句已修正', !zh.includes('与 Cursor Agent、Cline、Muse Code 处于同一梯队') && !zh.includes('与 Cursor/Copilot 仍有差距'));

console.log('\n===== P3-2 en 报告 =====');
report('含 SWE-bench Real Results Benchmark 章节', en.includes('SWE-bench Real Results Benchmark'));
report('含真实跑分 80% (4/5)', en.includes('80% (4/5)'));
report('含诚实声明 not directly comparable', en.includes('not directly comparable'));
report('含污染注记 contamination', en.toLowerCase().includes('contamination'));

console.log('\n===== P3-2 推广页 GEO =====');
report('含 SWE 成绩 FAQ', geo.includes('飞虹 Code 的 SWE-bench 跑分是多少'));
report('FAQ 诚实表述（自建任务集）', geo.includes('自建 SWE-bench 格式任务集'));
report('FAQ 不含官方 Verified 冒用', geo.includes('非官方 SWE-bench Verified'));
// 校验 JSON-LD 全部合法
const ldBlocks = [...geo.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1].trim());
report('JSON-LD 块存在', ldBlocks.length > 0, `count=${ldBlocks.length}`);
let jsonOk = true, jsonErr = '';
for (const [i, blk] of ldBlocks.entries()) {
  try { JSON.parse(blk); } catch (e) { jsonOk = false; jsonErr = `block${i}: ${e.message}`; }
}
report('JSON-LD 全部合法', jsonOk, jsonErr);
// 新 FAQ 在 JSON-LD 内
const faqBlock = ldBlocks.find((b) => b.includes('FAQPage')) || '';
report('新 FAQ 已入 JSON-LD', faqBlock.includes('飞虹 Code 的 SWE-bench 跑分是多少'));

console.log('\n===== P3-2 升级说明书 =====');
report('含 2.6 SWE 成绩对外文案', upgrade.includes('2.6 SWE 成绩对外文案'));
report('含三要素（真实跑分+来源+诚实口径）', upgrade.includes('真实跑分 + 来源标注 + 诚实口径'));
report('含更新文件清单', upgrade.includes('BENCHMARK_REPORT_zh.md') && upgrade.includes('geo-feihong-code.html'));

console.log(`\n========== P3-2 冒烟结果 ==========`);
console.log(`  通过: ${pass}  失败: ${fail}`);
if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
else { console.log('  ✅ 全部通过'); }
process.exit(fail > 0 ? 1 : 0);

// 拉取真实 SWE-bench Lite 数据集（通过 harness SwebenchLoader），统计构成
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { SwebenchLoader } = require('../dist/harness/loader.js');

(async () => {
  console.log('===== 拉取 SWE-bench Lite（HF datasets-server）=====');
  const loader = new SwebenchLoader({ split: 'lite' });
  const t0 = Date.now();
  try {
    const rows = await loader.load();
    console.log(`  拉取完成: ${rows.length} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    // 仓库分布
    const repos = {};
    for (const r of rows) repos[r.repo] = (repos[r.repo] || 0) + 1;
    const top = Object.entries(repos).sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log('\n  仓库分布（前 12）:');
    for (const [repo, n] of top) console.log(`    ${repo}: ${n}`);
    // 样例（取 2 条 problem 前 120 字）
    console.log('\n  样例 problem_statement:');
    for (const r of rows.slice(0, 2)) {
      console.log(`    [${r.instance_id}] ${(r.problem_statement || '').split('\n')[0].slice(0, 120)}`);
      console.log(`      FAIL_TO_PASS: ${(r.FAIL_TO_PASS || []).slice(0, 3).join(', ')}`);
    }
    // 判断是否含 JS/TS 仓库
    const jsRepos = Object.keys(repos).filter((r) => /javascript|node|typescript|express/i.test(r));
    console.log(`\n  JS/TS 相关仓库: ${jsRepos.length ? jsRepos.join(', ') : '无（标准 SWE-bench 为 Python 仓库）'}`);
  } catch (e) {
    console.error('  拉取失败:', e?.message ?? e);
    process.exit(1);
  }
})();

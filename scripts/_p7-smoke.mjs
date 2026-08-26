// P7 批次冒烟：SWE-bench harness + Docker 沙箱加固 + 合规文档 + 协作可视化 + 7.5.0 发布自动化
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}
const root = process.cwd();

console.log('===== P7-1 SWE-bench Verified 官方跑分集成 =====');
const runTs = readFileSync(join(root, 'src/cli/run.ts'), 'utf8');
const verifier = readFileSync(join(root, 'src/harness/verifier.ts'), 'utf8');
report('harness 支持 --verifier test', runTs.includes("opts.verifier === 'test'"));
report('TestVerifier 跑 FAIL_TO_PASS 官方测试', verifier.includes('FAIL_TO_PASS') && verifier.includes('runCommand'));
report('SwebenchLoader 对接 HuggingFace', readFileSync(join(root, 'src/harness/loader.ts'), 'utf8').includes('SwebenchLoader'));
report('跑分状态文档存在', existsSync(join(root, 'docs/SWE_BENCH_REPORT.md')));
report('文档诚实声明不编造数字', /禁止[\s\S]{0,12}SWE-bench 通过率/.test(readFileSync(join(root, 'docs/SWE_BENCH_REPORT.md'), 'utf8')));

console.log('\n===== P7-2 Docker 沙箱隔离档位 =====');
const execTs = readFileSync(join(root, 'src/tools/shell/exec.ts'), 'utf8');
report('容器执行默认断网 --network none', execTs.includes("'--network'") && execTs.includes("'none'"));
report('容器内存上限默认 512m', execTs.includes("'--memory'") && execTs.includes("'512m'"));
report('容器 pids 上限默认 256', execTs.includes("'--pids-limit'") && execTs.includes("'256'"));
report('容器 cap-drop ALL + no-new-privileges', execTs.includes("'--cap-drop'") && execTs.includes("no-new-privileges"));
report('container 模式可经环境变量配置', execTs.includes('FH_SANDBOX_NETWORK') && execTs.includes('FH_SANDBOX_IMAGE'));
report('sandbox 支持 container/docker 归一化', readFileSync(join(root, 'src/tools/sandbox.ts'), 'utf8').includes("v === 'container' || v === 'docker'"));

console.log('\n===== P7-3 合规认证白皮书 + DPA =====');
const wp = existsSync(join(root, 'docs/SECURITY_WHITEPAPER.md')) ? readFileSync(join(root, 'docs/SECURITY_WHITEPAPER.md'), 'utf8') : '';
const dpa = existsSync(join(root, 'docs/DPA.md')) ? readFileSync(join(root, 'docs/DPA.md'), 'utf8') : '';
report('安全白皮书存在', wp.length > 1000);
report('白皮书含 SOC2 五标准自评估', wp.includes('SOC 2') && wp.includes('保密性'));
report('白皮书含 ISO27001 控制映射', wp.includes('ISO/IEC 27001') && wp.includes('A.8.31'));
report('白皮书诚实声明未认证', wp.includes('不宣称已取得') || wp.includes('不构成任何正式合规认证声明'));
report('DPA 存在', dpa.includes('数据处理协议') && dpa.includes('控制方') && dpa.includes('处理方'));
report('DPA 含跨境与违约条款', dpa.includes('跨境') && dpa.includes('违约'));

console.log('\n===== P7-4 多 agent 协作可视化 =====');
const ui = readFileSync(join(root, 'src/web/public/js/ui.js'), 'utf8');
const idx = readFileSync(join(root, 'src/web/public/index.html'), 'utf8');
report('ui 含 renderTeamOverview', ui.includes('function renderTeamOverview'));
report('协作总览含任务状态漏斗', ui.includes('状态漏斗') || (ui.includes('任务状态') && ui.includes('funnelHtml')));
report('协作总览含成员负载分布', ui.includes('成员负载'));
report('loadTeamData 调用 renderTeamOverview', ui.includes('renderTeamOverview(d)'));
report('HTML 含 teamOverview 容器', idx.includes('id="teamOverview"'));

console.log('\n===== P7-5 GitHub/npm 发布自动化（7.5.0） =====');
const vts = readFileSync(join(root, 'src/cli/version.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
report('版本号升级 7.5.0（version.ts）', vts.includes("VERSION = '7.5.0'"));
report('版本号升级 7.5.0（package.json）', pkg.version === '7.5.0');
const rel = existsSync(join(root, '.github/workflows/release.yml')) ? readFileSync(join(root, '.github/workflows/release.yml'), 'utf8') : '';
report('release.yml 含 npm publish', rel.includes('npm publish'));
report('release.yml 含 GitHub Release', rel.includes('action-gh-release'));
report('release.yml 含 Docker 镜像发布', rel.includes('docker-publish') || rel.includes('build-push-action'));
report('release.yml 含安全 CI 门禁', rel.includes('npm run security'));
report('release.yml 含综合冒烟门禁', rel.includes('_smoke-full.mjs'));
report('release.yml 含 SWE harness 冒烟', rel.includes('harness lite'));
report('CHANGELOG 含 v7.5.0', readFileSync(join(root, 'CHANGELOG.md'), 'utf8').includes('## v7.5.0'));
report('升级说明书存在', existsSync(join(root, 'docs/UPGRADE_GUIDE_7_5.md')));

// HTTP：/api/health 应返回 7.5.0
const BASE = process.env.FH_SMOKE_BASE || 'http://127.0.0.1:8099';
(async () => {
  try {
    const h = await (await fetch(BASE + '/api/health')).json();
    report('POST /api/health 返回 7.5.0', h.version === '7.5.0', `（${h.version}）`);
  } catch (e) { report('health 7.5.0', false, String(e)); }

  console.log(`\n========== P7 批次冒烟结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过'); }
  process.exit(fail > 0 ? 1 : 0);
})();

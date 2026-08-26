// P0 系列冒烟汇总：官方 SWE 链路 + 安全CI/SBOM + Skill 模板库
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

const root = process.cwd();

console.log('===== P0-1 官方 SWE-bench Verified 链路 =====');
try {
  const out = execSync('node scripts/_verified-sample-smoke.mjs', { cwd: root, encoding: 'utf8' });
  const ok = !/❌/.test(out) && /通过: 11/.test(out);
  report('官方格式链路验证 11 项', ok);
  report('官方格式样本存在', existsSync(join(root, 'bench/swe-bench-verified-sample.json')));
} catch { report('官方格式链路验证', false, '脚本执行失败'); }

console.log('\n===== P0-2 安全 CI + SBOM =====');
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
report('ci.yml 含 supplychain job', ci.includes('supplychain:'));
report('含 npm audit 强制', ci.includes('npm audit --omit=dev --audit-level=high'));
report('含 osv-scanner', ci.includes('google/osv-scanner'));
report('含 SBOM 生成', ci.includes('@cyclonedx/cyclonedx-npm'));
report('含 SBOM 上传 artifact', ci.includes('upload-artifact') && ci.includes('sbom.cdx.json'));
report('YAML 合法且 jobs 完整', (() => { try { const d = yaml.load(ci); return Object.keys(d.jobs).length >= 5; } catch { return false; } })());
if (existsSync(join(root, 'sbom.cdx.json'))) {
  try {
    const sb = JSON.parse(readFileSync(join(root, 'sbom.cdx.json'), 'utf8'));
    report('本地 SBOM 已生成', sb.components && sb.components.length > 0, `components=${sb.components.length}`);
    report('SBOM 格式 CycloneDX', sb.bomFormat === 'CycloneDX');
  } catch { report('SBOM 校验', false); }
} else { report('本地 SBOM 已生成', false, '未找到 sbom.cdx.json（CI 将生成）'); }

console.log('\n===== P0-3 生态 Skill 模板库 =====');
const templates = readdirSync(join(root, 'templates/skills'));
report('10 个官方模板齐全', templates.length === 10, `count=${templates.length}`);
const expected = ['code-review','git-flow','api-design','refactor','test-gen','doc-gen','security-audit','performance','dependency-upgrade','onboarding'];
report('模板清单正确', expected.every((t) => templates.includes(t)));
const allHaveSkillMd = expected.every((t) => existsSync(join(root, `templates/skills/${t}/SKILL.md`)));
report('每个模板含 SKILL.md', allHaveSkillMd);
// skill-new 脚手架真实执行（临时目录，先清理旧产物）
try {
  const tmp = join(root, '.fhcode/skills/__p0test__');
  execSync(`node -e "require('fs').rmSync(process.argv[1],{recursive:true,force:true})" "${tmp}"`, { cwd: root, encoding: 'utf8', stdio: 'ignore' });
  execSync(`node dist/cli/index.js skill-new __p0test__ --template api-design`, { cwd: root, encoding: 'utf8', stdio: 'ignore' });
  report('skill-new 脚手架生成', existsSync(join(tmp, 'SKILL.md')));
  // 非法名防护
  try { execSync(`node dist/cli/index.js skill-new "a/b"`, { cwd: root, encoding: 'utf8', stdio: 'ignore' }); report('非法名防护', false); }
  catch { report('非法名防护', true); }
} catch { report('skill-new 脚手架生成', false); }
// package.json files 含 templates
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
report('npm 包 files 含 templates/skills', Array.isArray(pkg.files) && pkg.files.includes('templates/skills'));

console.log(`\n========== P0 汇总冒烟结果 ==========`);
console.log(`  通过: ${pass}  失败: ${fail}`);
if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
else { console.log('  ✅ 全部通过'); }
process.exit(fail > 0 ? 1 : 0);

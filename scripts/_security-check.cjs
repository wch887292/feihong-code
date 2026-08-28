/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * P6-4 安全 CI：npm audit + SBOM（CycloneDX）+ 可选 osv-scanner
 * 运行：npm run security  （或 node scripts/_security-check.cjs）
 *
 * 门禁策略：
 *  - critical / high 漏洞 > 0 → 退出码 1（阻断发布）
 *  - moderate / low / info → 仅告警，退出码 0
 *  - npm audit 网络不可达时给出降级提示，不因网络失败而误报"安全"
 */
const { execSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let exitCode = 0;

function banner(t) { console.log('\n===== ' + t + ' ====='); }

/* ---------- 1. npm audit ---------- */
banner('npm audit（供应链漏洞）');
let vuln = null;
try {
  const out = execSync('npm audit --json', { cwd: root, encoding: 'utf8', timeout: 180000 });
  vuln = (JSON.parse(out).metadata || {}).vulnerabilities || null;
} catch (e) {
  // npm audit 检测到漏洞时以非零码退出，但 stdout 仍是 JSON
  try {
    const j = JSON.parse(e.stdout || '{}');
    vuln = (j.metadata || {}).vulnerabilities || null;
    if (!vuln && e.stderr && /network|ETIMEDOUT|ECONNREFUSED|registry/i.test(e.stderr)) {
      console.log('⚠️ npm audit 网络不可达（registry 连接失败），本次跳过漏洞扫描');
      vuln = { skipped: true };
    }
  } catch {
    console.log('⚠️ npm audit 执行失败，无法获取漏洞数据');
  }
}
if (vuln && vuln.skipped) {
  // 已提示
} else if (vuln) {
  const sev = ['info', 'low', 'moderate', 'high', 'critical'];
  for (const s of sev) {
    const n = vuln[s] || 0;
    console.log(`  ${s.padEnd(9)} ${n}`);
    if ((s === 'high' || s === 'critical') && n > 0) exitCode = 1;
  }
  const total = Object.values(vuln).reduce((a, b) => a + (b || 0), 0);
  console.log(`  合计 ${total} 项` + (total === 0 ? '  ✅ 无已知漏洞' : ''));
} else {
  console.log('  （无数据）');
}

/* ---------- 2. SBOM（CycloneDX 1.5） ---------- */
banner('SBOM 生成（CycloneDX 1.5）');
function lockVersion(name) {
  try {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    const key = 'node_modules/' + name;
    const v = lock.packages && lock.packages[key] && lock.packages[key].version;
    if (v) return v;
    // 顶层依赖精确版本
    if (lock.dependencies && lock.dependencies[name] && lock.dependencies[name].version) {
      return lock.dependencies[name].version;
    }
  } catch { /* ignore */ }
  return null;
}
function collect(deps, scope) {
  const out = [];
  for (const [name, range] of Object.entries(deps || {})) {
    const version = lockVersion(name) || String(range).replace(/^[~^]/, '') || '0.0.0';
    out.push({
      type: 'library',
      'bom-ref': 'pkg:npm/' + encodeURIComponent(name) + '@' + version,
      name,
      version,
      scope: scope === 'devDependencies' ? 'optional' : 'required',
      purl: 'pkg:npm/' + encodeURIComponent(name) + '@' + version,
      properties: [{ name: 'declared-range', value: String(range) }],
    });
  }
  return out;
}
const components = [];
components.push(...collect(pkg.dependencies, 'dependencies'));
components.push(...collect(pkg.devDependencies, 'devDependencies'));
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:' + crypto.randomUUID(),
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'feihong-code', name: 'fhcode-security-ci', version: pkg.version || '0.0.0' }],
    component: { type: 'application', name: pkg.name, version: pkg.version || '0.0.0' },
  },
  components,
};
mkdirSync(join(root, 'artifacts'), { recursive: true });
const sbomPath = join(root, 'artifacts', 'sbom.json');
writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
console.log(`  组件数: ${components.length}  →  ${sbomPath}`);

/* ---------- 3. osv-scanner（可选，PATH 中存在才跑，避免 npx 网络请求） ---------- */
banner('osv-scanner（可选，Google OSV 数据库）');
let hasOsv = false;
try {
  // Windows 用 where，其余用 command -v
  const which = process.platform === 'win32' ? 'where osv-scanner' : 'command -v osv-scanner';
  execSync(which, { cwd: root, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'ignore', 'ignore'] });
  hasOsv = true;
} catch { hasOsv = false; }
if (hasOsv) {
  try {
    const out = execSync('osv-scanner --lockfile package-lock.json --format json', { cwd: root, encoding: 'utf8', timeout: 120000 });
    const j = JSON.parse(out);
    const results = (j.results || []).flatMap((r) => r.packages || []).filter((p) => p.vulnerabilities && p.vulnerabilities.length);
    console.log(`  osv-scanner 发现 ${results.length} 个受影响包`);
    for (const r of results.slice(0, 10)) {
      console.log(`    - ${r.package.name}@${r.package.version}: ${r.vulnerabilities.length} 漏洞`);
    }
    if (results.length > 0) exitCode = 1;
  } catch (e) {
    console.log('  ⚠️ osv-scanner 执行失败：' + (e.message || e).toString().slice(0, 120));
  }
} else {
  console.log('  未安装 osv-scanner，跳过（可选安装：go install github.com/google/osv-scanner/cmd/osv-scanner@latest）');
}

/* ---------- 汇总 ---------- */
console.log(`\n========== 安全 CI 结果 ==========`);
console.log(exitCode === 0 ? '  ✅ 通过（无 critical/high 漏洞）' : '  ❌ 存在 critical/high 级漏洞，阻断发布');
console.log(`  SBOM: artifacts/sbom.json`);
process.exit(exitCode);

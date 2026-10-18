/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * P6-4 安全 CI：npm audit + SBOM（CycloneDX）+ 可选 osv-scanner
 * 运行：npm run security  （或 node scripts/_security-check.cjs）
 *
 * 门禁策略：
 *  - critical / high 漏洞 > 0 → 退出码 1（阻断发布）
 *  - moderate / low / info → 仅告警，退出码 0
 *  - audit registry 可配置（FH_AUDIT_REGISTRY，默认官方源 registry.npmjs.org，支持 audit 端点）
 *  - npm audit 未执行（registry 不支持 / 网络失败）→ 明确输出"未执行"，不误报"通过"；
 *    设 FH_AUDIT_STRICT=1 时未执行同样阻断发布（CI 可开启严格模式）
 */
const { execSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const crypto = require('crypto');

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let exitCode = 0;
let auditSkipped = false;

function banner(t) { console.log('\n===== ' + t + ' ====='); }

/* ---------- 1. npm audit（registry 可配置，默认官方源支持 audit 端点） ---------- */
banner('npm audit（供应链漏洞）');
const AUDIT_REGISTRY = process.env.FH_AUDIT_REGISTRY || 'https://registry.npmjs.org';

/** 执行一次 npm audit，成功返回 { count, byPackage }，未执行返回 null */
function runAudit(extraArgs) {
  let json = null;
  try {
    const out = execSync(`npm audit --json ${extraArgs} --registry=${AUDIT_REGISTRY}`, { cwd: root, encoding: 'utf8', timeout: 180000 });
    json = JSON.parse(out);
  } catch (e) {
    // npm audit 检测到漏洞时以非零码退出，但 stdout 仍是 JSON
    try { json = JSON.parse(e.stdout || '{}'); } catch { /* 非 JSON 输出 */ }
  }
  if (!json || !json.metadata || !json.metadata.vulnerabilities) return null;
  return { count: json.metadata.vulnerabilities, byPackage: json.vulnerabilities || {} };
}

function auditReason(e) {
  const msg = (e && (e.stderr || e.stdout || '')) ? (e.stderr || e.stdout || '').toString() : '';
  if (/NOT_IMPLEMENTED|not implemented|404|audit endpoint/i.test(msg)) {
    return `⚠️ npm audit 未执行：registry（${AUDIT_REGISTRY}）不支持 audit 端点，可设置 FH_AUDIT_REGISTRY 切换（如官方代理）`;
  }
  if (/network|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|registry/i.test(msg)) {
    return `⚠️ npm audit 未执行：registry（${AUDIT_REGISTRY}）连接失败，本次未扫描供应链漏洞`;
  }
  return `⚠️ npm audit 执行失败（registry: ${AUDIT_REGISTRY}），无法获取漏洞数据`;
}

function printSeverity(count, label) {
  const sev = ['info', 'low', 'moderate', 'high', 'critical'];
  console.log(`  [${label}]`);
  for (const s of sev) {
    const n = count[s] || 0;
    console.log(`    ${s.padEnd(9)} ${n}`);
    if ((s === 'high' || s === 'critical') && n > 0) exitCode = 1;
  }
  console.log(`    合计 ${count.total ?? 0} 项` + ((count.total ?? 0) === 0 ? `  ✅ ${label}无已知漏洞` : ''));
}

// ① 生产依赖审计（--omit=dev）：critical/high 阻断发布
const prodAudit = runAudit('--omit=dev');
if (prodAudit === null) {
  auditSkipped = true;
  console.log('  [生产依赖] ' + auditReason({}));
} else {
  printSeverity(prodAudit.count, '生产依赖');
}

// ② 全量审计（含 devDependencies）：仅告警不阻断（构建链漏洞不影响运行时产物）
const allAudit = runAudit('');
if (allAudit !== null) {
  const prodPkgs = new Set(Object.keys(prodAudit ? prodAudit.byPackage : {}));
  const devOnly = Object.entries(allAudit.byPackage).filter(([name]) => !prodPkgs.has(name));
  if (devOnly.length > 0) {
    const devHigh = devOnly.filter(([, info]) => info.severity === 'high' || info.severity === 'critical').length;
    console.log(`  [devDependencies 构建链] ${devOnly.length} 项额外漏洞（含 high/critical ${devHigh} 项）——仅告警，不阻断发布；` +
      `涉及包: ${devOnly.map(([name]) => name).slice(0, 8).join(', ')}${devOnly.length > 8 ? ' 等' : ''}`);
  }
} else {
  auditSkipped = true;
  console.log('  [全量] ' + auditReason({}));
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
const strictMode = process.env.FH_AUDIT_STRICT === '1';
console.log(`\n========== 安全 CI 结果 ==========`);
if (exitCode === 1) {
  console.log('  ❌ 存在 critical/high 级漏洞，阻断发布');
} else if (auditSkipped) {
  console.log('  ⚠️ 部分通过：npm audit 未执行（供应链漏洞未扫描）'
    + (strictMode ? '；FH_AUDIT_STRICT=1 已按严格模式阻断' : '；设 FH_AUDIT_STRICT=1 可让未执行时阻断发布'));
  if (strictMode) exitCode = 1;
} else {
  console.log('  ✅ 通过（无 critical/high 漏洞）');
}
console.log(`  SBOM: artifacts/sbom.json`);
process.exit(exitCode);

/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M4 企业能力冒烟验证（全离线，不产生任何模型费用）。
 * 覆盖：RBAC 权限矩阵 / 危险动作 deny 优先 / 审批链路 / 防篡改审计 / 多租户隔离 / 配额熔断。
 *
 * 用法: node scripts/verify-m4.mjs
 */
import { createRequire } from 'module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);

const HOME = mkdtempSync(join(tmpdir(), 'fhcode-m4-'));
const WORK = mkdtempSync(join(tmpdir(), 'fhcode-m4-work-'));
process.env.FH_HOME = HOME;
process.env.FH_OFFLINE = 'true';
process.env.FH_ENTERPRISE = 'true';
process.env.FH_PROVIDERS = '[]';

let pass = 0;
let fail = 0;
const results = [];

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    results.push(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    results.push(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

function section(title) {
  results.push(`\n【${title}】`);
}

const { evaluate, DEFAULT_POLICY, loadPolicy } = require('../dist/enterprise/policy.js');
const { AuditLog, verifyAudit, readAudit, redact } = require('../dist/enterprise/audit.js');
const { resolveTenantContext, listTenants, assertValidId } = require('../dist/enterprise/tenant.js');
const { createEnterpriseGuard } = require('../dist/enterprise/guard.js');
const { tenantSpendToday, checkQuota } = require('../dist/enterprise/quota.js');
const { ToolRegistry } = require('../dist/tools/tool.registry.js');
const { createDefaultRegistry } = require('../dist/tools/index.js');

/* ============ 1. RBAC 角色矩阵 ============ */
section('1. RBAC 角色-工具矩阵');
const policy = DEFAULT_POLICY;
const base = { args: { path: 'a.ts' }, cwd: WORK, shellAllowlist: [] };

check(
  'viewer 可读文件',
  evaluate(policy, { ...base, role: 'viewer', tool: 'read_file' }).effect === 'allow',
);
const vWrite = evaluate(policy, { ...base, role: 'viewer', tool: 'write_file' });
check('viewer 写文件被拒', vWrite.effect === 'deny', vWrite.reason);
check(
  'developer 可写文件',
  evaluate(policy, { ...base, role: 'developer', tool: 'write_file' }).effect === 'allow',
);
const dShell = evaluate(policy, {
  ...base,
  role: 'developer',
  tool: 'run_shell',
  args: { command: 'npm test' },
});
check('developer 执行 shell 需审批', dShell.effect === 'approval', dShell.reason);
const wl = evaluate(policy, {
  ...base,
  role: 'developer',
  tool: 'run_shell',
  args: { command: 'npm test' },
  shellAllowlist: ['npm'],
});
check('命中 shell 白名单免审批', wl.effect === 'allow', wl.rule);

/* ============ 2. deny 优先（admin 也拦） ============ */
section('2. 危险动作 deny 优先');
const rmrf = evaluate(policy, {
  ...base,
  role: 'admin',
  tool: 'run_shell',
  args: { command: 'sudo rm -rf / --no-preserve-root' },
});
check('admin 执行 rm -rf / 仍被拒', rmrf.effect === 'deny', rmrf.reason);
const envRead = evaluate(policy, { ...base, role: 'admin', tool: 'read_file', args: { path: '.env' } });
check('读取 .env 被拒', envRead.effect === 'deny', envRead.reason);
const sshRead = evaluate(policy, {
  ...base,
  role: 'admin',
  tool: 'read_file',
  args: { path: 'home/user/.ssh/id_rsa' },
});
check('读取 .ssh/id_rsa 被拒', sshRead.effect === 'deny', sshRead.reason);
const escape = evaluate(policy, {
  ...base,
  role: 'admin',
  tool: 'write_file',
  args: { path: '../../outside.txt' },
});
check('路径越出工作区被拒', escape.effect === 'deny', escape.reason);

/* ============ 3. 策略文件覆盖（只能加严） ============ */
section('3. 策略文件覆盖');
writeFileSync(
  join(HOME, 'policy.json'),
  JSON.stringify({ denyShell: ['npm publish'], roles: { developer: { maxCostUsd: 0.25 } } }),
  'utf8',
);
const merged = loadPolicy(HOME);
check('自定义黑名单已合入', merged.denyShell.includes('npm publish'));
check('默认黑名单未被抹掉', merged.denyShell.includes('mkfs'));
check('角色成本上限被覆盖', merged.roles.developer.maxCostUsd === 0.25);
const pub = evaluate(merged, {
  ...base,
  role: 'admin',
  tool: 'run_shell',
  args: { command: 'npm publish --access public' },
});
check('自定义黑名单生效', pub.effect === 'deny', pub.reason);

/* ============ 4. 审计哈希链 ============ */
section('4. 防篡改审计链');
const auditDir = join(HOME, 'tenants', 'acme', 'audit');
const audit = new AuditLog(auditDir);
for (let i = 0; i < 5; i++) {
  audit.record({
    tenantId: 'acme',
    userId: 'wuchihong',
    role: 'developer',
    runId: 'run-' + i,
    action: 'tool:write_file',
    resource: `file-${i}.ts`,
    decision: 'allow',
    reason: 'rbac.allow',
  });
}
check('审计写入 5 条', audit.count === 5);
const v1 = verifyAudit(auditDir);
check('哈希链校验通过', v1.ok === true, `total=${v1.total}`);

check('密钥脱敏生效', redact('apiKey=sk-abcdefgh12345678').includes('***'));
const sensitive = new AuditLog(join(HOME, 'tenants', 'acme', 'audit2'));
const rec = sensitive.record({
  tenantId: 'acme',
  userId: 'u',
  role: 'admin',
  runId: 'r',
  action: 'tool:run_shell',
  resource: 'curl -H "Authorization: Bearer sk-SECRETVALUE123456"',
  decision: 'allow',
  reason: 'token=sk-SECRETVALUE123456',
});
check('审计记录不落明文密钥', !JSON.stringify(rec).includes('SECRETVALUE'), rec.resource);

// 篡改：改写第 3 条的 resource
const auditFile = join(auditDir, readdirSync(auditDir)[0]);
const lines = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean);
const tampered = JSON.parse(lines[2]);
tampered.resource = 'evil.ts';
lines[2] = JSON.stringify(tampered);
writeFileSync(auditFile, lines.join('\n') + '\n', 'utf8');
const v2 = verifyAudit(auditDir);
check('篡改后校验失败', v2.ok === false, v2.detail);
check('准确定位断点为第 3 条', v2.brokenAt === 3, `brokenAt=${v2.brokenAt}`);

// 删除一条 → 序号不连续
const del = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean);
del.splice(1, 1);
writeFileSync(auditFile, del.join('\n') + '\n', 'utf8');
const v3 = verifyAudit(auditDir);
check('删除记录后校验失败', v3.ok === false, v3.detail);

/* ============ 5. 守卫接入工具链 ============ */
section('5. 守卫接入工具执行链');
const guardAudit = new AuditLog(join(HOME, 'tenants', 'guard', 'audit'));
const registry = createDefaultRegistry();

async function runTool(role, tool, args, approve) {
  const guard = createEnterpriseGuard({
    tenant: {
      tenantId: 'guard',
      userId: 'tester',
      role,
      root: join(HOME, 'tenants', 'guard'),
      sessionDir: '',
      auditDir: join(HOME, 'tenants', 'guard', 'audit'),
      goalDir: '',
    },
    policy: DEFAULT_POLICY,
    audit: guardAudit,
    runId: 'guard-run',
    cwd: WORK,
    shellAllowlist: [],
    approve,
  });
  return registry.execute(tool, args, {
    runId: 'guard-run',
    cwd: WORK,
    security: { shellAllowlist: [], requireApproval: true },
    approve,
    guard,
  });
}

const r1 = await runTool('viewer', 'write_file', { path: 'x.txt', content: 'hi' });
check('viewer 写文件在工具链被拦截', r1.ok === false, r1.error);
check('未产生文件', !existsSync(join(WORK, 'x.txt')));

const r2 = await runTool('developer', 'write_file', { path: 'ok.txt', content: 'hello' });
check('developer 写文件成功', r2.ok === true, r2.error || r2.output.slice(0, 40));
check('文件已落盘', existsSync(join(WORK, 'ok.txt')));

let asked = 0;
const r3 = await runTool('developer', 'run_shell', { command: 'echo hi' }, async () => {
  asked++;
  return false;
});
check('run_shell 触发审批询问', asked === 1, `asked=${asked}`);
check('审批拒绝后不执行', r3.ok === false, r3.error);

let asked2 = 0;
const r4 = await runTool('developer', 'run_shell', { command: 'echo enterprise-ok' }, async () => {
  asked2++;
  return true;
});
check('审批只询问一次（无重复弹审批）', asked2 === 1, `asked=${asked2}`);
check('审批通过后正常执行', r4.ok === true && r4.output.includes('enterprise-ok'), r4.output.trim());

const r5 = await runTool('admin', 'run_shell', { command: 'rm -rf /' }, async () => true);
check('危险命令即使审批同意也被拒', r5.ok === false, r5.error);

check('守卫全过程已审计', verifyAudit(join(HOME, 'tenants', 'guard', 'audit')).ok === true);
const guardRecords = readAudit(join(HOME, 'tenants', 'guard', 'audit'));
check(
  '审计含 deny/approved/rejected 三类决策',
  ['deny', 'approved', 'rejected'].every((d) => guardRecords.some((r) => r.decision === d)),
  guardRecords.map((r) => r.decision).join(','),
);

/* ============ 6. 多租户隔离 ============ */
section('6. 多租户隔离');
try {
  assertValidId('FH_TENANT', '../escape');
  check('非法租户 ID 被拒', false);
} catch (e) {
  check('非法租户 ID 被拒', true, e.message.slice(0, 40));
}

process.env.FH_TENANT = 'alpha';
process.env.FH_USER = 'alice';
process.env.FH_ROLE = 'developer';
const ctxA = resolveTenantContext(HOME);
process.env.FH_TENANT = 'beta';
process.env.FH_USER = 'bob';
process.env.FH_ROLE = 'viewer';
const ctxB = resolveTenantContext(HOME);
check('租户目录互不相同', ctxA.root !== ctxB.root, `${ctxA.tenantId} vs ${ctxB.tenantId}`);
check('角色按环境解析', ctxA.role === 'developer' && ctxB.role === 'viewer');
check(
  '会话目录隔离',
  ctxA.sessionDir.includes(join('tenants', 'alpha')) &&
    ctxB.sessionDir.includes(join('tenants', 'beta')),
);

// 造两个租户的会话数据，验证 tenants 汇总
for (const [t, cost] of [
  ['alpha', 0.12],
  ['beta', 0.03],
]) {
  const dir = join(HOME, 'tenants', t, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${t}-run.session.json`),
    JSON.stringify({
      runId: `${t}-run`,
      goal: 'demo',
      cwd: WORK,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'done',
      iterations: 2,
      costUsd: cost,
      messages: [],
      touchedFiles: [],
    }),
    'utf8',
  );
}
const tenants = listTenants(HOME);
check('tenants 汇总列出全部租户', tenants.length >= 4, tenants.map((t) => t.tenantId).join(','));
const alpha = tenants.find((t) => t.tenantId === 'alpha');
check('租户成本统计正确', Math.abs(alpha.costUsd - 0.12) < 1e-9, `alpha=$${alpha.costUsd}`);
const beta = tenants.find((t) => t.tenantId === 'beta');
check('租户间数据不串台', Math.abs(beta.costUsd - 0.03) < 1e-9, `beta=$${beta.costUsd}`);

/* ============ 7. 配额熔断 ============ */
section('7. 租户日成本配额');
const spend = tenantSpendToday(join(HOME, 'tenants', 'alpha', 'sessions'));
check('当日花费统计正确', Math.abs(spend.usedUsd - 0.12) < 1e-9, `$${spend.usedUsd}`);

process.env.FH_TENANT_BUDGET_USD = '0.10';
const q1 = checkQuota({ ...ctxA, sessionDir: join(HOME, 'tenants', 'alpha', 'sessions') }, policy);
check('超预算判定为 exceeded', q1.exceeded === true, `$${q1.usedUsd}/$${q1.limitUsd}`);
process.env.FH_TENANT_BUDGET_USD = '1.00';
const q2 = checkQuota({ ...ctxA, sessionDir: join(HOME, 'tenants', 'alpha', 'sessions') }, policy);
check('预算充足判定为通过', q2.exceeded === false, `$${q2.usedUsd}/$${q2.limitUsd}`);
delete process.env.FH_TENANT_BUDGET_USD;

/* ============ 汇总 ============ */
console.log('=========== M4 企业能力冒烟验证 ===========');
console.log(results.join('\n'));
console.log('\n------------------------------------------');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log(`临时 FH_HOME: ${HOME}`);
console.log('晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹');
process.exit(fail === 0 ? 0 : 1);

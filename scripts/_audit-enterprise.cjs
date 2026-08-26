// 复盘辅助：enterprise 引用检查 + fim 脚本检查
const fs = require('fs'), path = require('path');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') || e.name.endsWith('.mjs') || e.name.endsWith('.cjs') || e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
console.log('===== enterprise 引用检查 =====');
let found = 0;
for (const f of walk('src')) {
  const txt = fs.readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/from\s+['"]([^'"]*enterprise[^'"]*)['"]/g)) {
    found++; console.log('  ' + f.replace(/\\/g,'/') + ': import ' + m[1]);
  }
  for (const m of txt.matchAll(/require\(\s*['"]([^'"]*enterprise[^'"]*)['"]\s*\)/g)) {
    found++; console.log('  ' + f.replace(/\\/g,'/') + ': require ' + m[1]);
  }
}
if (!found) console.log('  → enterprise 全目录无任何 import/require（孤立死代码）');

console.log('\n===== enterprise 各关键能力被使用情况 =====');
const names = ['createAudit', 'AuditManager', 'enforcePolicy', 'checkPolicy', 'audit(', 'enforceQuota', 'checkQuota', 'TenantManager', 'Guard', 'guard'];
for (const n of names) {
  const hits = [];
  for (const f of walk('src')) {
    const txt = fs.readFileSync(f, 'utf8');
    if (f.includes('enterprise')) continue;
    if (txt.includes(n)) hits.push(f.split(/[\\/]/).slice(-2).join('/'));
  }
  console.log('  ' + n + ': ' + (hits.length ? hits.join(', ') : '无外部使用'));
}

console.log('\n===== prepare-fim-data 脚本 =====');
const all = walk('scripts').concat(walk('.'));
const fim = all.filter(f => /prepare-fim/.test(f));
console.log(fim.length ? fim.join('\n') : '  → 缺失（CHANGELOG 声称存在）');

console.log('\n===== src/training 被 scripts 引用情况 =====');
for (const f of all.filter(x => x.endsWith('.mjs') || x.endsWith('.cjs') || x.endsWith('.ts'))) {
  const txt = fs.readFileSync(f, 'utf8');
  if (/training/.test(txt)) console.log('  ' + f.replace(/\\/g,'/') + ' 提及 training');
}
console.log('  (空 = 无人引用 src/training)');

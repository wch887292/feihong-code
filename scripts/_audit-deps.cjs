// 飞虹 Code 全库依赖图分析脚本（临时复盘工具）
const fs = require('fs'), path = require('path');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}
const files = walk('src').sort();
const rel = f => f.replace(/\\/g, '/').replace(/^src\//, '').replace(/\.ts$/, '');
const idOf = f => rel(f);

function importsOf(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const res = [];
  const re = /from\s+['"]([^'"]+)['"]/g; let m;
  while ((m = re.exec(txt))) {
    let s = m[1];
    if (s.startsWith('.')) {
      const base = path.posix.dirname(rel(file));
      res.push(path.posix.normalize(path.posix.join(base, s)).replace(/\\/g, '/'));
    } else if (s.startsWith('@/')) {
      res.push(s.slice(2));
    }
  }
  return res;
}

const byTarget = {}; // target -> [referrers]
for (const f of files) {
  const id = idOf(f);
  for (const t of importsOf(f)) {
    const match = files.find(x => idOf(x) === t) || files.find(x => idOf(x) === t + '.ts');
    if (match) {
      const tid = idOf(match);
      byTarget[tid] = byTarget[tid] || [];
      byTarget[tid].push(id);
    }
  }
}

const orphan = [];
for (const f of files) {
  const id = idOf(f);
  const base = path.basename(id);
  if (base === 'index.ts' || base === 'main.ts' || base === 'server.ts') continue;
  if (!byTarget[id]) orphan.push(id);
}
console.log('=== 完全孤立模块（无任何 TS 引用）===');
orphan.sort().forEach(o => console.log('  ' + o));
console.log('孤立模块数: ' + orphan.length + ' / ' + files.length);

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const deps = new Set(Object.keys(pkg.dependencies || {}));

const externals = new Set();
function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) {
      let c = fs.readFileSync(p, 'utf8');
      // 移除行注释和块注释，避免匹配注释里的 require
      c = c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const re = /require\(['"]([^./][^'"]*)['"]\)/g;
      let m;
      while ((m = re.exec(c))) {
        const parts = m[1].split('/');
        if (parts[0].startsWith('@')) externals.add(parts[0] + '/' + parts[1]);
        else externals.add(parts[0]);
      }
    }
  }
}
walk('dist');

const builtin = new Set(['fs','path','os','crypto','https','http','url','child_process','readline','stream','events','util','buffer','process','console','assert','net','tls','zlib','querystring','punycode','string_decoder','timers','tty','dgram','dns','cluster','domain','v8','vm','worker_threads','perf_hooks','trace_events','inspector','repl','module','constants','async_hooks','http2','node:fs','node:path','node:os','node:crypto','node:https','node:http','node:url','node:child_process','node:readline','node:stream','node:events','node:util','node:buffer']);

const missing = [];
const found = [];
for (const m of externals) {
  if (builtin.has(m)) continue;
  if (fs.existsSync('node_modules/' + m)) found.push(m);
  else missing.push(m);
}
console.log('dist 引用的外部模块总数:', externals.size);
console.log('在 node_modules 中:', found.length, '->', found.join(', '));
console.log('缺失的模块:', missing.length ? missing.join(', ') : '无');
if (missing.length) {
  console.log('--- 缺失模块详情 ---');
  for (const m of missing) {
    console.log(m + ': dependencies=' + (deps.has(m) ? 'YES' : 'NO'));
  }
}
// 检查 found 里的模块是否都在 dependencies（不在的话 electron-builder 可能 prune 掉）
const notInDeps = found.filter(m => !deps.has(m));
console.log('\n在 node_modules 但不在 dependencies（可能被 prune）:', notInDeps.length ? notInDeps.join(', ') : '无');

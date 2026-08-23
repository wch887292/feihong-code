/**
 * 飞虹 Code Web 控制台 DOM id 完整性自检
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 扫描 index.html：
 * 1) HTML 中定义的所有 id
 * 2) JS 中通过 getElementById / querySelector('#x') 引用的 id
 * 3) 找出「引用了但未定义」的 id（会导致运行时 null 异常）
 */
import { readFileSync } from 'fs';

const file = process.argv[2] || 'src/web/public/index.html';
const html = readFileSync(file, 'utf8');

// HTML 中定义的 id
const defined = new Set();
for (const m of html.matchAll(/\sid=["']([^"']+)["']/g)) defined.add(m[1]);

// JS 中引用的 id：getElementById('x') / querySelector('#x') / getElementById("x")
const referenced = new Set();
for (const m of html.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) referenced.add(m[1]);
for (const m of html.matchAll(/querySelector\(\s*['"]#([A-Za-z0-9_\-]+)['"]\s*\)/g)) referenced.add(m[1]);

const missing = [...referenced].filter((id) => !defined.has(id)).sort();
const unused = [...defined].filter((id) => !referenced.has(id)).sort();

console.log('文件行数:', html.split('\n').length);
console.log('HTML 定义 id 数:', defined.size);
console.log('JS 引用 id 数:', referenced.size);
console.log('');
console.log('=== 引用但未定义（会抛 null 异常）===');
if (!missing.length) console.log('  无 ✅');
else missing.forEach((id) => console.log('  ❌ #' + id));
console.log('');
console.log('=== 定义但未被 JS 引用（潜在死元素）===');
if (!unused.length) console.log('  无');
else console.log('  ' + unused.join(', '));

process.exit(missing.length ? 1 : 0);

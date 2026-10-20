// validate-content.mjs — 网页故事内容/资源校验
//
// 用法：node validate-content.mjs --root <项目根> [--html index.html]
//
// 检查项：
//   1. 入口 HTML 存在
//   2. 无占位文案（占位/待填/TODO/FIXME/Lorem ipsum/placeholder，HTML 注释除外）
//   3. 锚点完整：a[href^="#x"] 必须有 id="x"
//   4. 本地资源存在：img/script/link 的相对 src/href 在磁盘上存在（中文路径兼容）
//   5. 内联 <script type="application/json"> 可解析
//   6. 外链建议用 https（仅警告，不阻断）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const args = { root: process.cwd(), html: 'index.html' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = path.resolve(argv[++i]);
    else if (argv[i] === '--html') args.html = argv[++i];
    else {
      console.error(`Unknown arg: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const htmlPath = path.join(args.root, args.html);

if (!fs.existsSync(htmlPath)) {
  console.error(`MISSING: ${htmlPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(htmlPath, 'utf8');
// 去掉 HTML 注释再扫描，模板说明可以留在注释里
const html = raw.replace(/<!--[\s\S]*?-->/g, '');

const failures = [];
const warnings = [];

function lineOf(index) {
  return raw.slice(0, index).split('\n').length;
}

// 2. 占位文案
// 注意：不用单独的"占位"二字——正常行文会出现"占位文案/占位符"等词。
// 只匹配明显是填充标记的写法。
const placeholderRe = /占位符|待填|待补充|此处替换|TODO|FIXME|Lorem ipsum|placeholder/gi;
let m;
while ((m = placeholderRe.exec(html)) !== null) {
  failures.push(`placeholder text "${m[0]}" at ~line ${lineOf(m.index)}`);
}

// 3. 锚点
const ids = new Set();
const idRe = /\sid="([^"]+)"/g;
while ((m = idRe.exec(html)) !== null) ids.add(m[1]);
const anchorRe = /href="#([^"]+)"/g;
while ((m = anchorRe.exec(html)) !== null) {
  if (!ids.has(m[1])) failures.push(`broken anchor "#${m[1]}" at ~line ${lineOf(m.index)}`);
}

// 4. 本地资源
const resRe = /(?:src|href)="([^"#]+?)"/g;
while ((m = resRe.exec(html)) !== null) {
  const ref = m[1];
  if (/^(https?:|mailto:|tel:|data:|\/\/)/i.test(ref)) {
    if (/^http:\/\//i.test(ref)) warnings.push(`insecure external link "${ref}" at ~line ${lineOf(m.index)}`);
    continue;
  }
  const clean = ref.split(/[?#]/)[0];
  if (!clean) continue;
  const filePath = path.join(args.root, decodeURIComponent(clean));
  if (!fs.existsSync(filePath)) {
    failures.push(`missing local resource "${ref}" at ~line ${lineOf(m.index)}`);
  }
}

// 5. 内联 JSON
const jsonRe = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
let jsonCount = 0;
while ((m = jsonRe.exec(html)) !== null) {
  jsonCount += 1;
  try {
    JSON.parse(m[1]);
  } catch (err) {
    failures.push(`inline JSON block #${jsonCount} invalid: ${err.message}`);
  }
}

if (warnings.length) {
  console.log(`WARNINGS:\n- ${warnings.join('\n- ')}`);
}

if (failures.length) {
  console.error(`VALIDATE FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`VALIDATE PASSED: ${args.html} (anchors: ${ids.size} ids, inline JSON blocks: ${jsonCount})`);

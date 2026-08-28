#!/usr/bin/env node
/**
 * 一键升版：以 package.json 为单一权威源，同步传播到全部版本号落点。
 *
 * 自动更新：
 *   1. package.json            version
 *   2. src/cli/version.ts      export const VERSION
 *   3. android/app/build.gradle versionName + versionCode(+1)（存在时）
 *   4. README.md               JSON-LD softwareVersion
 *
 * 需人工补充（脚本只提示，不代写）：
 *   - CHANGELOG.md 新版本段（check-version.mjs 会强制要求其存在）
 *
 * 用法：node scripts/bump-version.mjs 7.7.0
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('用法: node scripts/bump-version.mjs <X.Y.Z>   例: node scripts/bump-version.mjs 7.7.0');
  process.exit(1);
}

const p = (...a) => path.join(root, ...a);
const read = (f) => readFileSync(p(f), 'utf8');
const write = (f, t) => writeFileSync(p(f), t, 'utf8');

const pkgPath = 'package.json';
const pkg = JSON.parse(read(pkgPath));
const prev = pkg.version;
if (next === prev) {
  console.error(`新版本与当前版本相同 (${prev})`);
  process.exit(1);
}

// 1. package.json（保持 2 空格缩进 + 尾换行）
pkg.version = next;
write(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`✓ package.json            ${prev} -> ${next}`);

// 2. src/cli/version.ts
const vtPath = 'src/cli/version.ts';
const vt = read(vtPath);
if (/export const VERSION\s*=\s*'[^']+'/.test(vt)) {
  write(vtPath, vt.replace(/export const VERSION\s*=\s*'[^']+'/, `export const VERSION = '${next}'`));
  console.log(`✓ src/cli/version.ts      VERSION = '${next}'`);
} else {
  console.warn(`⚠ src/cli/version.ts 未找到 VERSION 常量，请人工修改`);
}

// 3. android build.gradle：versionName + versionCode+1
const gradlePath = 'android/app/build.gradle';
if (existsSync(p(gradlePath))) {
  let g = read(gradlePath);
  const cm = g.match(/versionCode\s+(\d+)/);
  if (cm) {
    g = g.replace(/versionCode\s+\d+/, `versionCode ${Number(cm[1]) + 1}`);
    console.log(`✓ android versionCode     ${cm[1]} -> ${Number(cm[1]) + 1}`);
  }
  if (/versionName\s+"[^"]+"/.test(g)) {
    g = g.replace(/versionName\s+"[^"]+"/, `versionName "${next}"`);
    console.log(`✓ android versionName     -> "${next}"`);
  }
  write(gradlePath, g);
}

// 4. README JSON-LD softwareVersion
const rmPath = 'README.md';
let rm = read(rmPath);
if (/"softwareVersion":\s*"[^"]+"/.test(rm)) {
  rm = rm.replace(/"softwareVersion":\s*"[^"]+"/, `"softwareVersion": "${next}"`);
  write(rmPath, rm);
  console.log(`✓ README JSON-LD          softwareVersion = "${next}"`);
}

// 5. 提示人工事项
console.log(`
下一步（人工）:
  1. 在 CHANGELOG.md 顶部添加 "## v${next} (YYYY-MM-DD)" 版本段（check-version 会强制校验）
  2. 运行 npm run check:version 确认全部一致
  3. 提交: git commit -m "chore: bump version ${prev} -> ${next}"
`);

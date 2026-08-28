#!/usr/bin/env node
/**
 * 版本号一致性校验（单一权威源：package.json）
 *
 * 硬校验（不一致即 exit 1，阻塞 CI）：
 *   1. package.json                     ← 权威源
 *   2. src/cli/version.ts               export const VERSION
 *   3. android/app/build.gradle         versionName（存在 android 目录时）
 *   4. CHANGELOG.md                     最新 `## vX.Y.Z` 段
 *   5. README.md                        JSON-LD softwareVersion
 *
 * 软校验（仅列出供人工复核，不阻塞）：
 *   - docs/*.md 中残留低于当前版本的旧 7.x 版本号
 *
 * 用法：node scripts/check-version.mjs
 * 升版请用：node scripts/bump-version.mjs <X.Y.Z>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

const read = (p) => readFileSync(path.join(root, p), 'utf8');

// ---------- 1. 权威源 ----------
let version;
try {
  const pkg = JSON.parse(read('package.json'));
  version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push(`package.json version 不是合法 SemVer: "${version}"`);
  }
} catch (e) {
  errors.push(`package.json 读取失败: ${e.message}`);
}

if (version) {
  const [maj, min] = version.split('.').map(Number);
  const versionGte = (v) => {
    const [a, b] = v.split('.').map(Number);
    return a > maj || (a === maj && b >= min);
  };

  // ---------- 2. src/cli/version.ts ----------
  try {
    const vt = read('src/cli/version.ts');
    const m = vt.match(/export const VERSION\s*=\s*'([^']+)'/);
    if (!m) errors.push('src/cli/version.ts 找不到 `export const VERSION`');
    else if (m[1] !== version) errors.push(`src/cli/version.ts VERSION='${m[1]}' != package.json ${version}`);
  } catch {
    errors.push('src/cli/version.ts 不存在');
  }

  // ---------- 3. android versionName ----------
  const gradlePath = 'android/app/build.gradle';
  if (existsSync(path.join(root, gradlePath))) {
    const gradle = read(gradlePath);
    const gv = gradle.match(/versionName\s+"([^"]+)"/);
    if (!gv) warnings.push('android/app/build.gradle 找不到 versionName');
    else if (gv[1] !== version) errors.push(`android versionName='${gv[1]}' != package.json ${version}`);
  }

  // ---------- 4. CHANGELOG 最新段 ----------
  try {
    const cl = read('CHANGELOG.md');
    const cv = cl.match(/^## v(\d+\.\d+\.\d+)/m);
    if (!cv) errors.push('CHANGELOG.md 找不到 `## vX.Y.Z` 版本段');
    else if (cv[1] !== version) {
      errors.push(`CHANGELOG.md 最新段为 v${cv[1]}，但 package.json 为 ${version}（发版须先在 CHANGELOG 增加当前版本段）`);
    }
  } catch {
    errors.push('CHANGELOG.md 不存在');
  }

  // ---------- 5. README JSON-LD ----------
  try {
    const rm = read('README.md');
    const sv = rm.match(/"softwareVersion":\s*"([^"]+)"/);
    if (!sv) warnings.push('README.md JSON-LD 找不到 softwareVersion 字段');
    else if (sv[1] !== version) errors.push(`README JSON-LD softwareVersion='${sv[1]}' != package.json ${version}`);
  } catch {
    errors.push('README.md 不存在');
  }

  // ---------- 6. docs 旧版本残留（软校验） ----------
  const docsDir = path.join(root, 'docs');
  if (existsSync(docsDir)) {
    const stale = [];
    for (const f of readdirSync(docsDir).filter((n) => n.endsWith('.md'))) {
      const t = readFileSync(path.join(docsDir, f), 'utf8');
      const vers = new Set();
      for (const m of t.matchAll(/\bv?(7\.\d+\.\d+)\b/g)) vers.add(m[1]);
      for (const v of vers) {
        if (!versionGte(v)) {
          stale.push(`${f}: ${v}`);
          break;
        }
      }
    }
    if (stale.length) {
      warnings.push(`docs/ 下 ${stale.length} 个文件含低于当前版本 ${version} 的 7.x 残留（历史报告中如实引用旧版属正常，请人工确认）：`);
      for (const s of stale) warnings.push(`  - ${s}`);
    }
  }
}

// ---------- 输出 ----------
console.log(`版本一致性校验 · 权威源 package.json = ${version ?? '???'}`);
if (warnings.length) {
  console.log('\n⚠ 警告（不阻塞）:');
  for (const w of warnings) console.log(`  ${w}`);
}
if (errors.length) {
  console.error('\n✗ 校验失败（阻塞）:');
  for (const e of errors) console.error(`  ${e}`);
  console.error('\n一键修复: node scripts/bump-version.mjs <X.Y.Z>');
  process.exit(1);
}
console.log('\n✓ 全部硬校验通过：version.ts / android / CHANGELOG / README JSON-LD 与 package.json 一致');

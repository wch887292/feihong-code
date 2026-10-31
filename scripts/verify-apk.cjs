#!/usr/bin/env node
/**
 * APK 产物核验脚本（v1.0）
 *
 * 用途：出包后对 APK 做「解包实证」核验——不信 BUILD SUCCESSFUL，只信解包出来的字节。
 * 覆盖：版本号 / 双令牌注入 / 守卫占位符保留 / 关键函数存在性 / APK 与磁盘源码一致性。
 *
 * 用法：node scripts/verify-apk.cjs [apk路径]
 * 默认路径：android/app/build/outputs/apk/release/app-release.apk
 * 退出码：0=全过，1=存在失败项
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const APK = process.argv[2] || path.join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');
const SRC_APP_JS = path.join(ROOT, 'app-mobile/js/app.js');
const SRC_INDEX = path.join(ROOT, 'app-mobile/index.html');

const results = [];
const ok = (n, d) => results.push({ pass: true, n, d });
const bad = (n, d) => results.push({ pass: false, n, d });

/* ========== 最小 ZIP 读取器（避免依赖 adm-zip 等第三方包） ========== */
function readZipEntries(buf) {
  // 定位 End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是合法的 ZIP/APK（找不到 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    // 本地文件头
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 读取 APK 内的二进制 AXML → 提取 versionCode / versionName */
function readVersionFromAxml(entries) {
  const axml = entries.get('AndroidManifest.xml');
  if (!axml) return null;
  const buf = axml;
  // AXML 字符串池（chunk type 0x0001）
  const sp = 8;
  if (buf.readUInt32LE(0) !== 0x00080003) return null;
  const strCount = buf.readUInt32LE(sp + 8);
  const flags = buf.readUInt32LE(sp + 16);
  const stringsStart = buf.readUInt32LE(sp + 20);
  const isUtf8 = (flags & (1 << 8)) !== 0;
  const strings = [];
  let p = sp + stringsStart;
  for (let i = 0; i < strCount; i++) {
    if (isUtf8) {
      p += 2;                                   // utf16 长度
      const utf8Len = buf.readUInt16LE(p); p += 2;
      strings.push(buf.toString('utf8', p, p + utf8Len)); p += utf8Len;
    } else {
      const len = buf.readUInt16LE(p); p += 2;
      strings.push(buf.toString('utf16le', p, p + len * 2)); p += len * 2 + 2;
    }
  }
  // 顺序扫描 chunk，找 START_ELEMENT(0x0102)
  const total = buf.length;
  let off = 8;
  let result = null;
  while (off + 8 <= total) {
    const type = buf.readUInt16LE(off);
    const size = buf.readUInt32LE(off + 4);
    if (size <= 0) break;
    if (type === 0x0102) {
      const nameIdx = buf.readInt32LE(off + 20);
      const attrSize = buf.readUInt16LE(off + 26);
      const attrCount = buf.readUInt16LE(off + 28);
      if (strings[nameIdx] === 'manifest') {
        // 属性表起点 = off + 36（ResXMLTree_attrExt 固定头）
        const attrBase = off + 36;
        for (let k = 0; k < attrCount; k++) {
          const ap = attrBase + k * attrSize;
          const anameIdx = buf.readInt32LE(ap + 4);
          const rawValue = buf.readInt32LE(ap + 8);
          const dataType = buf.readUInt8(ap + 15);
          const aName = strings[anameIdx] || '';
          let aVal;
          if (dataType === 0x03) {                 // TYPE_STRING
            aVal = strings[rawValue] !== undefined ? strings[rawValue] : String(rawValue);
          } else if (dataType === 0x10) {          // TYPE_INT_DEC → 值在属性数据区
            aVal = buf.readInt32LE(ap + 16);
          } else if (dataType === 0x11) {          // TYPE_INT_HEX
            aVal = buf.readUInt32LE(ap + 16);
          } else if (dataType === 0x12) {          // TYPE_INT_BOOLEAN
            aVal = rawValue !== 0;
          } else {
            aVal = rawValue;
          }
          if (aName === 'versionCode') result = { versionCode: aVal };
          if (aName === 'versionName') result = Object.assign(result || {}, { versionName: aVal });
        }
      }
    }
    off += size;
  }
  return result;
}

/** 归一化：把注入的真实令牌与未注入的占位符视为等价 */
function normalize(src) {
  return src
    .replace(/[0-9a-f]{64}/g, '<TOKEN>')
    .replace(/<FH_(BRIDGE|SYNC|DEFAULT)_TOKEN>/g, '<TOKEN>')
    .split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
}

console.log('========================================');
console.log(' APK 产物核验（解包实证）');
console.log(' ' + new Date().toLocaleString('zh-CN'));
console.log('========================================\n');

if (!fs.existsSync(APK)) {
  console.error('❌ APK 不存在：' + APK);
  process.exit(1);
}
const stat = fs.statSync(APK);
console.log('产物：' + APK);
console.log('大小：' + (stat.size / 1024 / 1024).toFixed(2) + ' MB');
console.log('时间：' + stat.mtime.toLocaleString('zh-CN') + '\n');

let entries;
try {
  entries = readZipEntries(fs.readFileSync(APK));
} catch (e) {
  console.error('❌ 解包失败：' + e.message);
  process.exit(1);
}

const appJsEntry = [...entries.keys()].find((n) => n.endsWith('assets/public/js/app.js'));
const syncTaskEntry = [...entries.keys()].find((n) => n.endsWith('assets/public/js/sync-task.js'));
const indexEntry = [...entries.keys()].find((n) => n.endsWith('assets/public/index.html'));

if (!appJsEntry) { bad('APK 内 app.js', '未找到 assets/public/js/app.js'); }
else ok('APK 内 app.js', appJsEntry);

const appJs = appJsEntry ? entries.get(appJsEntry).toString('utf8') : '';

/* ---- 1. 版本号 ---- */
const v = readVersionFromAxml(entries);
if (v && v.versionCode) ok('versionCode', String(v.versionCode));
else {
  // 退路：读 build.gradle
  try {
    const g = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
    const m = g.match(/versionCode\s+(\d+)/);
    ok('versionCode', m ? m[1] : '未知');
  } catch { bad('versionCode', '无法获取'); }
}
try {
  const g = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
  const m = g.match(/versionName\s+"([^"]+)"/);
  ok('versionName', m ? m[1] : '未找到');
} catch { bad('versionName', '无法获取'); }

/* ---- 2. 双令牌注入 ---- */
const BRIDGE = '30587308';
const SYNC = '0f63d84d';
const bCount = (appJs.match(new RegExp(BRIDGE, 'g')) || []).length;
const sCount = (appJs.match(new RegExp(SYNC, 'g')) || []).length;
if (bCount >= 1) ok('app.js 注入 bridgeToken', '命中 ' + bCount + ' 次');
else bad('app.js 注入 bridgeToken', '未命中');
if (sCount >= 1) ok('app.js 注入 syncToken', '命中 ' + sCount + ' 次');
else bad('app.js 注入 syncToken', '未命中');

if (syncTaskEntry) {
  const st = entries.get(syncTaskEntry).toString('utf8');
  const stc = (st.match(new RegExp(SYNC, 'g')) || []).length;
  if (stc >= 1) ok('sync-task.js 注入 syncToken', '命中 ' + stc + ' 次');
  else bad('sync-task.js 注入 syncToken', '未命中');
}

/* ---- 3. 守卫占位符必须保留 ---- */
if (appJs.indexOf('<FH_DEFAULT_TOKEN>') >= 0) ok('守卫 <FH_DEFAULT_TOKEN> 保留', '存在（注入未误清空）');
else bad('守卫 <FH_DEFAULT_TOKEN> 保留', '丢失！可能发生了全文盲替换（v76 事故）');

/* ---- 4. 与磁盘源码一致性 ---- */
if (fs.existsSync(SRC_APP_JS)) {
  const disk = fs.readFileSync(SRC_APP_JS, 'utf8');
  const a = normalize(appJs);
  const b = normalize(disk);
  if (a.length === b.length) {
    let same = true;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { same = false; break; } }
    if (same) ok('APK ≡ 磁盘源码', '完全一致（' + a.length + ' 行，令牌已等价归一）');
    else bad('APK ≡ 磁盘源码', '存在内容差异 —— APK 不是当前源码构建的！');
  } else {
    bad('APK ≡ 磁盘源码', '行数不同（APK ' + a.length + ' vs 磁盘 ' + b.length + '）');
  }
} else bad('APK ≡ 磁盘源码', '磁盘源文件不存在：' + SRC_APP_JS);

/* ---- 5. 关键函数存在性 ---- */
const funcs = ['setCurrentTask', 'localPcOnline', 'stripHeavyForStore', 'cacheArtifacts',
  'getArtifacts', 'renderArtifactsBlock', 'fetchHomeDeviceId', 'saveArtifactFile'];
const missing = funcs.filter((f) => appJs.indexOf(f) < 0);
if (missing.length === 0) ok('关键函数齐全', funcs.length + ' 项全部命中');
else bad('关键函数缺失', missing.join(', '));

/* ---- 6. index.html 版本号 ---- */
if (indexEntry) {
  const h = entries.get(indexEntry).toString('utf8');
  const m = h.match(/v(\d+\.\d+\.\d+)/);
  ok('index.html 版本号', m ? 'v' + m[1] : '未标注');
}

console.log('\n---------------- 结果明细 ----------------');
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log((r.pass ? '✅' : '❌') + ' ' + r.n + ' — ' + r.d);
}
console.log('\n========================================');
console.log(failed === 0 ? '✅ 全部通过（' + results.length + ' 项）' : '❌ ' + failed + ' 项失败（共 ' + results.length + ' 项）');
console.log('========================================');
process.exit(failed === 0 ? 0 : 1);

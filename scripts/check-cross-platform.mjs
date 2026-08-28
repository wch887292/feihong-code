#!/usr/bin/env node
/**
 * 跨端一致性冒烟测试（桌面 / 移动 / 扩展 / Web / CLI）
 *
 * 五形态共用契约，任何一处漂移都会让某一端静默故障。本脚本校验：
 *
 *   A. 共性构建产物（依赖 npm run build）
 *      1. dist/cli/index.js        —— 全部端共用的核心引擎
 *      2. dist/web/public/index.html —— Electron 页面 + Capacitor webDir 共同依赖
 *
 *   B. 版本一致性
 *      3. android versionName == package.json（硬）
 *      4. 扩展版本号（软，独立演进仅提示）
 *
 *   C. 配置契约
 *      5. capacitor appId == gradle applicationId（硬）
 *      6. capacitor webDir 指向的目录构建后真实存在（硬）
 *
 *   D. Electron 桌面端
 *      7. electron/main.js 语法有效（node --check）（硬）
 *      8. main.js 引用核心引擎 dist/cli/index.js（硬）
 *
 *   E. VS Code 扩展
 *      9. package.json 可解析、main 入口与 api-client.js 存在（硬）
 *     10. 扩展默认端口 == 服务端默认端口（硬）
 *     11. API 契约：扩展调用的每个 /api/* 端点必须在服务端注册（硬，最高价值）
 *
 *   F. 运行时冒烟（--runtime 时执行）
 *     12. node dist/cli/index.js --version 输出 == package.json 版本
 *
 * 用法：node scripts/check-cross-platform.mjs [--runtime]
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.argv.includes('--runtime');
const errors = [];
const warnings = [];
const ok = [];

const read = (p) => readFileSync(path.join(root, p), 'utf8');
const has = (p) => existsSync(path.join(root, p));
const check = (cond, passMsg, failMsg) => {
  if (cond) { ok.push(passMsg); } else { errors.push(failMsg); }
};

// ---------- 权威版本 ----------
const pkg = JSON.parse(read('package.json'));
const version = pkg.version;

// ---------- A. 共性构建产物 ----------
check(has('dist/cli/index.js'),
  'A1 核心引擎 dist/cli/index.js 存在',
  'A1 缺少 dist/cli/index.js —— 请先 npm run build（全部端共用的核心引擎）');
check(has('dist/web/public/index.html'),
  'A2 Web 静态资源 dist/web/public/index.html 存在',
  'A2 缺少 dist/web/public/index.html —— Electron 页面与安卓 App 共同依赖，请 npm run build');

// ---------- B. 版本一致性 ----------
if (has('android/app/build.gradle')) {
  const gv = read('android/app/build.gradle').match(/versionName\s+"([^"]+)"/);
  check(gv && gv[1] === version,
    `B3 安卓 versionName=${gv ? gv[1] : '?'} 与 package.json ${version} 一致`,
    `B3 安卓 versionName=${gv ? gv[1] : '未找到'} != package.json ${version}（用 npm run bump -- <ver> 同步）`);
}

let extPkg = null;
try {
  extPkg = JSON.parse(read('vscode-extension/package.json'));
  if (extPkg.version !== version) {
    warnings.push(`B4 扩展版本 ${extPkg.version} 与主版本 ${version} 不同（扩展允许独立演进，如需对齐请手动同步）`);
  }
} catch (e) {
  errors.push(`B4 vscode-extension/package.json 解析失败: ${e.message}`);
}

// ---------- C. 配置契约 ----------
const capTs = has('capacitor.config.ts') ? read('capacitor.config.ts') : '';
const capAppId = capTs.match(/appId:\s*'([^']+)'/);
const capWebDir = capTs.match(/webDir:\s*'([^']+)'/);
const gradle = has('android/app/build.gradle') ? read('android/app/build.gradle') : '';
const appPkgId = gradle.match(/applicationId\s+"([^"]+)"/);

check(capAppId && appPkgId && capAppId[1] === appPkgId[1],
  `C5 appId 一致: ${capAppId ? capAppId[1] : '?'}（capacitor == gradle）`,
  `C5 appId 不一致: capacitor=${capAppId ? capAppId[1] : '未找到'} vs gradle=${appPkgId ? appPkgId[1] : '未找到'}`);

if (capWebDir) {
  check(has(capWebDir[1]),
    `C6 capacitor webDir='${capWebDir[1]}' 构建后存在`,
    `C6 capacitor webDir='${capWebDir[1]}' 不存在 —— webDir 指向构建产物，请先 npm run build，或修正 capacitor.config.ts`);
} else {
  warnings.push('C6 capacitor.config.ts 未找到 webDir 配置');
}

// ---------- D. Electron 桌面端 ----------
const elMain = 'electron/main.js';
if (has(elMain)) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, elMain)], { stdio: 'pipe' });
    ok.push('D7 electron/main.js 语法校验通过');
  } catch (e) {
    errors.push(`D7 electron/main.js 语法错误: ${String(e.stderr || e.message).slice(0, 200)}`);
  }
  const mainSrc = read(elMain);
  check(/dist['"`]\s*,\s*['"`]cli['"`]\s*,\s*['"`]index\.js|dist\/cli\/index\.js|'dist', 'cli', 'index\.js'/.test(mainSrc),
    'D8 Electron 引用核心引擎 dist/cli/index.js',
    'D8 electron/main.js 未引用 dist/cli/index.js —— 桌面端可能启动的不是共享内核');
} else {
  errors.push('D7 electron/main.js 不存在');
}

// ---------- E. VS Code 扩展 ----------
const extDir = 'vscode-extension';
if (extPkg) {
  const extMain = extPkg.main ? path.join(extDir, extPkg.main) : null;
  check(extMain && has(extMain),
    `E9 扩展入口 ${extPkg.main} 存在`,
    `E9 扩展 package.json main='${extPkg.main}' 指向的文件不存在`);
  check(has(`${extDir}/api-client.js`),
    'E9 api-client.js 存在',
    `E9 缺少 ${extDir}/api-client.js`);

  // E10 默认端口一致性：扩展默认 8080 == server.ts 默认 8080
  const apiClient = read(`${extDir}/api-client.js`);
  const extPort = apiClient.match(/localhost:(\d+)/);
  const serverTs = read('src/web/server.ts');
  const srvPort = serverTs.match(/FH_WEB_PORT\s*\?\?\s*(\d+)/);
  check(extPort && srvPort && extPort[1] === srvPort[1],
    `E10 默认端口一致: ${extPort ? extPort[1] : '?'}（扩展 == 服务端）`,
    `E10 默认端口不一致: 扩展=${extPort ? extPort[1] : '?'} vs 服务端=${srvPort ? srvPort[1] : '?'} —— 扩展将连不上服务`);

  // E11 API 契约：扩展调用的每个端点必须在服务端注册
  const clientEndpoints = new Set();
  for (const m of apiClient.matchAll(/['"`](\/api\/[A-Za-z0-9_\-./]*)['"`]/g)) {
    clientEndpoints.add(m[1].replace(/\/+$/, '') || '/api');
  }
  const serverRoutes = [...serverTs.matchAll(/app\.(?:get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g)]
    .map((m) => m[1]);

  const seg = (p2) => p2.split('/').filter(Boolean);
  const segMatch = (r, e) => r.startsWith(':') || r === '*' || r === e;
  const matches = (routePattern, endpoint) => {
    const rp = seg(routePattern);
    const ep = seg(endpoint);
    if (rp.length === ep.length) return rp.every((s, i) => segMatch(s, ep[i]));
    if (ep.length < rp.length) return rp.slice(0, ep.length).every((s, i) => segMatch(s, ep[i]));
    return false;
  };

  const missing = [...clientEndpoints].filter((ep) => !serverRoutes.some((r) => matches(r, ep)));
  check(missing.length === 0,
    `E11 API 契约一致: 扩展的 ${clientEndpoints.size} 个端点全部在服务端注册`,
    `E11 扩展调用但服务端未注册的端点: ${missing.join(', ')} —— 扩展将收到 404`);
}

// ---------- F. 运行时冒烟（可选） ----------
// playwright-core 要求 Node >= 20（Node 18 下 CLI 启动即报错退出），故 Node 18 跳过 F12 并降级为警告
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (runtime && nodeMajor < 20) {
  warnings.push(`F12 运行时冒烟在 Node ${nodeMajor} 上跳过（playwright-core 要求 Node >= 20），请在 Node 20+ 矩阵中验证`);
} else if (runtime && has('dist/cli/index.js')) {
  try {
    const out = execFileSync(process.execPath, [path.join(root, 'dist/cli/index.js'), '--version'], {
      encoding: 'utf8', timeout: 30000,
    });
    check(out.includes(version),
      `F12 CLI 运行时 --version 输出包含 ${version}`,
      `F12 CLI --version 输出 "${out.trim().slice(0, 80)}" 未包含 package.json 版本 ${version}`);
  } catch (e) {
    errors.push(`F12 CLI --version 运行失败: ${String(e.message).slice(0, 200)}`);
  }
}

// ---------- 输出 ----------
console.log(`跨端一致性冒烟 · 权威源 package.json = ${version}`);
for (const line of ok) console.log(`  ✓ ${line}`);
if (warnings.length) {
  console.log('\n⚠ 警告（不阻塞）:');
  for (const w of warnings) console.log(`  ${w}`);
}
if (errors.length) {
  console.error('\n✗ 校验失败（阻塞）:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`\n✓ 跨端一致性冒烟全部通过（${ok.length} 项${runtime ? ' + 运行时' : ''}）`);

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 构建后处理：
 * 1. 将 Web 控制台静态资源 src/web/public 复制到 dist/web/public
 * 2. 将 src/self-evolve/manager.js 复制到 dist/self-evolve/（CommonJS 运行时依赖，
 *    tsc 无 allowJs 不会编译它，需手动拷贝，否则 self-evolve hook 运行时报模块缺失）
 * 3. 将 src/cli/self-evolve-cli.js 复制到 dist/cli/（fhcode self-evolve 运行时依赖）
 *
 * 实现说明（2026-09-08 修复）：
 * 本机 Node v22.23.2 的 fs.cpSync(..., { recursive: true }) 会触发原生崩溃
 * （0xC0000409 STATUS_STACK_BUFFER_OVERRUN，无任何输出即退出），
 * 故改用 readdirSync + copyFileSync 手写递归复制，跨平台稳定。
 */
const { readdirSync, mkdirSync, existsSync, copyFileSync, statSync } = require('fs');
const { join, dirname } = require('path');

const root = join(dirname(__filename), '..');

/** 手写递归复制（不依赖 cpSync，规避 Node 22 Windows 原生崩溃） */
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyDir(s, d);
    } else if (st.isFile()) {
      copyFileSync(s, d);
    }
  }
}

function copyOne(src, dst) {
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  return true;
}

// 1. Web 静态资源
const src = join(root, 'src', 'web', 'public');
const dst = join(root, 'dist', 'web', 'public');
if (!existsSync(src)) {
  console.log('[copy-web] 无 src/web/public，跳过');
} else {
  copyDir(src, dst);
  console.log('[copy-web] 已复制 Web 静态资源 -> ' + dst);
}

// 2. self-evolve manager.js（CommonJS，tsc 不编译）
const mgrSrc = join(root, 'src', 'self-evolve', 'manager.js');
const mgrDst = join(root, 'dist', 'self-evolve', 'manager.js');
if (copyOne(mgrSrc, mgrDst)) {
  console.log('[copy-web] 已复制 self-evolve/manager.js -> ' + mgrDst);
}

// 3. self-evolve-cli.js（CommonJS，tsc 不编译；dist/cli/run.js 运行时 require 它）
const cliSrc = join(root, 'src', 'cli', 'self-evolve-cli.js');
const cliDst = join(root, 'dist', 'cli', 'self-evolve-cli.js');
if (copyOne(cliSrc, cliDst)) {
  console.log('[copy-web] 已复制 self-evolve-cli.js -> ' + cliDst);
}

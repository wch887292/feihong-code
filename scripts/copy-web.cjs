/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 构建后处理：
 * 1. 将 Web 控制台静态资源 src/web/public 复制到 dist/web/public
 * 2. 将 src/self-evolve/manager.js 复制到 dist/self-evolve/（CommonJS 运行时依赖，
 *    tsc 无 allowJs 不会编译它，需手动拷贝，否则 self-evolve hook 运行时报模块缺失）
 * 使其随 npm 包（files 白名单含 dist）一同发布。
 */
const { cpSync, mkdirSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(dirname(__filename), '..');

// 1. Web 静态资源
const src = join(root, 'src', 'web', 'public');
const dst = join(root, 'dist', 'web', 'public');

if (!existsSync(src)) {
  console.log('[copy-web] 无 src/web/public，跳过');
} else {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log('[copy-web] 已复制 Web 静态资源 -> ' + dst);
}

// 2. self-evolve manager.js（CommonJS，tsc 不编译）
const mgrSrc = join(root, 'src', 'self-evolve', 'manager.js');
const mgrDst = join(root, 'dist', 'self-evolve', 'manager.js');
if (existsSync(mgrSrc)) {
  mkdirSync(join(root, 'dist', 'self-evolve'), { recursive: true });
  cpSync(mgrSrc, mgrDst);
  console.log('[copy-web] 已复制 self-evolve/manager.js -> ' + mgrDst);
}

// 3. self-evolve-cli.js（CommonJS，tsc 不编译；dist/cli/run.js 运行时 require 它，
//    不复制则构建产物中 `fhcode self-evolve` 报模块缺失）
const cliSrc = join(root, 'src', 'cli', 'self-evolve-cli.js');
const cliDst = join(root, 'dist', 'cli', 'self-evolve-cli.js');
if (existsSync(cliSrc)) {
  mkdirSync(join(root, 'dist', 'cli'), { recursive: true });
  cpSync(cliSrc, cliDst);
  console.log('[copy-web] 已复制 self-evolve-cli.js -> ' + cliDst);
}

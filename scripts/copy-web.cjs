/**
 * 飞虹 Code (Muse Code 参照复刻)
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

// 3. Monaco Editor（AMD 压缩版，供前端代码编辑器使用）
const monacoSrc = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const monacoDst = join(root, 'dist', 'web', 'public', 'vendor', 'monaco', 'vs');
if (existsSync(monacoSrc)) {
  mkdirSync(dirname(monacoDst), { recursive: true });
  cpSync(monacoSrc, monacoDst, { recursive: true });
  console.log('[copy-web] 已复制 Monaco Editor -> ' + monacoDst);
} else {
  console.log('[copy-web] 未找到 monaco-editor/min/vs，跳过（请运行 npm install monaco-editor）');
}

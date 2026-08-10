/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 构建后处理：将 Web 控制台静态资源 src/web/public 复制到 dist/web/public，
 * 使其随 npm 包（files 白名单含 dist）一同发布。
 */
const { cpSync, mkdirSync, existsSync } = require('fs');
const { join, dirname } = require('path');

const root = join(dirname(__filename), '..');
const src = join(root, 'src', 'web', 'public');
const dst = join(root, 'dist', 'web', 'public');

if (!existsSync(src)) {
  console.log('[copy-web] 无 src/web/public，跳过');
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[copy-web] 已复制 Web 静态资源 -> ' + dst);

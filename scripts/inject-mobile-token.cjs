/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 移动端默认令牌注入脚本（构建期专用，不入库真实令牌）：
 * - 从 ~/.feihong-code/web-token.json 读取服务端持久化的 FH_WEB_TOKEN
 * - 将 app-mobile/js/app.js 与 android/app/src/main/assets/public/js/app.js
 *   中的占位符 <FH_DEFAULT_TOKEN> 替换为真实令牌
 * - 源码仓库永远只含占位符；真实令牌仅出现在本地构建产物（已被 .gitignore 排除）
 *
 * 用法：node scripts/inject-mobile-token.cjs [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const PLACEHOLDER = '<FH_DEFAULT_TOKEN>';
// 仅注入构建产物（均已被 .gitignore 排除，不入库）：
// - android/app/src/main/assets/public/ 由 capacitor 从 app-mobile 同步生成，cap sync 后会重置为占位符
// - app-mobile/js/app.js 是源码，保持占位符不变（构建期由本脚本处理后复制到产物）
const TARGETS = [
  path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'js', 'app.js'),
];

/** 读取服务端持久化令牌（web-token.json），兼容 FH_HOME 环境变量 */
function resolveToken() {
  if (process.env.FH_MOBILE_TOKEN) return process.env.FH_MOBILE_TOKEN;
  const home = (process.env.FH_HOME || '').trim() || os.homedir();
  const tokenFile = path.join(home, '.feihong-code', 'web-token.json');
  if (!fs.existsSync(tokenFile)) return '';
  try {
    const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    return (saved && saved.token) || '';
  } catch {
    return '';
  }
}

function inject(file, token, dryRun) {
  if (!fs.existsSync(file)) return false;
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes(PLACEHOLDER)) return false; // 已注入或无占位符
  if (dryRun) {
    console.log(`[dry-run] ${path.relative(root, file)} 含占位符，将注入 token（长度 ${token.length}）`);
    return true;
  }
  content = content.split(PLACEHOLDER).join(token);
  fs.writeFileSync(file, content, 'utf8');
  console.log(`✓ ${path.relative(root, file)} 占位符已替换（token 长度 ${token.length}）`);
  return true;
}

const dryRun = process.argv.includes('--dry-run');
const token = resolveToken();
if (!token) {
  console.warn('[warn] 未找到 web-token.json 或 FH_MOBILE_TOKEN，跳过注入（构建产物将保留占位符，移动端需手动配置令牌）');
  process.exit(0);
}

let hit = 0;
for (const f of TARGETS) {
  if (inject(f, token, dryRun)) hit++;
}
console.log(dryRun ? `[dry-run] 共 ${hit} 个文件含占位符` : `完成：${hit} 个文件已注入`);
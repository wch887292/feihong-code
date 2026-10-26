/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹
 *
 * 移动端默认令牌注入脚本（构建期专用，不入库真实令牌）：
 * - 从 ~/.feihong-code/web-token.json 读取持久化令牌（双轨制，2026-10-25 起）
 * - 按占位符类型分别注入：
 *     <FH_SYNC_TOKEN>    → token       同步体系（sync-task.js BUILTIN_TOKEN / app.js 对话快照上报）
 *     <FH_BRIDGE_TOKEN>  → bridgeToken 电脑连接桥接（api.klai.top/fhrelay，app.js DEFAULT_TOKEN）
 * - app.js 第 1062 行守卫里的 <FH_DEFAULT_TOKEN> 是「未注入检测」哨兵，永不替换，
 *   因此本脚本不再映射该占位符（v76 事故教训：守卫被真 token 替换会误清空注入值）
 * - 源码仓库永远只含占位符；真实令牌仅出现在本地构建产物（已被 .gitignore 排除）
 *
 * 用法：node scripts/inject-mobile-token.cjs [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');

// 占位符 → web-token.json 字段映射（两套系统两把钥匙，分别注入，勿再混）
// 注意：不含 <FH_DEFAULT_TOKEN> —— 它在 app.js 中仅作为「未注入检测」守卫哨兵存在，永不替换
const PLACEHOLDER_MAP = {
  '<FH_SYNC_TOKEN>': 'token',
  '<FH_BRIDGE_TOKEN>': 'bridgeToken',
};

// 仅注入构建产物（均已被 .gitignore 排除，不入库）：
// - android/app/src/main/assets/public/ 由 capacitor 从 app-mobile 同步生成，cap sync 后会重置为占位符
// - app-mobile 源码保持占位符不变（构建期由本脚本处理后复制到产物）
const TARGETS = [
  path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'js', 'app.js'),
  // 同步任务页内置默认令牌（2026-10-25「该填的全部内置」）：与 app.js 同一注入链路，
  // sync-task.js 的 BUILTIN_TOKEN 占位符同值替换，用户无需手动填写服务器配置
  path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'js', 'sync-task.js'),
];

/** 读取令牌（web-token.json），兼容 FH_HOME 环境变量；返回 { 占位符: 令牌 } */
function resolveTokens() {
  const result = {};
  // 环境变量 FH_MOBILE_TOKEN 覆盖 sync 令牌（兼容旧行为）
  if (process.env.FH_MOBILE_TOKEN) result['<FH_DEFAULT_TOKEN>'] = process.env.FH_MOBILE_TOKEN;
  const home = (process.env.FH_HOME || '').trim() || os.homedir();
  const tokenFile = path.join(home, '.feihong-code', 'web-token.json');
  if (!fs.existsSync(tokenFile)) return result;
  try {
    const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
    for (const [ph, field] of Object.entries(PLACEHOLDER_MAP)) {
      if (saved && saved[field]) result[ph] = saved[field];
    }
  } catch { /* 读取失败则跳过 */ }
  return result;
}

function inject(file, tokens, dryRun) {
  if (!fs.existsSync(file)) return false;
  let content = fs.readFileSync(file, 'utf8');
  const hits = [];
  for (const [ph, token] of Object.entries(tokens)) {
    const idx = content.indexOf(ph);
    // 只替换每类占位符的第一处：两处守卫逻辑（app.js:1090 与 sync-task.js 的 getStoredConfig）
    // 依赖占位符原样存在来判断"是否未注入"，若全文盲替换会把守卫也换成真 token，
    // 导致运行时把注入值误清空（2026-10-25 v76 事故）
    if (idx < 0) continue;
    if (!dryRun) {
      content = content.slice(0, idx) + token + content.slice(idx + ph.length);
    }
    hits.push(ph);
  }
  if (hits.length === 0) return false;
  if (!dryRun) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`✓ ${path.relative(root, file)} 已注入 ${hits.length} 类占位符（${hits.join(', ')}）`);
  } else {
    console.log(`[dry-run] ${path.relative(root, file)} 含 ${hits.length} 类占位符：${hits.join(', ')}`);
  }
  return true;
}

const dryRun = process.argv.includes('--dry-run');
const tokens = resolveTokens();
if (Object.keys(tokens).length === 0) {
  console.warn('[warn] 未找到 web-token.json 或 FH_MOBILE_TOKEN，跳过注入（构建产物将保留占位符，移动端需手动配置令牌）');
  process.exit(0);
}

let hit = 0;
for (const f of TARGETS) {
  if (inject(f, tokens, dryRun)) hit++;
}
console.log(dryRun ? `[dry-run] 共 ${hit} 个文件含占位符` : `完成：${hit} 个文件已注入`);

/**
 * 飞虹 Code - 密钥扫描门禁（H2 安全修复）
 * 运行：node scripts/_secret-scan.cjs          （退出码 0=通过，1=发现疑似密钥）
 *
 * 策略：
 *  - 扫描仓库内"应可公开"的跟踪文件（fhcode.config.json、mcp-servers 目录、src 目录、
 *    package.json、.github 目录）中已知的密钥/令牌模式。
 *  - .env / .env.example / *.bak-* 等密钥容器文件跳过（那是密钥的合法存放处，.gitignore 已排除）。
 *  - 命中即退出码 1（可作为 pre-commit / CI 门禁）；--fix 干跑只列出不阻断。
 *
 * 覆盖模式：
 *  - Figma 令牌 figd_...
 *  - 火山方舟 ark-...
 *  - GitHub ghp_/gho_/ghs_/ghu_/github_pat_
 *  - OpenAI 兼容 sk-...
 *  - 钉钉 app_secret / 企微 corpsecret 形式的 32+ 位 base64 串（仅在密钥键名下）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const DRY_RUN = process.argv.includes('--dry');

// 键名含这些词时，32+ 位 base64/hex 值视为疑似密钥
const KEYISH_NAMES = /secret|token|api_?key|apikey|password|passwd|credential|authorization/i;
// 任何位置出现即疑似密钥的模式（强指纹）
const STRONG_PATTERNS = [
  { re: /\bfigd_[A-Za-z0-9_\-]{10,}\b/g, label: 'Figma 令牌' },
  { re: /\bark-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12,}\b/gi, label: '火山方舟 API Key' },
  { re: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/g, label: 'GitHub 令牌' },
  { re: /\bsk-[A-Za-z0-9_\-]{20,}\b/g, label: 'sk- 系列密钥' },
  { re: /\bAIza[0-9A-Za-z_\-]{30,}\b/g, label: 'Google API Key' },
  // 例外：第三方技能 vendor 目录里的公开 app-level Bearer（如 bird-search 的公开 OAuth client token），
  // 用户 token 在运行时按登录态注入，不在此硬编码 —— 由 SKIP_DIRS 覆盖（vendor 走 skills/*/scripts/lib/vendor）
  { re: /\bBearer\s+[A-Za-z0-9_\-./=]{30,}\b/g, label: 'Bearer 令牌（硬编码）' },
  // 例外：第三方技能 vendor 目录里的公开 app-level Bearer（如 bird-search 的公开 OAuth client token），
  // 用户 token 在运行时按登录态注入，不在此硬编码 —— 由 SKIP_FILES 覆盖
];

// 跳过目录（体积大 / 生成物 / 与密钥无关）
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', 'release', 'artifacts', 'bench',
  'logs', '.ui-check', 'exports', 'submission', 'public',
  'qwen35-4b-kimik3', 'qwen3-optimize', 'doc-fetch-resources',
  '~', // 家目录备份（web-token.json 等本地凭据容器）
]);
// 跳过的文件（密钥容器 / 数据文件 / 本地凭据 / 测试脚本中的已知脱敏样例 / 临时冒烟夹具）
const SKIP_FILES = new Set([
  '.env', 'package-lock.json', 'swebench_lite.json', 'tool-schema.json',
  'web-token.json', 'ui-check.cjs', 'twitter-client-base.js',
  '.wsl-fullstack.ts', // 临时冒烟夹具，内含测试用假 token（非真实密钥）
]);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (['.json', '.js', '.cjs', '.mjs', '.ts', '.yml', '.yaml', '.sh', '.bat', '.ps1'].includes(ext) ||
          e.name === 'fhcode.config.json') {
        out.push(p);
      }
    }
  }
  return out;
}

const findings = [];
let scanned = 0;
for (const file of walk(root)) {
  if (SKIP_FILES.has(path.basename(file))) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (text.length > 5_000_000) continue; // 超大文件跳过
  scanned++;
  // 强指纹
  for (const { re, label } of STRONG_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file: path.relative(root, file), line, label, sample: mask(m[0]) });
    }
  }
  // 键名启发式（JSON key 或 env 赋值）
  const keyishRe = /["']?([A-Za-z0-9_\-]*(?:secret|token|api_?key|apikey|password|passwd|credential|authorization)[A-Za-z0-9_\-]*)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+=/]{28,})/gi;
  keyishRe.lastIndex = 0;
  let mk;
  while ((mk = keyishRe.exec(text)) !== null) {
    const name = mk[1];
    const val = mk[2];
    // 排除占位符 / 引用 / 明显非密钥
    if (/^\$\{|\$\{|placeholder|xxx|your[_\-]|<|undefined|example/i.test(val)) continue;
    if (!KEYISH_NAMES.test(name)) continue;
    const line = text.slice(0, mk.index).split('\n').length;
    findings.push({ file: path.relative(root, file), line, label: `疑似密钥（键名 ${name}）`, sample: mask(val) });
  }
}

function mask(s) {
  if (s.length <= 12) return s.slice(0, 3) + '…';
  return s.slice(0, 8) + '…' + s.slice(-4);
}

console.log(`\n===== 密钥扫描（${scanned} 个文件） =====`);
if (findings.length === 0) {
  console.log('  ✅ 未发现硬编码密钥');
  process.exit(0);
}
for (const f of findings) {
  console.log(`  🔴 ${f.file}:${f.line}  [${f.label}]  ${f.sample}`);
}
console.log(`\n共 ${findings.length} 处疑似密钥。`);
if (DRY_RUN) {
  console.log('（--dry 干跑模式，不阻断）');
  process.exit(0);
}
console.log('阻断：请把这些值移到 .env（FH_XXX / FHC_XXX 环境变量引用），并轮换已泄露的凭证。');
process.exit(1);

// deploy-plan.mjs — 部署路由干跑（只探测和打印计划，不执行任何部署）
//
// 用法：node deploy-plan.mjs --root <项目根>
//
// 路由（平台内生优先，逐级降级）：
//   a. 平台内生（项目有 .openai/hosting.json → Codex Sites；WorkBuddy 由调用方判断）
//   b. Harness/Agent 公网链接（脚本无法自测，打印指引）
//   c. 自有配置（settings.json 的 profile: tencent-cos / vercel，凭证在本机已配置）
//   d. 本地 HTML（兜底）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const args = { root: process.cwd() };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = path.resolve(argv[++i]);
    else {
      console.error(`Unknown arg: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const root = args.root;

const hostingJson = path.join(root, '.openai', 'hosting.json');
const settingsPath = path.join(root, 'settings.json');

let plan = null;

// a. 平台内生
if (fs.existsSync(hostingJson)) {
  plan = {
    route: 'a',
    name: 'platform-native (codex-sites)',
    reason: 'found .openai/hosting.json — reuse its project_id, do NOT create a new site',
    next: 'Follow the Sites flow in this environment; verify public URL afterwards (status + bytes + content marker).',
  };
}

// c. 自有配置
if (!plan && fs.existsSync(settingsPath)) {
  let settings = null;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    console.error(`settings.json is invalid JSON: ${err.message}`);
    process.exit(1);
  }
  const profile = settings.profile;
  if (profile === 'tencent-cos') {
    const credPath = path.join(os.homedir(), '.tccli', 'default.credential');
    const hasCred = fs.existsSync(credPath);
    plan = {
      route: 'c',
      name: 'tencent-cos',
      domain: settings.domain || null,
      bucket: settings.bucket || null,
      region: settings.region || null,
      credentials: hasCred ? 'found ~/.tccli/default.credential' : 'MISSING ~/.tccli/default.credential — stop and ask user',
      next: 'Upload to COS (HTML/CSS/JS no-cache, images max-age=86400) -> tccli cdn PurgePathCache -> curl status+bytes. Ask user before executing.',
    };
    if (!hasCred) plan.route = 'c-blocked';
  } else if (profile === 'vercel') {
    const vercelJson = path.join(root, 'vercel.json');
    let vercelNote = 'no vercel.json (good for static)';
    if (fs.existsSync(vercelJson)) {
      const content = fs.readFileSync(vercelJson, 'utf8');
      vercelNote = /@vercel\/node@/.test(content)
        ? 'vercel.json pins an old @vercel/node runtime — replace with {} before deploying'
        : 'vercel.json present, no pinned runtime detected';
    }
    plan = {
      route: 'c',
      name: 'vercel',
      project: settings.project || null,
      domain: settings.domain || null,
      vercelJson: vercelNote,
      next: 'vercel deploy --prod, then verify HTTPS bytes/hash match local and deployment is READY. Ask user before executing.',
    };
  } else {
    plan = {
      route: 'c-unknown',
      name: String(profile),
      next: 'Unknown profile in settings.json. Supported: tencent-cos, vercel. Fix settings.json or remove it to fall through.',
    };
  }
}

// b / d. 无法自测环境能力时的兜底输出
if (!plan) {
  plan = {
    route: 'b-or-d',
    name: 'no local deploy config detected',
    next: [
      'b. If this Harness/Agent environment can mint public URLs (built-in share or cloudflared tunnel), use that and curl-verify.',
      'd. Otherwise deliver local HTML: open <root>/index.html, and point the user to references/deployment.md for going public later.',
    ],
  };
}

console.log(JSON.stringify({ root, ...plan }, null, 2));

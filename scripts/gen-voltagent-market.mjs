/**
 * VoltAgent/awesome-agent-skills 市场种子索引生成器
 *
 * 输入：voltagent_skills.json（从 README 解析的 582 条技能目录）
 * 输出：
 *  1. templates/market/voltagent-index.json —— 符合 agentskills.io 规范的可安装索引
 *     （仅收录标准 raw 路径可直连的官方技能；digest 缺失可再补）
 *  2. docs/VOLTAGENT_SKILLS_CATALOG.md —— 完整 582 条技能目录清单（含厂商分组）
 *
 * 标准 raw 路径：https://raw.githubusercontent.com/<owner>/skills/main/skills/<name>/SKILL.md
 * 说明：各厂商实际仓库路径不一，本生成器仅对标准路径可命中者做可安装索引；
 *       其余技能以目录形式提供官方安装命令（npx skills add <repo> --skill <name>）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const items = JSON.parse(readFileSync(join(ROOT, 'scripts', 'data', 'voltagent_skills.json'), 'utf8'));

// 已验证标准路径可直连的仓库（2026-08-29 实测 HTTP 200）
const VERIFIED_REPOS = new Set([
  'anthropics/skills',
  'composiohq/skills',
  'cloudflare/skills',
]);

// 解析 officialskills.sh URL → 反查源仓库（README 未直接给出仓库，按 owner 归并）
const installable = [];
const catalogByOwner = {};
for (const it of items) {
  // 目录清单：按厂商分组
  (catalogByOwner[it.owner] = catalogByOwner[it.owner] || []).push(it);
  // 可安装：owner 的官方技能仓库走标准路径
  const repo = `${it.owner}/skills`;
  if (VERIFIED_REPOS.has(repo)) {
    installable.push({
      name: it.name,
      type: 'skill-md',
      description: it.desc,
      url: `https://raw.githubusercontent.com/${repo}/main/skills/${it.name}/SKILL.md`,
    });
  }
}

// 已知 404 黑名单（2026-08-29 实测）
const BLACKLIST_404 = new Set(['template', 'sandbox-sdk']);
const filtered = installable.filter((s) => !BLACKLIST_404.has(s.name));

// 1) 市场索引种子
const index = {
  $schema: 'https://feihong-code.example/skill-market-schema-v1.json',
  source: 'voltagent/awesome-agent-skills',
  skills: filtered,
};
mkdirSync(join(ROOT, 'templates', 'market'), { recursive: true });
writeFileSync(join(ROOT, 'templates', 'market', 'voltagent-index.json'), JSON.stringify(index, null, 2), 'utf8');
console.log(`voltagent-index.json 已生成：可安装 ${filtered.length} 条`);

// 2) 完整目录清单文档
const ownerRows = Object.entries(catalogByOwner)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([owner, list]) => `| ${owner} | ${list.length} | ${list.map((x) => x.name).join(', ')} |`);
const md = [
  '# VoltAgent / awesome-agent-skills 技能目录',
  '',
  '> 来源：https://github.com/VoltAgent/awesome-agent-skills（官方+社区 Agent Skills 精选，SKILL.md 格式）',
  '> 生成日期：2026-08-29 · 目录条目：582 条 · 厂商：48 家',
  '',
  '## 一、已接入可安装技能（标准 raw 路径直连）',
  '',
  '以下技能已通过 `scripts/install-voltagent-skills.mjs` 安装到 `~/.feihong-code/skills/`，',
  '并收录于 `templates/market/voltagent-index.json`（`fhcode skill-market search/install` 可用）。',
  '',
  '| 技能 | 来源仓库 | 说明 |',
  '|---|---|---|',
  ...filtered.map((s) => `| ${s.name} | ${s.url.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? '-'} | ${s.description} |`),
  '',
  '## 二、完整目录（582 条，按厂商分组）',
  '',
  '> 各厂商技能仓库路径不一，标准路径未命中的技能可用官方命令安装：',
  '> `npx skills add https://github.com/<owner>/<repo> --skill <name>`',
  '',
  '| 厂商 | 数量 | 技能 |',
  '|---|---|---|',
  ...ownerRows,
  '',
  '---',
  '晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 2026-08-29',
  '',
].join('\n');
writeFileSync(join(ROOT, 'docs', 'VOLTAGENT_SKILLS_CATALOG.md'), md, 'utf8');
console.log('VOLTAGENT_SKILLS_CATALOG.md 已生成');

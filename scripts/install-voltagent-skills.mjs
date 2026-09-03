/**
 * VoltAgent/awesome-agent-skills 官方技能批量安装脚本
 * 来源：anthropics/skills、composiohq/skills、cloudflare/skills（标准 raw 路径可直连）
 * 目标：~/.feihong-code/skills/<name>/SKILL.md（用户级技能目录，discoverSkills 自动发现）
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEST = join(homedir(), '.feihong-code', 'skills');

// owner -> [技能名...]（来自 VoltAgent README 目录，仅标准路径可直连者）
const SKILLS = {
  'anthropics/skills': [
    'docx', 'doc-coauthoring', 'pptx', 'xlsx', 'pdf', 'algorithmic-art',
    'canvas-design', 'frontend-design', 'slack-gif-creator', 'theme-factory',
    'web-artifacts-builder', 'mcp-builder', 'webapp-testing', 'brand-guidelines',
    'internal-comms', 'skill-creator', 'template',
  ],
  'composiohq/skills': ['composio'],
  'cloudflare/skills': ['agents-sdk'],
};

async function main() {
  let ok = 0, fail = 0, skip = 0;
  const fails = [];
  for (const [repo, names] of Object.entries(SKILLS)) {
    for (const name of names) {
      const target = join(DEST, name, 'SKILL.md');
      if (existsSync(target)) { console.log(`SKIP  ${name}（已存在）`); skip++; continue; }
      const url = `https://raw.githubusercontent.com/${repo}/main/skills/${name}/SKILL.md`;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20000);
        const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'fhcode/7.6.0' } });
        clearTimeout(t);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (!/^\s*---[\s\S]*?name\s*:/m.test(text)) throw new Error('缺少 name frontmatter');
        mkdirSync(join(DEST, name), { recursive: true });
        writeFileSync(target, text, 'utf8');
        console.log(`OK    ${name}  <- ${repo} (${text.length}B)`);
        ok++;
      } catch (e) {
        console.log(`FAIL  ${name}  (${e instanceof Error ? e.message : e})`);
        fails.push(name);
        fail++;
      }
    }
  }
  console.log(`\n===== 汇总 =====\n成功 ${ok} · 失败 ${fail} · 跳过 ${skip}`);
  if (fails.length) console.log('失败清单:', fails.join(', '));
}
main();

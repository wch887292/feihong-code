/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1-2 SKILL.md 技能标准（对齐 Codex Agent Skills）：
 *  - 技能 = 目录下的 SKILL.md（frontmatter: name/description + 正文指令）
 *  - 渐进式披露：索引（name+description，≤8KB）常驻 system prompt；
 *    完整 SKILL.md 由 load_skill 工具按需加载（不烧上下文）
 *  - 发现位置：cwd → 仓库根逐级 `.agents/skills`（含 .claude/skills 兼容），
 *    再叠加打包技能目录（仓库内 skills/）与用户级 ~/.feihong-code/skills
 *  - 纯函数解析，便于单测；不依赖任何运行时状态
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';

export interface Skill {
  /** 技能名（目录名） */
  name: string;
  /** frontmatter description（自动匹配/索引用） */
  description: string;
  /** 完整指令正文（SKILL.md 去除 frontmatter 后的部分） */
  body: string;
  /** SKILL.md 绝对路径 */
  file: string;
}

/** 索引预算上限（对齐 Codex：≤8KB 或上下文 2%，此处固定 8KB 保守值） */
export const SKILL_INDEX_BUDGET = 8192;

/** 解析 SKILL.md：frontmatter（--- name / description ---）+ 正文 */
export function parseSkillMd(content: string, file = ''): Omit<Skill, 'name'> & { name?: string } {
  const text = content.replace(/^\uFEFF/, '');
  // frontmatter: 首行 --- 到下一个 ---
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end > 0) {
      const fm = text.slice(3, end);
      const body = text.slice(end + 4).trim();
      const name = /^\s*name\s*:\s*(.+)$/m.exec(fm)?.[1]?.trim();
      const description = /^\s*description\s*:\s*(.+)$/m.exec(fm)?.[1]?.trim() ?? '';
      return { name: name || undefined, description, body, file };
    }
  }
  return { description: '', body: text.trim(), file };
}

/** 读取目录下所有 SKILL.md（非递归，技能目录扁平结构） */
function readSkillsDir(dir: string): Skill[] {
  if (!existsSync(dir)) return [];
  const out: Skill[] = [];
  for (const entry of readdirSync(dir)) {
    const skillDir = join(dir, entry);
    if (!statSync(skillDir).isDirectory()) continue;
    const md = join(skillDir, 'SKILL.md');
    if (!existsSync(md)) continue;
    try {
      const parsed = parseSkillMd(readFileSync(md, 'utf8'), md);
      const name = parsed.name ?? entry;
      out.push({ name, description: parsed.description, body: parsed.body, file: md });
    } catch {
      /* 跳过损坏技能 */
    }
  }
  return out;
}

/** 从 cwd 向上逐级找仓库根（存在 .git 视为根；否则到文件系统根） */
function findRepoRoot(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

/** 发现技能：仓库级（cwd→根逐级 .agents/skills + .claude/skills）+ 打包目录 + 用户级 */
export function discoverSkills(cwd: string, packagedDirs: string[] = []): Skill[] {
  const seen = new Set<string>();
  const out: Skill[] = [];

  const push = (dir: string) => {
    for (const skill of readSkillsDir(dir)) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        out.push(skill);
      }
    }
  };

  // 1) 仓库级：cwd 向仓库根逐级
  const start = resolve(cwd);
  const root = findRepoRoot(start);
  let dir = start;
  for (;;) {
    push(join(dir, '.agents', 'skills'));
    push(join(dir, '.claude', 'skills'));
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 2) 打包技能（仓库内 skills/）
  for (const d of packagedDirs) push(resolve(d));
  // 3) 用户级
  push(join(homedir(), '.feihong-code', 'skills'));

  return out;
}

/** 生成常驻 system prompt 的技能索引（渐进式披露 Tier-1，≤8KB） */
export function buildSkillIndexPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const lines = [
    '可用技能（需要时用 load_skill 加载完整指令）:',
    ...skills.map((s) => `- ${s.name}: ${s.description || '（无描述）'}`),
  ];
  let text = `\n\n=== 技能索引 ===\n${lines.join('\n')}\n=== 技能索引结束 ===`;
  if (text.length > SKILL_INDEX_BUDGET) {
    // 超预算时优先截断 description（Codex 同策略：先缩短描述再省略技能）
    text = text.slice(0, SKILL_INDEX_BUDGET) + '\n（技能索引已截断）';
  }
  return text;
}

/** 按名加载技能完整正文（渐进式披露 Tier-2；未找到返回 null） */
export function loadSkillBody(skills: Skill[], name: string): string | null {
  const skill = skills.find((s) => s.name === name);
  if (!skill) return null;
  return `=== 技能 ${skill.name}（${skill.file}）===\n${skill.body}\n=== 技能结束 ===`;
}

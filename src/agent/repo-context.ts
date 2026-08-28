/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-4/P2-3 仓库指令上下文：
 *  - P0-4：自动发现并注入仓库级 AGENTS.md（对齐 Codex 的 AGENTS.md 优先机制）
 *  - P2-3：支持 `paths` frontmatter 的路径级规则（对齐 Claude Code `.claude/rules/`
 *    与 Gemini JIT 发现）——无 paths 的全局指令常驻 system prompt；带 paths 的
 *    规则只在工具操作相关文件时按需注入，省 token。
 *
 * 发现规则（与 Codex 一致）：从 cwd 开始逐级向上查找 AGENTS.md，
 * 取最近一层命中；未找到返回空串（不抛错，保持离线/无指令场景无感）。
 * 支持 AGENTS.md / CLAUDE.md / .atomcode.md 作为兼容别名。
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

/** 候选指令文件名（AGENTS.md 优先，别名兜底） */
const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', '.atomcode.md'];

/** 单条路径级规则 */
export interface ScopedRule {
  /** frontmatter 声明的路径模式（如 src/、**\/*.ts） */
  paths: string[];
  /** 该规则的指令正文 */
  content: string;
}

/** 解析后的仓库指令 */
export interface RepoInstructions {
  /** 全局指令（无 paths 约束，常驻注入） */
  global: string;
  /** 路径级规则（按需注入） */
  scoped: ScopedRule[];
}

/** 从 cwd 向上逐级查找仓库根（存在 .git 的目录视为根；找不到则到文件系统根） */
function findRepoRoot(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dir; // 已到文件系统根
    dir = parent;
  }
}

/** 解析 AGENTS.md frontmatter（--- 块内的 key: value 与数组） */
function parseFrontmatter(text: string): { paths: string[]; rest: string } {
  if (!text.startsWith('---')) return { paths: [], rest: text };
  const end = text.indexOf('\n---');
  if (end < 0) return { paths: [], rest: text };
  const fm = text.slice(3, end);
  const rest = text.slice(end + 4).trim();
  const paths: string[] = [];
  // 支持 paths: ["src/**", "tests/**"] 或 paths: src/ 单值
  const m = /^\s*paths\s*:\s*(.+)$/m.exec(fm);
  if (m) {
    const raw = m[1].trim();
    if (raw.startsWith('[')) {
      for (const item of raw.matchAll(/"([^"]+)"|'([^']+)'/g)) {
        paths.push(item[1] ?? item[2]);
      }
    } else {
      paths.push(raw.replace(/^["']|["']$/g, ''));
    }
  }
  return { paths, rest };
}

/** glob → 正则：** 任意深度、* 单层通配，其余元字符转义（顺序敏感：先处理 * 再转义） */
function globToRegex(p: string): string {
  let out = '^';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return out + '$';
}

/** 路径模式匹配：支持尾部 /（目录前缀）、**（任意深度）、*（单层通配）与精确匹配 */
export function pathMatches(pattern: string, filePath: string): boolean {
  const p = pattern.replace(/\\/g, '/').replace(/\/+$/, '');
  const f = filePath.replace(/\\/g, '/');
  if (!p) return false;
  // 目录模式（尾部斜杠）：前缀匹配（含边界）
  if (pattern.endsWith('/') || pattern.endsWith('\\')) {
    return f === p || f.startsWith(p + '/');
  }
  // 含通配符：转换为正则
  if (p.includes('*')) {
    try {
      return new RegExp(globToRegex(p)).test(f);
    } catch {
      return false;
    }
  }
  // 精确匹配
  return f === p;
}

/**
 * 读取仓库指令（cwd → 仓库根，取最近一层命中文件），解析为全局 + 路径级规则。
 * 无指令返回空结构；内容总上限 8KB 防撑爆上下文。
 */
export function readRepoInstructions(cwd: string): RepoInstructions {
  const start = resolve(cwd);
  const root = findRepoRoot(start);
  let dir = start;
  for (;;) {
    for (const name of INSTRUCTION_FILES) {
      const file = join(dir, name);
      if (existsSync(file)) {
        try {
          const text = readFileSync(file, 'utf8').trim();
          const { paths, rest } = parseFrontmatter(text);
          const scoped: ScopedRule[] = [];
          const global = paths.length > 0 ? '' : rest;
          if (paths.length > 0 && rest) {
            scoped.push({ paths, content: rest.slice(0, 4096) });
          }
          return { global: global.slice(0, 8192), scoped };
        } catch {
          /* 读取失败跳过该文件 */
        }
      }
    }
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break; // 防御：文件系统根
    dir = parent;
  }
  return { global: '', scoped: [] };
}

/** 已发现的指令文件路径（doctor / 诊断用；无则 null） */
export function findInstructionFile(cwd: string): string | null {
  const start = resolve(cwd);
  const root = findRepoRoot(start);
  let dir = start;
  for (;;) {
    for (const name of INSTRUCTION_FILES) {
      const file = join(dir, name);
      if (existsSync(file)) return file;
    }
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 生成注入 system prompt 的全局指令片段（无指令返回空串） */
export function buildRepoInstructionsPrompt(cwd: string): string {
  const { global } = readRepoInstructions(cwd);
  if (!global) return '';
  const file = findInstructionFile(cwd);
  return `\n\n=== 仓库指令（AGENTS.md，来源: ${file ?? '?'}）===\n${global}\n=== 仓库指令结束 ===`;
}

/** 查询命中某文件路径的路径级规则（JIT 注入用，未命中返回空串） */
export function scopedInstructionsFor(cwd: string, filePath: string): string {
  const { scoped } = readRepoInstructions(cwd);
  const hits = scoped.filter((r) => r.paths.some((p) => pathMatches(p, filePath)));
  if (hits.length === 0) return '';
  const content = hits.map((r) => r.content).join('\n\n').slice(0, 4096);
  return `\n\n=== 路径级规则（匹配 ${filePath}）===\n${content}\n=== 规则结束 ===`;
}

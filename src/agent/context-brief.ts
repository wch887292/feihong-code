/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-A 判别性上下文抽取（context-brief）：
 *  - 把「目标 + 仓库快照」抽取成一段紧凑的「目标签名」brief，前置进子任务下发，
 *    避免把整段全仓 contextString 反复塞进每次 runSubTask 的首轮 prompt（大会话吐空根因）。
 *  - 纯函数：不读写文件、不发网络、可单元测试（同输入两次结果一致）。
 *  - 复用 context-budget.ts 的 estimateTokens 做长度控制，复用 swe-planner 的相关性打分思路。
 *
 * 对标：hyperframes `capture <url>` 抽取「颜色/字体/资源」成 AI-ready scaffold 的思想——
 * 只把判别性片段喂给模型，而非整站。
 */
import type { RepoSnapshot, RepoFileEntry } from './repo-reader';
import { estimateTokens } from './context-budget';

export interface ContextBrief {
  /** 与目标最相关的文件路径（≤15 个） */
  files: string[];
  /** 目标里出现的关键标识符/符号（camelCase/PascalCase 词 + 命中文件基名） */
  symbols: string[];
  /** 仓库验证/构建命令（build/test/验证） */
  cmds: string[];
  /** 目标里出现的约束/红线类表述（禁止/约束/红线/不得/必须/避免/不能） */
  redlines: string[];
  /** 紧凑 markdown 文本（直接可前置进 prompt） */
  briefText: string;
  /** briefText 的 token 估算（用于预算校验） */
  estTokens: number;
}

export interface BuildBriefOptions {
  /** 最多保留文件数（默认 15） */
  maxFiles?: number;
  /** 最多保留符号数（默认 20） */
  maxSymbols?: number;
  /** 约束红线命中关键词（默认内置一组） */
  redlineKeywords?: string[];
}

const DEFAULT_MAX_FILES = 15;
const DEFAULT_MAX_SYMBOLS = 20;

/** 约束/红线类表述关键词（命中任意即视为一条红线） */
export const DEFAULT_REDLINE_KEYWORDS = [
  '禁止', '约束', '红线', '不得', '必须', '避免', '不能', '不允许', '严禁', '只允许', '仅限',
];

/** 从文本里抽取形如标识符的词（camelCase / PascalCase / 下划线，长度≥3） */
function extractIdentifiers(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) || [];
  // 过滤常见非标识符词（中文目标里混入的英文叙述词）
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'true', 'false', 'null',
    'npm', 'run', 'node', 'test', 'build', 'echo', 'then', 'will', 'have', 'each',
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (stopwords.has(lower) || lower.startsWith('get') && lower.length < 6) continue;
    if (!seen.has(lower)) {
      seen.add(lower);
      out.push(m);
    }
  }
  return out;
}

/** 从目标关键词里给单个文件路径打分（关键词重叠数，思路对齐 context-budget.relevanceScore） */
function scoreFile(entry: RepoFileEntry, goalTerms: string[]): number {
  const path = entry.path.toLowerCase();
  const base = entry.path.split('/').pop()?.toLowerCase() || '';
  let score = 0;
  for (const term of goalTerms) {
    if (!term) continue;
    const t = term.toLowerCase();
    if (base.includes(t)) score += 3;
    else if (path.includes(t)) score += 2;
  }
  // 源码、关键文件略微加权，稳定排序
  if (entry.isSource) score += 1;
  return score;
}

/** 取 goal 里长度≥2 的检索词（含中文），用于文件相关性打分 */
function goalSearchTerms(goal: string): string[] {
  return (goal || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);
}

/**
 * 从目标 + 仓库快照构建判别性 brief（纯函数）。
 * @param goal 当前子任务/总体目标描述
 * @param snapshot 仓库快照（仅需其 files / keyFiles / 命令字段，不触发任何磁盘 IO）
 * @param opts 可选参数（文件/符号上限、红线关键词）
 */
export function buildContextBrief(
  goal: string,
  snapshot: RepoSnapshot,
  opts: BuildBriefOptions = {},
): ContextBrief {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxSymbols = opts.maxSymbols ?? DEFAULT_MAX_SYMBOLS;
  const redlineKeywords = opts.redlineKeywords ?? DEFAULT_REDLINE_KEYWORDS;

  // 1) 文件：按与目标相关性排序，取前 N
  const terms = goalSearchTerms(goal);
  const ranked = (snapshot.files || [])
    .filter((f) => f.isSource || (snapshot.keyFiles || []).includes(f.path))
    .map((f) => ({ f, s: scoreFile(f, terms) }))
    .sort((a, b) => b.s - a.s);
  const files = ranked.slice(0, maxFiles).map((x) => x.f.path);

  // 2) 符号：目标里出现的标识符 + 命中文件基名（纯文本抽取，不读文件内容）
  const idents = extractIdentifiers(goal);
  const fileBases = files.map((p) => (p.split('/').pop() || '').replace(/\.[^.]+$/, ''));
  const symbolSet = new Set<string>();
  for (const s of [...idents, ...fileBases]) {
    if (s && s.length >= 3) symbolSet.add(s);
  }
  const symbols = [...symbolSet].slice(0, maxSymbols);

  // 3) 命令：build / test / 验证
  const cmds: string[] = [];
  if (snapshot.buildCommand) cmds.push(`构建: ${snapshot.buildCommand}`);
  if (snapshot.testCommand) cmds.push(`测试: ${snapshot.testCommand}`);
  cmds.push('验证: 改动后必须运行上述命令，依真实退出码判断成败，禁止未跑验证就声称通过');

  // 4) 红线：目标里含约束关键词的行
  const redlines: string[] = (goal || '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && redlineKeywords.some((k) => l.includes(k)));

  // 5) 紧凑 markdown
  const sections: string[] = ['📌 目标签名（context-brief，判别性上下文，非全仓）'];
  if (files.length > 0) sections.push(`相关文件:\n${files.map((f) => `- ${f}`).join('\n')}`);
  if (symbols.length > 0) sections.push(`关键符号: ${symbols.join(', ')}`);
  sections.push(cmds.join('\n'));
  if (redlines.length > 0) sections.push(`约束/红线:\n${redlines.map((r) => `- ${r}`).join('\n')}`);
  sections.push(`仓库规模: 索引 ${snapshot.fileCount} 文件${snapshot.truncated ? '（已截断）' : ''}`);
  const briefText = sections.join('\n');

  return {
    files,
    symbols,
    cmds,
    redlines,
    briefText,
    estTokens: estimateTokens(briefText),
  };
}

/* ========== 自测（tsx src/agent/context-brief.ts 直接运行） ========== */
if (require.main === module) {
  const snap: RepoSnapshot = {
    root: 'demo',
    fileCount: 4,
    totalFiles: 4,
    totalBytes: 0,
    languages: { TypeScript: 3 },
    keyFiles: ['package.json', 'src/agent/swe-agent.ts'],
    testCommand: 'npm test',
    buildCommand: 'npm run build',
    hasPackageJson: true,
    tree: '',
    truncated: false,
    contextString: 'x'.repeat(2500),
    files: [
      { path: 'src/agent/swe-agent.ts', abs: '/x', size: 100, ext: '.ts', isSource: true, isTest: false },
      { path: 'src/agent/repo-reader.ts', abs: '/y', size: 100, ext: '.ts', isSource: true, isTest: false },
      { path: 'src/agent/swe-verifier.ts', abs: '/z', size: 100, ext: '.ts', isSource: true, isTest: false },
      { path: 'README.md', abs: '/r', size: 10, ext: '.md', isSource: false, isTest: false },
    ],
  };
  const b = buildContextBrief('在 swe-agent.ts 的 runSweAgent 里前置 brief，禁止未跑验证就声称通过', snap);
  console.log('files:', b.files);
  console.log('symbols:', b.symbols);
  console.log('redlines:', b.redlines);
  console.log('estTokens:', b.estTokens);
}

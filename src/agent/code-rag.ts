/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-2 RAG 增强代码生成（对齐 Cursor Codebase Indexing）：
 *  - 任务描述 → 关键词提取 → 符号检索 → 相关文件排序
 *  - 上下文分层注入：
 *    · 核心文件（直接命中符号）：全文注入
 *    · 关联文件（依赖/被依赖）：仅符号签名 + import 关系
 *    · 边缘文件：仅列路径
 *  - 生成前自动加载，减少幻觉 API 与类型不匹配
 *  - 与 symbol-index 代码图谱深度集成
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CodeGraph, SymbolEntry } from './symbol-index';
import {
  searchSymbols,
  getDependencies,
  getDependents,
  symbolsForFile,
  graphStats,
} from './symbol-index';

/** RAG 配置 */
export interface RagConfig {
  /** 核心文件最大数量（全文注入） */
  maxCoreFiles: number;
  /** 关联文件最大数量（签名注入） */
  maxRelatedFiles: number;
  /** 单文件全文最大字符数（防止超大文件撑爆上下文） */
  maxFileChars: number;
  /** 符号检索结果上限 */
  maxSymbolResults: number;
  /** 相关性阈值（0-1），低于此值的文件不注入 */
  relevanceThreshold: number;
}

const DEFAULT_CONFIG: RagConfig = {
  maxCoreFiles: 5,
  maxRelatedFiles: 10,
  maxFileChars: 8000,
  maxSymbolResults: 30,
  relevanceThreshold: 0.1,
};

/** 单文件 RAG 检索结果 */
export interface RagFileResult {
  path: string;
  /** 相关性得分（0-1） */
  relevance: number;
  /** 命中的符号 */
  matchedSymbols: SymbolEntry[];
  /** 注入层级：core=全文, related=签名, edge=仅路径 */
  tier: 'core' | 'related' | 'edge';
}

/** RAG 检索完整结果 */
export interface RagResult {
  query: string;
  keywords: string[];
  coreFiles: RagFileResult[];
  relatedFiles: RagFileResult[];
  edgeFiles: RagFileResult[];
  /** 预估 token 数（粗略：4 字符 ≈ 1 token） */
  estimatedTokens: number;
}

/** 常见停用词（不参与检索的通用词） */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
  'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all',
  'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'also', 'now', 'here', 'there', 'then', 'once', 'if', 'because',
  'as', 'until', 'while', 'about', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under',
  'again', 'further', '的', '了', '在', '是', '我', '有', '和', '就',
  '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要',
  '去', '你', '会', '着', '没有', '看', '好', '自己', '这',
]);

/** 从任务描述提取关键词（中英文混合，过滤停用词和短词） */
export function extractKeywords(query: string): string[] {
  // 提取英文单词（含驼峰拆分）和中文词
  const words: string[] = [];

  // 英文标识符（含驼峰：camelCase → camel, case）
  const englishMatches = query.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  for (const w of englishMatches) {
    // 驼峰拆分
    const parts = w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_]+/);
    for (const p of parts) {
      if (p.length >= 2 && !STOP_WORDS.has(p.toLowerCase())) {
        words.push(p.toLowerCase());
      }
    }
    // 完整词也加入（精确匹配用）
    if (w.length >= 3 && !STOP_WORDS.has(w.toLowerCase())) {
      words.push(w.toLowerCase());
    }
  }

  // 中文词组（2-4 字连续中文）
  const chineseMatches = query.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  for (const w of chineseMatches) {
    if (!STOP_WORDS.has(w)) words.push(w);
  }

  // 去重并保留出现顺序
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      result.push(w);
    }
  }
  return result.slice(0, 20); // 最多 20 个关键词
}

/** 计算文件相关性得分（基于命中符号数、符号权重、依赖关系） */
function computeFileRelevance(
  graph: CodeGraph,
  filePath: string,
  keywords: string[],
  matchedSymbols: SymbolEntry[],
): number {
  if (matchedSymbols.length === 0) return 0;

  let score = 0;
  const keywordSet = new Set(keywords);

  // 基础分：每个命中符号 0.2
  score += matchedSymbols.length * 0.2;

  // 精确匹配加分：符号名完全等于某个关键词
  for (const s of matchedSymbols) {
    if (keywordSet.has(s.name.toLowerCase())) score += 0.5;
    if (s.exported) score += 0.1; // 导出符号权重更高
  }

  // 依赖传播：如果该文件被其他命中文件依赖，加关联分
  const dependents = getDependents(graph, filePath);
  for (const dep of dependents) {
    const depSymbols = symbolsForFile(graph, dep);
    if (depSymbols.some((s) => keywordSet.has(s.name.toLowerCase()))) {
      score += 0.1;
    }
  }

  return Math.min(score, 1.0); // 归一化到 0-1
}

/**
 * 核心 RAG 检索：根据任务描述从代码图谱中检索相关文件
 * 返回分层结果（core / related / edge）
 */
export function retrieveRelevantFiles(
  graph: CodeGraph,
  query: string,
  config: Partial<RagConfig> = {},
): RagResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const keywords = extractKeywords(query);

  if (keywords.length === 0 || Object.keys(graph.files).length === 0) {
    return {
      query,
      keywords,
      coreFiles: [],
      relatedFiles: [],
      edgeFiles: [],
      estimatedTokens: 0,
    };
  }

  // 1. 符号检索：对每个关键词搜索符号
  const symbolHits = new Map<string, SymbolEntry[]>(); // file -> symbols
  for (const kw of keywords) {
    const results = searchSymbols(graph, kw, cfg.maxSymbolResults);
    for (const s of results) {
      if (!symbolHits.has(s.file)) symbolHits.set(s.file, []);
      const arr = symbolHits.get(s.file)!;
      if (!arr.some((x) => x.name === s.name)) arr.push(s);
    }
  }

  // 2. 计算每个命中文件的相关性
  const scoredFiles: RagFileResult[] = [];
  for (const [file, symbols] of symbolHits) {
    const relevance = computeFileRelevance(graph, file, keywords, symbols);
    if (relevance >= cfg.relevanceThreshold) {
      scoredFiles.push({ path: file, relevance, matchedSymbols: symbols, tier: 'core' });
    }
  }
  scoredFiles.sort((a, b) => b.relevance - a.relevance);

  // 3. 分层：core = 直接命中, related = 依赖/被依赖, edge = 其余
  const corePaths = new Set(scoredFiles.slice(0, cfg.maxCoreFiles).map((f) => f.path));
  const coreFiles = scoredFiles.filter((f) => corePaths.has(f.path));

  // 关联文件：core 文件的依赖和被依赖
  const relatedSet = new Map<string, number>(); // path -> relevance
  for (const core of coreFiles) {
    const deps = [...getDependencies(graph, core.path), ...getDependents(graph, core.path)];
    for (const dep of deps) {
      if (corePaths.has(dep)) continue;
      const existing = relatedSet.get(dep) ?? 0;
      relatedSet.set(dep, Math.max(existing, core.relevance * 0.5));
    }
  }
  const relatedFiles: RagFileResult[] = Array.from(relatedSet.entries())
    .map(([path, relevance]) => ({
      path,
      relevance,
      matchedSymbols: symbolsForFile(graph, path),
      tier: 'related' as const,
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, cfg.maxRelatedFiles);

  // 边缘文件：仅列路径（不注入内容）
  const allPaths = new Set([...corePaths, ...relatedFiles.map((f) => f.path)]);
  const edgeFiles: RagFileResult[] = scoredFiles
    .filter((f) => !allPaths.has(f.path))
    .slice(0, 20);

  // 4. 估算 token
  let estimatedTokens = 0;
  for (const f of coreFiles) {
    const node = graph.files[f.path];
    if (node) estimatedTokens += Math.min(readFileChars(graph.root, f.path), cfg.maxFileChars) / 4;
  }
  for (const f of relatedFiles) {
    estimatedTokens += (f.matchedSymbols.length * 50) / 4; // 每个签名约 50 字符
  }

  return { query, keywords, coreFiles, relatedFiles, edgeFiles, estimatedTokens: Math.round(estimatedTokens) };
}

/** 读取文件字符数（带缓存） */
const fileSizeCache = new Map<string, number>();
function readFileChars(root: string, relPath: string): number {
  const key = root + '::' + relPath;
  if (fileSizeCache.has(key)) return fileSizeCache.get(key)!;
  try {
    const abs = join(root, relPath);
    if (!existsSync(abs)) return 0;
    const content = readFileSync(abs, 'utf8');
    fileSizeCache.set(key, content.length);
    return content.length;
  } catch {
    return 0;
  }
}

/**
 * 生成 RAG 上下文片段（注入 system prompt）
 * 格式：核心文件全文 + 关联文件签名 + 边缘文件路径列表
 */
export function buildRagContext(
  graph: CodeGraph,
  query: string,
  config: Partial<RagConfig> = {},
): string {
  const result = retrieveRelevantFiles(graph, query, config);
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (result.coreFiles.length === 0 && result.relatedFiles.length === 0) {
    return '';
  }

  const sections: string[] = [];
  sections.push('=== 代码库 RAG 检索结果（基于任务描述自动加载）===');

  // 核心文件：全文注入
  if (result.coreFiles.length > 0) {
    sections.push(`\n【核心文件】（直接命中符号，全文提供）:`);
    for (const f of result.coreFiles) {
      const content = readFileContent(graph.root, f.path, cfg.maxFileChars);
      const symbolNames = f.matchedSymbols.map((s) => `${s.kind}:${s.name}`).join(', ');
      sections.push(`\n--- 文件: ${f.path} (相关性: ${f.relevance.toFixed(2)}, 命中: ${symbolNames}) ---`);
      sections.push(content);
      sections.push('--- 文件结束 ---');
    }
  }

  // 关联文件：仅符号签名
  if (result.relatedFiles.length > 0) {
    sections.push(`\n【关联文件】（依赖/被依赖关系，仅提供符号签名）:`);
    for (const f of result.relatedFiles) {
      if (f.matchedSymbols.length === 0) continue;
      const signatures = f.matchedSymbols
        .map((s) => {
          const exp = s.exported ? 'export ' : '';
          const sig = s.signature ? ` ${s.signature}` : '';
          return `  ${exp}${s.kind} ${s.name}${sig}  [line ${s.line}]`;
        })
        .join('\n');
      sections.push(`\n--- ${f.path} (相关性: ${f.relevance.toFixed(2)}) ---\n${signatures}`);
    }
  }

  // 边缘文件：仅路径
  if (result.edgeFiles.length > 0) {
    sections.push(`\n【其他相关文件】（仅路径，需要时用 read_file 加载）:`);
    for (const f of result.edgeFiles.slice(0, 10)) {
      sections.push(`  - ${f.path} (相关性: ${f.relevance.toFixed(2)})`);
    }
  }

  sections.push(`\n=== RAG 检索结束（关键词: ${result.keywords.slice(0, 8).join(', ')}, 预估 ${result.estimatedTokens} tokens）===`);
  return sections.join('\n');
}

/** 读取文件内容（截断到最大字符数） */
function readFileContent(root: string, relPath: string, maxChars: number): string {
  try {
    const abs = join(root, relPath);
    if (!existsSync(abs)) return `[文件不存在: ${relPath}]`;
    const content = readFileSync(abs, 'utf8');
    if (content.length > maxChars) {
      return content.slice(0, maxChars) + `\n... [文件截断，共 ${content.length} 字符，用 read_file 查看完整内容]`;
    }
    return content;
  } catch {
    return `[读取失败: ${relPath}]`;
  }
}

/** RAG 诊断信息（用于 /doctor 命令和日志） */
export function ragDiagnostics(graph: CodeGraph, query: string): string {
  const stats = graphStats(graph);
  const result = retrieveRelevantFiles(graph, query);
  return [
    `RAG 诊断:`,
    `  代码图谱: ${stats.files} 文件, ${stats.symbols} 符号, ${stats.internalDeps} 内部依赖`,
    `  查询关键词: ${result.keywords.join(', ') || '(无)'}`,
    `  核心文件: ${result.coreFiles.length} (${result.coreFiles.map((f) => f.path).join(', ')})`,
    `  关联文件: ${result.relatedFiles.length}`,
    `  边缘文件: ${result.edgeFiles.length}`,
    `  预估 tokens: ${result.estimatedTokens}`,
  ].join('\n');
}

/** 便捷函数：构建带缓存的 RAG 检索器 */
export function createRagRetriever(graph: CodeGraph, config?: Partial<RagConfig>) {
  return {
    retrieve: (query: string) => retrieveRelevantFiles(graph, query, config),
    buildContext: (query: string) => buildRagContext(graph, query, config),
    diagnostics: (query: string) => ragDiagnostics(graph, query),
    getGraph: () => graph,
  };
}

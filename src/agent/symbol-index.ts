/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-1 仓库级代码图谱（对齐 Cursor 项目级索引）：
 *  - 正则级符号提取（函数/类/接口/const/type），零依赖、跨语言
 *  - 依赖图构建（import/require 关系），支撑相关文件自动加载
 *  - 文件级哈希 + 增量更新（仅重解析变更文件）
 *  - 磁盘缓存（FH_HOME/code-graph.json），重复扫描免开销
 *  - 查询：按符号名 / 按文件定位 / 依赖反向查找 / 符号存在性校验
 *  - 用途：RAG 检索、swe 规划定位目标文件、refactor 影响面、生成后符号校验
 *
 * 注意：这是"轻量"索引（正则近似），非完整 AST 语义；但足以支撑
 * 符号定位、依赖分析与影响面估算，性价比远高于全量解析。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative, resolve, extname, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

export type SymbolKind = 'function' | 'class' | 'interface' | 'const' | 'type';

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  /** 相对仓库根的路径 */
  file: string;
  line: number;
  /** 函数/方法签名（参数列表 + 返回类型注释），非函数类符号为空串 */
  signature: string;
  /** 是否导出（export 关键字） */
  exported: boolean;
}

/** 单条依赖边：from 文件 import 了 to 文件（或裸模块名） */
export interface DependencyEdge {
  from: string;
  /** 相对路径或裸模块名（如 'fs'、'./utils'） */
  to: string;
  /** 是否为相对路径依赖（true 表示项目内文件，false 表示 node_modules / 内置模块） */
  internal: boolean;
}

/** 单文件节点（含哈希，用于增量更新判定） */
export interface FileNode {
  path: string;
  hash: string;
  symbols: SymbolEntry[];
  imports: DependencyEdge[];
}

export interface CodeGraph {
  root: string;
  builtAt: string;
  files: Record<string, FileNode>;
}

/** 兼容旧版 SymbolIndex（扁平符号列表） */
export interface SymbolIndex {
  root: string;
  builtAt: string;
  symbols: SymbolEntry[];
}

/** 支持的语言扩展（正则近似） */
const SUPPORTED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.workbuddy', 'dist_tmp', 'release']);

/** 计算文件内容哈希（SHA-256 前 16 位，足够判定变更） */
export function computeFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** 从单文件内容提取符号（多行正则逐行扫描） */
export function extractSymbols(content: string, file: string): SymbolEntry[] {
  const out: SymbolEntry[] = [];
  const lines = content.split('\n');
  // 顺序敏感：先 interface/class 再 function/const，避免误吞
  const patterns: Array<{ kind: SymbolKind; re: RegExp }> = [
    { kind: 'interface', re: /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'class', re: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'function', re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'const', re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/ },
    { kind: 'type', re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 跳过注释与字符串行（近似）
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    for (const { kind, re } of patterns) {
      const m = re.exec(line);
      if (m) {
        const exported = /^export\s+/.test(line);
        const signature = kind === 'function' ? extractFunctionSignature(lines, i) : '';
        out.push({ name: m[1], kind, file, line: i + 1, signature, exported });
        break; // 每行只记一个符号
      }
    }
  }
  return out;
}

/** 提取函数签名（从定义行开始，尝试捕获到参数列表闭合 + 返回类型注释） */
function extractFunctionSignature(lines: string[], startLine: number): string {
  let collected = '';
  let parenDepth = 0;
  let started = false;
  for (let i = startLine; i < Math.min(startLine + 10, lines.length); i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '(') { parenDepth++; started = true; }
      if (ch === ')') parenDepth--;
    }
    collected += (collected ? ' ' : '') + line.trim();
    if (started && parenDepth <= 0) {
      // 尝试捕获返回类型（: 后到 { 或 = 前）
      const returnMatch = collected.match(/\)\s*:\s*([^{=]+?)(?:\s*[{=]|$)/);
      if (returnMatch) {
        return collected.match(/\(([^)]*)\)/)?.[1]
          ? `(${collected.match(/\(([^)]*)\)/)?.[1]})${returnMatch[1].trim()}`
          : collected;
      }
      return collected.match(/function\s+\w+\s*(.*?)(?:\{|$)/)?.[1]?.trim() || collected;
    }
  }
  return collected || '';
}

/** 从文件内容提取 import/require 依赖 */
export function extractImports(content: string, file: string): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();
  // ES module import: import ... from '...'  /  import '...'
  const importRe = /(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  // CommonJS require: require('...')
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  const collect = (m: RegExpExecArray | null): void => {
    if (!m) return;
    const target = m[1];
    if (seen.has(target)) return;
    seen.add(target);
    const internal = target.startsWith('.') || target.startsWith('/');
    edges.push({ from: file, to: target, internal });
  };

  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) collect(m);
  while ((m = requireRe.exec(content)) !== null) collect(m);
  return edges;
}

/** 递归扫描目录并构建文件节点（跳过 node_modules/.git 等） */
export function scanDirectory(root: string, maxFiles = 2000): FileNode[] {
  const nodes: FileNode[] = [];
  let count = 0;

  const walk = (d: string): void => {
    if (count >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= maxFiles) return;
      const abs = join(d, entry);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(abs);
      } else if (SUPPORTED_EXT.has(extname(entry).toLowerCase()) && !entry.endsWith('.d.ts')) {
        count++;
        try {
          const content = readFileSync(abs, 'utf8');
          const rel = relative(root, abs).replace(/\\/g, '/');
          nodes.push({
            path: rel,
            hash: computeFileHash(content),
            symbols: extractSymbols(content, rel),
            imports: extractImports(content, rel),
          });
        } catch {
          /* 二进制/不可读跳过 */
        }
      }
    }
  };

  walk(root);
  return nodes;
}

/** 构建完整代码图谱 */
export function buildCodeGraph(root: string, opts: { maxFiles?: number } = {}): CodeGraph {
  const nodes = scanDirectory(resolve(root), opts.maxFiles);
  const files: Record<string, FileNode> = {};
  for (const n of nodes) files[n.path] = n;
  return {
    root: resolve(root),
    builtAt: new Date().toISOString(),
    files,
  };
}

/** 增量更新：仅重解析哈希变更的文件，删除已不存在的文件，新增新文件 */
export function incrementalUpdate(graph: CodeGraph, root: string, opts: { maxFiles?: number } = {}): CodeGraph {
  const resolvedRoot = resolve(root);
  const currentNodes = scanDirectory(resolvedRoot, opts.maxFiles);
  const currentPaths = new Set(currentNodes.map((n) => n.path));
  const files: Record<string, FileNode> = { ...graph.files };

  for (const node of currentNodes) {
    const existing = files[node.path];
    if (!existing || existing.hash !== node.hash) {
      files[node.path] = node; // 新增或变更
    }
  }
  // 删除已不存在的文件
  for (const path of Object.keys(files)) {
    if (!currentPaths.has(path)) delete files[path];
  }

  return {
    root: resolvedRoot,
    builtAt: new Date().toISOString(),
    files,
  };
}

/** 缓存文件路径（固定放用户主目录，避免仓库内写缓存；尊重 FH_HOME） */
export function cacheFile(): string {
  const base = process.env.FH_HOME?.trim() || join(homedir(), '.feihong-code');
  return join(base, 'code-graph.json');
}

/** 写缓存 */
export function cacheCodeGraph(graph: CodeGraph): void {
  try {
    const file = cacheFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(graph), 'utf8');
  } catch {
    /* 缓存失败不影响使用 */
  }
}

/** 读缓存（根路径匹配才返回） */
export function loadCachedCodeGraph(root: string): CodeGraph | null {
  try {
    const file = cacheFile();
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as CodeGraph;
    return parsed && parsed.root === resolve(root) && parsed.files ? parsed : null;
  } catch {
    return null;
  }
}

/** 获取图谱中所有符号（扁平列表，兼容旧接口） */
export function getAllSymbols(graph: CodeGraph): SymbolEntry[] {
  return Object.values(graph.files).flatMap((f) => f.symbols);
}

/** 按符号名精确查找（全图谱） */
export function findSymbol(graph: CodeGraph, name: string): SymbolEntry[] {
  return getAllSymbols(graph).filter((s) => s.name === name);
}

/** 按符号名模糊查找（包含匹配，用于 RAG 检索） */
export function searchSymbols(graph: CodeGraph, query: string, limit = 20): SymbolEntry[] {
  const q = query.toLowerCase();
  return getAllSymbols(graph)
    .filter((s) => s.name.toLowerCase().includes(q))
    .sort((a, b) => {
      // 精确匹配优先，其次导出符号优先
      const aExact = a.name.toLowerCase() === q ? 2 : a.exported ? 1 : 0;
      const bExact = b.name.toLowerCase() === q ? 2 : b.exported ? 1 : 0;
      return bExact - aExact;
    })
    .slice(0, limit);
}

/** 按文件列出符号 */
export function symbolsForFile(graph: CodeGraph, file: string): SymbolEntry[] {
  const f = file.replace(/\\/g, '/');
  return graph.files[f]?.symbols ?? [];
}

/** 符号存在性校验（生成后验证用：调用的函数/引用的类型是否在图谱中存在） */
export function symbolExists(graph: CodeGraph, name: string): boolean {
  return getAllSymbols(graph).some((s) => s.name === name);
}

/** 批量符号存在性校验，返回不存在的符号名列表 */
export function findMissingSymbols(graph: CodeGraph, names: string[]): string[] {
  const existing = new Set(getAllSymbols(graph).map((s) => s.name));
  return names.filter((n) => !existing.has(n));
}

/** 获取某文件的直接依赖（import 了哪些项目内文件） */
export function getDependencies(graph: CodeGraph, file: string): string[] {
  const f = file.replace(/\\/g, '/');
  const node = graph.files[f];
  if (!node) return [];
  return node.imports.filter((i) => i.internal).map((i) => resolveImportPath(f, i.to));
}

/** 获取反向依赖（哪些文件 import 了该文件） */
export function getDependents(graph: CodeGraph, file: string): string[] {
  const target = file.replace(/\\/g, '/');
  const dependents: string[] = [];
  for (const [path, node] of Object.entries(graph.files)) {
    for (const imp of node.imports) {
      if (imp.internal && resolveImportPath(path, imp.to) === target) {
        dependents.push(path);
        break;
      }
    }
  }
  return dependents;
}

/** 将相对 import 路径解析为相对仓库根的路径 */
function resolveImportPath(fromFile: string, importPath: string): string {
  if (!importPath.startsWith('.')) return importPath;
  const fromDir = dirname(fromFile);
  let resolved = join(fromDir, importPath).replace(/\\/g, '/');
  // 处理无扩展名的 import（默认 .ts / .tsx / .js）
  if (!extname(resolved)) {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
      if (resolved.endsWith(ext)) break;
    }
  }
  return resolved;
}

/** 图谱统计（诊断/展示用） */
export function graphStats(graph: CodeGraph): {
  files: number;
  symbols: number;
  internalDeps: number;
  externalDeps: number;
  byKind: Record<string, number>;
} {
  const byKind: Record<string, number> = {};
  let symbols = 0;
  let internalDeps = 0;
  let externalDeps = 0;
  for (const f of Object.values(graph.files)) {
    symbols += f.symbols.length;
    for (const s of f.symbols) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
    for (const i of f.imports) {
      if (i.internal) internalDeps++;
      else externalDeps++;
    }
  }
  return { files: Object.keys(graph.files).length, symbols, internalDeps, externalDeps, byKind };
}

// ==================== 向后兼容：旧 SymbolIndex 接口 ====================

/** 兼容旧版：构建扁平符号索引 */
export function buildSymbolIndex(root: string, opts: { maxFiles?: number } = {}): SymbolIndex {
  const graph = buildCodeGraph(root, opts);
  return { root: graph.root, builtAt: graph.builtAt, symbols: getAllSymbols(graph) };
}

/** 兼容旧版：缓存符号索引（实际缓存完整图谱） */
export function cacheSymbolIndex(index: SymbolIndex): void {
  const graph: CodeGraph = {
    root: index.root,
    builtAt: index.builtAt,
    files: {},
  };
  // 将扁平符号按文件重组
  for (const s of index.symbols) {
    if (!graph.files[s.file]) {
      graph.files[s.file] = { path: s.file, hash: '', symbols: [], imports: [] };
    }
    graph.files[s.file].symbols.push(s);
  }
  cacheCodeGraph(graph);
}

/** 兼容旧版：加载缓存的符号索引 */
export function loadCachedSymbolIndex(root: string): SymbolIndex | null {
  const graph = loadCachedCodeGraph(root);
  if (!graph) return null;
  return { root: graph.root, builtAt: graph.builtAt, symbols: getAllSymbols(graph) };
}

/** 兼容旧版：按符号名查找 */
export function findSymbolInIndex(index: SymbolIndex, name: string): SymbolEntry[] {
  return index.symbols.filter((s) => s.name === name);
}

/** 兼容旧版：按文件列出符号 */
export function symbolsForFileInIndex(index: SymbolIndex, file: string): SymbolEntry[] {
  const f = file.replace(/\\/g, '/');
  return index.symbols.filter((s) => s.file === f);
}

/** 兼容旧版：索引统计 */
export function indexStats(index: SymbolIndex): { files: number; symbols: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  const files = new Set<string>();
  for (const s of index.symbols) {
    files.add(s.file);
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  }
  return { files: files.size, symbols: index.symbols.length, byKind };
}

/**
 * 飞虹 Code v7.2.0 LSP 语义服务层（P0-2 修复）
 *
 * 补齐"标准 LSP 服务层"缺口：复用项目已有的语义底座（symbol-index 代码图 +
 * type-checker 类型诊断），对外提供 LSP 风格接口，供 agent 循环 / Web API / IDE 使用：
 *   - diagnostics：文件级语义诊断（对标 LSP textDocument/publishDiagnostics）
 *   - symbols：文件符号列表（对标 LSP documentSymbol）
 *   - definition：符号定义定位（对标 LSP definition）
 *   - hover：符号签名信息（对标 LSP hover）
 *   - graph / search：代码图谱与跨文件符号搜索（对标全仓库语义检索）
 */
import { readFileSync } from 'fs';
import { extname } from 'path';
import {
  buildCodeGraph,
  cacheCodeGraph,
  loadCachedCodeGraph,
  incrementalUpdate,
  searchSymbols,
  symbolsForFile,
  getAllSymbols,
  type CodeGraph,
  type SymbolEntry,
} from '../agent/symbol-index';
import { checkFileTypes, type TypeCheckError } from '../agent/type-checker';

/** 标准诊断条目（LSP Diagnostic 风格） */
export interface LspDiagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  source: 'typescript';
  /** 相对仓库根路径，便于展示 */
  relative: string;
}

export interface LspSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  signature: string;
}

export interface LspDefinition {
  name: string;
  file: string;
  line: number;
  signature: string;
}

export interface LspHover {
  name: string;
  kind: string;
  line: number;
  signature: string;
  file: string;
}

export interface LspGraphSummary {
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  root: string;
}

export interface LspServiceOptions {
  /** 是否启用类型诊断（.ts/.tsx 文件会跑 tsc，耗时较长，默认开） */
  enableDiagnostics?: boolean;
  /** 诊断超时（ms） */
  diagTimeoutMs?: number;
}

const DEFAULT_OPTS: LspServiceOptions = {
  enableDiagnostics: true,
  diagTimeoutMs: 20000,
};

export class LspService {
  private readonly opts: LspServiceOptions;
  private _graph: CodeGraph | null = null;
  private _graphCwd = '';

  constructor(opts: Partial<LspServiceOptions> = {}) {
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  /** 获取（并缓存）代码图谱，带增量更新 */
  getGraph(cwd: string, forceRefresh = false): CodeGraph {
    if (!this._graph || this._graphCwd !== cwd || forceRefresh) {
      this._graph = loadCachedCodeGraph(cwd) ?? buildCodeGraph(cwd, { maxFiles: 3000 });
      try { cacheCodeGraph(this._graph); } catch { /* 缓存失败不影响主流程 */ }
      this._graphCwd = cwd;
    }
    return this._graph;
  }

  /** 增量刷新图谱（文件写入后调用，保持语义最新） */
  refreshGraph(cwd: string): CodeGraph {
    const current = this.getGraph(cwd);
    this._graph = incrementalUpdate(current, cwd, { maxFiles: 3000 });
    try { cacheCodeGraph(this._graph); } catch { /* ignore */ }
    return this._graph;
  }

  /** 文件级语义诊断（LSP publishDiagnostics 风格）。非 .ts/.tsx 返回空。 */
  getDiagnostics(cwd: string, filePath: string): LspDiagnostic[] {
    if (!this.opts.enableDiagnostics) return [];
    const ext = extname(filePath).toLowerCase();
    if (ext !== '.ts' && ext !== '.tsx') return [];
    let errors: TypeCheckError[] = [];
    try {
      const result = checkFileTypes(cwd, filePath);
      errors = result.errors;
    } catch {
      return [];
    }
    return errors.map((e) => ({
      file: e.file,
      line: e.line,
      column: e.column,
      message: e.message,
      severity: e.severity,
      source: 'typescript',
      relative: this.relative(cwd, e.file),
    }));
  }

  /** 文件符号列表（LSP documentSymbol） */
  getSymbols(cwd: string, filePath: string): LspSymbol[] {
    const graph = this.getGraph(cwd);
    const symbols = symbolsForFile(graph, this.toGraphKey(cwd, filePath));
    return this.toLspSymbols(symbols);
  }

  /** 全仓库符号搜索（LSP workspace/symbol） */
  search(cwd: string, query: string, limit = 20): LspSymbol[] {
    const graph = this.getGraph(cwd);
    return this.toLspSymbols(searchSymbols(graph, query, limit));
  }

  /** 定义定位（LSP definition）：找目标文件中指定行附近的符号 */
  getDefinition(cwd: string, filePath: string, line: number): LspDefinition | null {
    const graph = this.getGraph(cwd);
    const symbols = symbolsForFile(graph, this.toGraphKey(cwd, filePath));
    const hit = symbols
      .filter((s) => Math.abs(s.line - line) <= 2)
      .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0];
    if (!hit) return null;
    return { name: hit.name, file: hit.file, line: hit.line, signature: hit.signature };
  }

  /** 悬停信息（LSP hover） */
  getHover(cwd: string, filePath: string, line: number): LspHover | null {
    const def = this.getDefinition(cwd, filePath, line);
    if (!def) return null;
    return { name: def.name, kind: 'symbol', line: def.line, signature: def.signature, file: def.file };
  }

  /** 图谱摘要 */
  getGraphSummary(cwd: string): LspGraphSummary {
    const graph = this.getGraph(cwd);
    const files = graph.files ?? {};
    const edgeCount = Object.values(files).reduce((n, f) => n + (f.imports ?? []).length, 0);
    return {
      fileCount: Object.keys(files).length,
      symbolCount: getAllSymbols(graph).length,
      edgeCount,
      root: cwd,
    };
  }

  private toGraphKey(cwd: string, file: string): string {
    const f = file.replace(/\\/g, '/');
    const c = cwd.replace(/\\/g, '/').replace(/\/$/, '');
    if (f.startsWith(c + '/')) return f.slice(c.length + 1);
    return f;
  }

  private toLspSymbols(symbols: SymbolEntry[]): LspSymbol[] {
    return symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      file: s.file,
      line: s.line,
      signature: s.signature,
    }));
  }

  private relative(cwd: string, file: string): string {
    try {
      const rel = file.startsWith(cwd) ? file.slice(cwd.length).replace(/^[\\/]+/, '') : file;
      return rel;
    } catch { return file; }
  }
}

export function createLspService(opts?: Partial<LspServiceOptions>): LspService {
  return new LspService(opts);
}

/** 便捷函数：读取文件内容（供诊断/符号上下文展示） */
export function readFileContent(filePath: string): string | null {
  try { return readFileSync(filePath, 'utf8'); } catch { return null; }
}

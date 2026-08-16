/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P5-5 轻量语义索引（对齐 Cursor 项目级索引的轻量实现）：
 *  - 正则级符号提取（函数/类/接口/const/type），零依赖、跨语言
 *  - 磁盘缓存（FH_HOME/symbol-index.json），重复扫描免开销
 *  - 查询：按符号名 / 按文件定位定义位置
 *  - 用途：/grill 审查聚焦、swe 规划定位目标文件、refactor 影响面
 *
 * 注意：这是"轻量"索引（正则近似），非完整 AST 语义；但足以支撑
 * 符号定位与影响面估算，性价比远高于全量解析。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative, resolve, extname } from 'path';
import { homedir } from 'os';

export type SymbolKind = 'function' | 'class' | 'interface' | 'const' | 'type';

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  /** 相对仓库根的路径 */
  file: string;
  line: number;
}

export interface SymbolIndex {
  root: string;
  builtAt: string;
  symbols: SymbolEntry[];
}

/** 支持的语言扩展（正则近似） */
const SUPPORTED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.workbuddy']);

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
        out.push({ name: m[1], kind, file, line: i + 1 });
        break; // 每行只记一个符号
      }
    }
  }
  return out;
}

/** 递归扫描目录并提取全部符号（跳过 node_modules/.git 等） */
export function scanDirectory(root: string, maxFiles = 2000): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
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
          symbols.push(...extractSymbols(content, rel));
        } catch {
          /* 二进制/不可读跳过 */
        }
      }
    }
  };

  walk(root);
  return symbols;
}

/** 构建符号索引 */
export function buildSymbolIndex(root: string, opts: { maxFiles?: number } = {}): SymbolIndex {
  return {
    root: resolve(root),
    builtAt: new Date().toISOString(),
    symbols: scanDirectory(resolve(root), opts.maxFiles),
  };
}

/** 缓存文件路径（固定放用户主目录，避免仓库内写缓存；尊重 FH_HOME） */
export function cacheFile(): string {
  const base = process.env.FH_HOME?.trim() || join(homedir(), '.feihong-code');
  return join(base, 'symbol-index.json');
}

/** 写缓存 */
export function cacheSymbolIndex(index: SymbolIndex): void {
  try {
    const file = cacheFile();
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(index), 'utf8');
  } catch {
    /* 缓存失败不影响使用 */
  }
}

/** 读缓存（根路径匹配才返回） */
export function loadCachedSymbolIndex(root: string): SymbolIndex | null {
  try {
    const file = cacheFile();
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as SymbolIndex;
    return parsed && parsed.root === resolve(root) ? parsed : null;
  } catch {
    return null;
  }
}

/** 按符号名精确查找（全索引） */
export function findSymbol(index: SymbolIndex, name: string): SymbolEntry[] {
  return index.symbols.filter((s) => s.name === name);
}

/** 按文件列出符号 */
export function symbolsForFile(index: SymbolIndex, file: string): SymbolEntry[] {
  const f = file.replace(/\\/g, '/');
  return index.symbols.filter((s) => s.file === f);
}

/** 文件数量与符号数量（诊断/展示用） */
export function indexStats(index: SymbolIndex): { files: number; symbols: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  const files = new Set<string>();
  for (const s of index.symbols) {
    files.add(s.file);
    byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  }
  return { files: files.size, symbols: index.symbols.length, byKind };
}

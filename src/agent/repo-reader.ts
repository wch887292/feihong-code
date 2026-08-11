/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M9 仓库读取器（RepoReader）：
 *  - 扫描整个代码仓库（支持大型仓库，含文件数/体积限流与 .gitignore 解析）
 *  - 产出结构化 RepoSnapshot：文件树、语言分布、关键文件、测试/构建命令、上下文串
 *  - 离线/无模型时也能工作，作为全自动软件工程 Agent 的「认知起点」
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative, extname, basename, dirname } from 'path';

export interface RepoFileEntry {
  /** 相对仓库根目录的路径 */
  path: string;
  /** 绝对路径 */
  abs: string;
  size: number;
  ext: string;
  /** 是否源码（用于统计与上下文拼接） */
  isSource: boolean;
  /** 是否测试文件 */
  isTest: boolean;
}

export interface RepoSnapshot {
  root: string;
  /** 扫描到的文件总数（命中限流时可能少于实际） */
  fileCount: number;
  /** 实际仓库文件数（不计入被忽略项），用于汇报规模 */
  totalFiles: number;
  totalBytes: number;
  languages: Record<string, number>;
  /** 关键文件：package.json / README / 配置 / 入口 */
  keyFiles: string[];
  /** 检测到的测试框架命令（按优先级） */
  testCommand?: string;
  testFramework?: string;
  /** 构建命令（来自 package.json scripts.build 或类型推断） */
  buildCommand?: string;
  hasPackageJson: boolean;
  /** 顶层目录结构（限深） */
  tree: string;
  /** 是否因限流而截断扫描 */
  truncated: boolean;
  /** 拼接给模型的仓库上下文（限长） */
  contextString: string;
  /** 完整文件清单（用于任务规划时定位目标文件） */
  files: RepoFileEntry[];
}

export interface RepoReaderOptions {
  /** 最大扫描文件数（大型仓库保护，默认 2000） */
  maxFiles?: number;
  /** 单文件读取用于上下文预览的最大字节（默认 64KB） */
  maxPreviewBytes?: number;
  /** 树形展示最大深度（默认 3） */
  treeDepth?: number;
  /** 上下文串最大长度（默认 6000 字符） */
  maxContextLength?: number;
  /** 是否包含文件内容预览（默认 false，避免超大上下文） */
  includePreviews?: boolean;
}

const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
  'target',
  'vendor',
  '.turbo',
  'tmp',
  'temp',
  '__pycache__',
];

const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.scala',
  '.sh',
  '.sql',
  '.vue',
  '.svelte',
]);

const TEST_EXTS = new Set(['.test.', '.spec.', '.tests.', '_test.', '-test.', '_spec.']);

function isTestFile(p: string): boolean {
  const lower = basename(p).toLowerCase();
  return (
    TEST_EXTS.has('.' + lower.replace(/.*\.([a-z]+)$/, '$1')) ||
    /\.(test|spec)\.[jt]sx?$/.test(p) ||
    p.includes('/test/') ||
    p.includes('/tests/') ||
    p.includes('/__tests__/') ||
    p.toLowerCase().includes('test.')
  );
}

function parseGitignore(root: string): string[] {
  const giPath = join(root, '.gitignore');
  if (!existsSync(giPath)) return [];
  try {
    const raw = readFileSync(giPath, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/^\/+/, '').replace(/\/+$/, ''));
  } catch {
    return [];
  }
}

function matchesIgnore(relPath: string, ignores: string[]): boolean {
  const parts = relPath.split('/');
  for (const ig of ignores) {
    if (!ig) continue;
    if (ig === parts[0]) return true;
    if (relPath === ig) return true;
    if (relPath.startsWith(ig + '/')) return true;
    // 通配目录
    if (ig.includes('/') && relPath.startsWith(ig)) return true;
  }
  return false;
}

function langFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript(JSX)',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript(JSX)',
    '.mjs': 'JavaScript(ESM)',
    '.cjs': 'JavaScript(CJS)',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.c': 'C',
    '.cpp': 'C++',
    '.h': 'C/C++ Header',
    '.hpp': 'C++ Header',
    '.cs': 'C#',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.swift': 'Swift',
    '.kt': 'Kotlin',
    '.scala': 'Scala',
    '.sh': 'Shell',
    '.sql': 'SQL',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
    '.json': 'JSON',
    '.md': 'Markdown',
    '.yml': 'YAML',
    '.yaml': 'YAML',
  };
  return map[ext.toLowerCase()] || (ext ? ext.slice(1) : 'other');
}

/** 读取整个代码仓库，产出结构化快照 */
export function readRepository(root: string, opts: RepoReaderOptions = {}): RepoSnapshot {
  const maxFiles = opts.maxFiles ?? 2000;
  const treeDepth = opts.treeDepth ?? 3;
  const maxContextLength = opts.maxContextLength ?? 6000;
  const maxPreviewBytes = opts.maxPreviewBytes ?? 64 * 1024;

  const ignores = parseGitignore(root);
  const files: RepoFileEntry[] = [];
  const languages: Record<string, number> = {};
  let totalBytes = 0;
  let truncated = false;

  // BFS 遍历，带深度限制与忽略
  const walk = (dir: string, depth: number): void => {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      const rel = relative(root, abs);
      if (DEFAULT_IGNORES.includes(name) || matchesIgnore(rel, ignores)) continue;
      if (st.isDirectory()) {
        walk(abs, depth + 1);
      } else if (st.isFile()) {
        const ext = extname(name).toLowerCase();
        const isSource = SOURCE_EXTS.has(ext);
        const entry: RepoFileEntry = {
          path: rel,
          abs,
          size: st.size,
          ext,
          isSource,
          isTest: isTestFile(rel),
        };
        files.push(entry);
        totalBytes += st.size;
        if (isSource) {
          const lang = langFromExt(ext);
          languages[lang] = (languages[lang] ?? 0) + 1;
        }
      }
    }
  };
  walk(root, 0);

  // 关键文件识别
  const keyFiles: string[] = [];
  const candidates = [
    'package.json',
    'pyproject.toml',
    'go.mod',
    'Cargo.toml',
    'pom.xml',
    'build.gradle',
    'requirements.txt',
    'README.md',
    'README.rst',
    'README',
    'tsconfig.json',
    'vite.config.ts',
    'webpack.config.js',
    'jest.config.js',
    'vitest.config.ts',
    'Dockerfile',
    '.github/workflows',
  ];
  for (const c of candidates) {
    if (existsSync(join(root, c))) keyFiles.push(c);
  }
  // 入口文件（index/main/bin）
  for (const f of files) {
    const b = basename(f.path);
    if (/^(index|main|app|server|cli)\.(ts|tsx|js|jsx|mjs|go|py|rs|java)$/.test(b)) {
      if (!keyFiles.includes(f.path)) keyFiles.push(f.path);
    }
  }

  // 测试 / 构建命令探测
  let testCommand: string | undefined;
  let testFramework: string | undefined;
  let buildCommand: string | undefined;
  let hasPackageJson = false;
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    hasPackageJson = true;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (scripts.test) testCommand = `npm test`;
      else if (deps['jest']) {
        testFramework = 'jest';
        testCommand = 'npx jest';
      } else if (deps['vitest']) {
        testFramework = 'vitest';
        testCommand = 'npx vitest run';
      } else if (deps['mocha']) {
        testFramework = 'mocha';
        testCommand = 'npx mocha';
      }
      if (scripts.build) buildCommand = `npm run build`;
      else if (deps['tsc'] || deps['typescript']) buildCommand = 'npx tsc --noEmit';
      else if (deps['tsx']) buildCommand = 'npx tsx --eval "0"';
    } catch {
      /* 忽略损坏的 package.json */
    }
  }
  // Python / Go / Rust 兜底
  if (!testCommand) {
    if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'pytest.ini'))) {
      testFramework = 'pytest';
      testCommand = 'python -m pytest';
    } else if (existsSync(join(root, 'go.mod'))) {
      testFramework = 'go test';
      testCommand = 'go test ./...';
    } else if (existsSync(join(root, 'Cargo.toml'))) {
      testFramework = 'cargo test';
      testCommand = 'cargo test';
    }
  }

  const tree = buildTree(root, files, treeDepth);
  const contextString = buildContextString({
    root,
    languages,
    keyFiles,
    testCommand,
    testFramework,
    buildCommand,
    tree,
    files,
    maxContextLength,
    maxPreviewBytes,
    includePreviews: opts.includePreviews,
  });

  return {
    root,
    fileCount: files.length,
    totalFiles: files.length,
    totalBytes,
    languages,
    keyFiles,
    testCommand,
    testFramework,
    buildCommand,
    hasPackageJson,
    tree,
    truncated,
    contextString,
    files,
  };
}

/** 生成限深的目录树文本 */
function buildTree(root: string, files: RepoFileEntry[], maxDepth: number): string {
  const prefix = root.replace(/[\\/]+$/, '');
  const lines: string[] = [basename(prefix) || prefix];
  const dirSet = new Set<string>();
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i <= Math.min(parts.length - 1, maxDepth); i++) {
      dirSet.add(parts.slice(0, i).join('/'));
    }
  }
  const dirs = [...dirSet].sort();
  for (const d of dirs) {
    const depth = d.split('/').length;
    const indent = '  '.repeat(depth);
    lines.push(`${indent}📁 ${basename(d)}/`);
  }
  // 标注关键文件与源码数量
  const topFiles = files.filter((f) => !f.path.includes('/')).map((f) => `  📄 ${f.path}`);
  lines.push(...topFiles);
  const srcCount = files.filter((f) => f.isSource).length;
  lines.push(`\n  … 共 ${files.length} 个文件被索引，${srcCount} 个源码文件`);
  return lines.join('\n');
}

/** 拼接给模型的仓库上下文（限长） */
function buildContextString(parts: {
  root: string;
  languages: Record<string, number>;
  keyFiles: string[];
  testCommand?: string;
  testFramework?: string;
  buildCommand?: string;
  tree: string;
  files: RepoFileEntry[];
  maxContextLength: number;
  maxPreviewBytes: number;
  includePreviews?: boolean;
}): string {
  const langStr = Object.entries(parts.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');

  const sections: string[] = [];
  sections.push(`# 仓库上下文 (${parts.root})`);
  sections.push(`## 语言分布\n${langStr || '（无源码）'}`);
  if (parts.keyFiles.length) {
    sections.push(`## 关键文件\n${parts.keyFiles.map((f) => `- ${f}`).join('\n')}`);
  }
  sections.push(
    `## 验证能力\n- 测试命令: ${parts.testCommand ?? '（未检测到测试框架）'}` +
      (parts.testFramework ? ` (${parts.testFramework})` : '') +
      `\n- 构建命令: ${parts.buildCommand ?? '（未检测到构建脚本）'}`,
  );
  sections.push(`## 目录结构\n\`\`\`\n${parts.tree}\n\`\`\``);

  if (parts.includePreviews) {
    const previewFiles = parts.files
      .filter((f) => f.isSource && f.size <= parts.maxPreviewBytes)
      .slice(0, 12);
    const previews: string[] = [];
    for (const f of previewFiles) {
      try {
        const content = readFileSync(f.abs, 'utf8').slice(0, 1200);
        previews.push(`### ${f.path}\n\`\`\`\n${content}\n\`\`\``);
      } catch {
        /* skip */
      }
    }
    if (previews.length) sections.push(`## 源码预览\n${previews.join('\n\n')}`);
  }

  let out = sections.join('\n\n');
  if (out.length > parts.maxContextLength) {
    out = out.slice(0, parts.maxContextLength) + '\n…（上下文已截断，使用 includePreviews 可获取更多）';
  }
  return out;
}

/** 便捷函数：把快照写入文件（便于调试与审计） */
export function writeSnapshot(snapshot: RepoSnapshot, outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
}

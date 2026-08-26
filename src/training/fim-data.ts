/**
 * 飞虹 Code - FIM (Fill-In-the-Middle) 训练数据准备 (P3-1)
 *
 * 从代码库生成 FIM 格式的训练数据，用于专用补全模型微调。
 * FIM 格式：将代码随机分成 prefix / suffix / middle 三部分，
 * 模型学习根据 prefix 和 suffix 预测 middle（即光标位置的补全）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { logger } from '../shared/logger';

/** 支持的编程语言及其扩展名 */
const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  java: ['.java'],
  go: ['.go'],
  rust: ['.rs'],
  cpp: ['.cpp', '.cc', '.cxx', '.h', '.hpp'],
  c: ['.c', '.h'],
  csharp: ['.cs'],
  php: ['.php'],
  ruby: ['.rb'],
  swift: ['.swift'],
  kotlin: ['.kt', '.kts'],
  html: ['.html', '.htm'],
  css: ['.css', '.scss', '.less'],
  sql: ['.sql'],
  shell: ['.sh', '.bash', '.zsh'],
  yaml: ['.yml', '.yaml'],
  json: ['.json'],
  markdown: ['.md', '.markdown'],
};

/** 忽略的目录和文件 */
const IGNORE_PATTERNS = [
  'node_modules', '.git', 'dist', 'build', 'out',
  '.next', '.nuxt', '.cache', '.turbo',
  'coverage', '.nyc_output',
  'vendor', 'third_party',
  '__pycache__', '.pytest_cache',
  'target', 'bin', 'obj',
  '.idea', '.vscode',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
];

/** FIM 训练样本 */
export interface FimSample {
  prefix: string;
  suffix: string;
  middle: string;
  file_path: string;
  language: string;
  cursor_offset: number;
  middle_length: number;
}

/** 数据准备配置 */
export interface FimDataConfig {
  sourceDir: string;
  outputPath: string;
  samplesPerFile?: number;
  maxFileSize?: number;
  minMiddleLength?: number;
  maxMiddleLength?: number;
  minPrefixLength?: number;
  minSuffixLength?: number;
  languages?: string[];
  trainRatio?: number;
  seed?: number;
}

const DEFAULT_CONFIG: Required<Omit<FimDataConfig, 'sourceDir' | 'outputPath'>> = {
  samplesPerFile: 5,
  maxFileSize: 100 * 1024,
  minMiddleLength: 10,
  maxMiddleLength: 200,
  minPrefixLength: 50,
  minSuffixLength: 10,
  languages: [],
  trainRatio: 0.9,
  seed: 42,
};

/** 可复现随机数生成器（Mulberry32） */
function createRng(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (exts.includes(ext)) return lang;
  }
  return null;
}

function shouldIgnore(filePath: string): boolean {
  for (const pattern of IGNORE_PATTERNS) {
    if (filePath.includes(pattern)) return true;
  }
  return false;
}

function scanFiles(dir: string, languages: string[]): Array<{ path: string; language: string }> {
  const results: Array<{ path: string; language: string }> = [];
  function scan(currentDir: string) {
    let entries: string[];
    try { entries = readdirSync(currentDir); } catch { return; }
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      if (shouldIgnore(fullPath)) continue;
      let stats;
      try { stats = statSync(fullPath); } catch { continue; }
      if (stats.isDirectory()) {
        scan(fullPath);
      } else if (stats.isFile()) {
        const language = detectLanguage(fullPath);
        if (language && (languages.length === 0 || languages.includes(language))) {
          results.push({ path: fullPath, language });
        }
      }
    }
  }
  scan(dir);
  return results;
}

function generateFimSample(
  content: string,
  rng: () => number,
  config: Required<Omit<FimDataConfig, 'sourceDir' | 'outputPath'>>,
): FimSample | null {
  const totalLength = content.length;
  for (let attempt = 0; attempt < 10; attempt++) {
    const middleLength = Math.floor(
      config.minMiddleLength + rng() * (config.maxMiddleLength - config.minMiddleLength),
    );
    const minCursor = config.minPrefixLength;
    const maxCursor = totalLength - middleLength - config.minSuffixLength;
    if (maxCursor <= minCursor) continue;
    const cursorOffset = Math.floor(minCursor + rng() * (maxCursor - minCursor));
    const prefix = content.slice(0, cursorOffset);
    const middle = content.slice(cursorOffset, cursorOffset + middleLength);
    const suffix = content.slice(cursorOffset + middleLength);
    if (prefix.length < config.minPrefixLength) continue;
    if (suffix.length < config.minSuffixLength) continue;
    if (middle.length < config.minMiddleLength) continue;
    if (middle.trim().length === 0) continue;
    return {
      prefix, suffix, middle,
      file_path: '', language: '',
      cursor_offset: cursorOffset,
      middle_length: middleLength,
    };
  }
  return null;
}

export class FimDataPreparer {
  private config: Required<FimDataConfig>;
  private rng: () => number;

  constructor(config: FimDataConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<FimDataConfig>;
    this.rng = createRng(this.config.seed);
  }

  prepare(): { trainCount: number; valCount: number; totalFiles: number; outputPath: string } {
    const { sourceDir, outputPath, samplesPerFile, maxFileSize, trainRatio } = this.config;
    logger.info('开始准备 FIM 训练数据', { sourceDir, outputPath });

    const files = scanFiles(sourceDir, this.config.languages);
    logger.info(`扫描到 ${files.length} 个代码文件`);
    if (files.length === 0) throw new Error(`未在 ${sourceDir} 中找到任何代码文件`);

    const allSamples: FimSample[] = [];
    for (const { path: filePath, language } of files) {
      let stats;
      try { stats = statSync(filePath); } catch { continue; }
      if (stats.size > maxFileSize) continue;
      let content: string;
      try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }
      if (content.length < this.config.minPrefixLength + this.config.minMiddleLength + this.config.minSuffixLength) continue;

      const relPath = relative(sourceDir, filePath);
      for (let i = 0; i < samplesPerFile; i++) {
        const sample = generateFimSample(content, this.rng, this.config);
        if (sample) {
          sample.file_path = relPath;
          sample.language = language;
          allSamples.push(sample);
        }
      }
    }

    logger.info(`生成 ${allSamples.length} 个 FIM 样本`);
    if (allSamples.length === 0) throw new Error('未能生成任何有效样本');

    // 打乱
    for (let i = allSamples.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [allSamples[i], allSamples[j]] = [allSamples[j], allSamples[i]];
    }

    const trainCount = Math.floor(allSamples.length * trainRatio);
    const trainSamples = allSamples.slice(0, trainCount);
    const valSamples = allSamples.slice(trainCount);

    const outputDir = outputPath.includes('/') ? outputPath.slice(0, outputPath.lastIndexOf('/')) : '.';
    if (outputDir && !existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    const trainPath = outputPath.replace('.jsonl', '.train.jsonl');
    writeFileSync(trainPath, trainSamples.map((s) => JSON.stringify(s)).join('\n'), 'utf-8');

    const valPath = outputPath.replace('.jsonl', '.val.jsonl');
    writeFileSync(valPath, valSamples.map((s) => JSON.stringify(s)).join('\n'), 'utf-8');

    const metadata = {
      source_dir: sourceDir,
      total_files: files.length,
      total_samples: allSamples.length,
      train_samples: trainSamples.length,
      val_samples: valSamples.length,
      train_ratio: trainRatio,
      config: {
        samples_per_file: samplesPerFile,
        max_file_size: maxFileSize,
        min_middle_length: this.config.minMiddleLength,
        max_middle_length: this.config.maxMiddleLength,
        min_prefix_length: this.config.minPrefixLength,
        min_suffix_length: this.config.minSuffixLength,
        languages: this.config.languages,
        seed: this.config.seed,
      },
      language_distribution: this.countByLanguage(allSamples),
      created_at: new Date().toISOString(),
    };

    const metaPath = outputPath.replace('.jsonl', '.meta.json');
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    logger.info('FIM 训练数据准备完成', { train: trainSamples.length, val: valSamples.length });
    return { trainCount: trainSamples.length, valCount: valSamples.length, totalFiles: files.length, outputPath };
  }

  private countByLanguage(samples: FimSample[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const s of samples) counts[s.language] = (counts[s.language] || 0) + 1;
    return counts;
  }
}

export function prepareFimData(config: FimDataConfig) {
  return new FimDataPreparer(config).prepare();
}

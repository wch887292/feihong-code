/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-3 类型检查器（生成后验证闭环核心组件）：
 *  - 运行 TypeScript 编译器（tsc --noEmit）做全项目类型检查
 *  - 解析 tsc 输出为结构化错误列表（文件、行号、列号、错误码、消息）
 *  - 支持超时控制（默认 30s，防止大仓库卡死）
 *  - 支持按文件过滤错误（定位生成代码引入的类型问题）
 *  - 与 quality-gate 和 self-correction 闭环集成
 */
import { execFileSync } from 'child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

/** 单条类型错误 */
export interface TypeCheckError {
  /** 相对项目根的文件路径 */
  file: string;
  line: number;
  column: number;
  /** TypeScript 错误码（如 TS2304） */
  code: string;
  message: string;
  /** 错误严重级别（error / warning） */
  severity: 'error' | 'warning';
}

/** 类型检查结果 */
export interface TypeCheckResult {
  success: boolean;
  errors: TypeCheckError[];
  /** 检查耗时（毫秒） */
  durationMs: number;
  /** tsc 原始输出（截断到 2000 字符） */
  rawOutput: string;
  /** 是否超时 */
  timedOut: boolean;
  /** 检查的文件数 */
  filesChecked: number;
}

/** 类型检查配置 */
export interface TypeCheckConfig {
  /** 项目根目录（tsconfig.json 所在目录） */
  cwd: string;
  /** 超时时间（毫秒），默认 30000 */
  timeoutMs: number;
  /** 是否只检查指定文件（空数组表示全项目） */
  files?: string[];
  /** tsconfig 路径（默认 cwd/tsconfig.json） */
  tsconfigPath?: string;
}

const DEFAULT_CONFIG: Partial<TypeCheckConfig> = {
  timeoutMs: 30000,
};

/**
 * 解析 tsc 输出为结构化错误
 * tsc 输出格式：path/to/file.ts(line,col): error TSxxxx: message
 * 或：path/to/file.ts(line,col): warning TSxxxx: message
 */
export function parseTscOutput(output: string, cwd: string): TypeCheckError[] {
  const errors: TypeCheckError[] = [];
  const lines = output.split('\n');

  // 正则匹配：文件路径(行,列): 级别 错误码: 消息
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.+)$/;

  for (const line of lines) {
    const m = re.exec(line.trim());
    if (m) {
      const [, filePath, lineNum, colNum, severity, code, message] = m;
      // 将绝对路径转为相对路径
      let relPath = filePath;
      try {
        const abs = resolve(cwd, filePath);
        relPath = abs.startsWith(resolve(cwd))
          ? abs.slice(resolve(cwd).length + 1).replace(/\\/g, '/')
          : filePath.replace(/\\/g, '/');
      } catch {
        /* 路径解析失败，保留原始 */
      }
      errors.push({
        file: relPath,
        line: parseInt(lineNum, 10),
        column: parseInt(colNum, 10),
        code,
        message: message.trim(),
        severity: severity as 'error' | 'warning',
      });
    }
  }
  return errors;
}

/**
 * 运行 TypeScript 类型检查
 * 使用 tsc --noEmit（不生成输出文件，仅做类型检查）
 */
export function runTypeCheck(config: TypeCheckConfig): TypeCheckResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const cwd = resolve(cfg.cwd);
  const startTime = Date.now();

  // 检查 tsc 是否可用
  const tscPath = findTsc(cwd);
  if (!tscPath) {
    return {
      success: false,
      errors: [],
      durationMs: Date.now() - startTime,
      rawOutput: 'TypeScript 编译器 (tsc) 未找到，请确保项目已安装 typescript 依赖。',
      timedOut: false,
      filesChecked: 0,
    };
  }

  // 构建 tsc 参数
  const args: string[] = ['--noEmit'];
  if (cfg.tsconfigPath) {
    args.push('-p', cfg.tsconfigPath);
  } else if (existsSync(join(cwd, 'tsconfig.json'))) {
    args.push('-p', join(cwd, 'tsconfig.json'));
  }

  // 如果指定了文件，创建临时 tsconfig 只包含这些文件
  if (cfg.files && cfg.files.length > 0) {
    const tempConfig = createTempTsConfig(cwd, cfg.files);
    if (tempConfig) {
      args.length = 0;
      args.push('--noEmit', '-p', tempConfig);
    }
  }

  try {
    const output = execFileSync(tscPath, args, {
      cwd,
      encoding: 'utf8',
      timeout: cfg.timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB 缓冲区
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as string;

    const errors = parseTscOutput(output, cwd);
    return {
      success: errors.filter((e) => e.severity === 'error').length === 0,
      errors,
      durationMs: Date.now() - startTime,
      rawOutput: output.slice(0, 2000),
      timedOut: false,
      filesChecked: cfg.files?.length ?? 0,
    };
  } catch (e: unknown) {
    // tsc 发现类型错误时会以非零退出码退出，这是正常的
    const err = e as { stdout?: string; stderr?: string; signal?: string; message?: string };
    const output = (err.stdout || '') + (err.stderr || '');
    const timedOut = err.signal === 'SIGTERM' || /timeout/i.test(err.message || '');

    if (timedOut) {
      return {
        success: false,
        errors: [],
        durationMs: Date.now() - startTime,
        rawOutput: `类型检查超时（${cfg.timeoutMs}ms），项目可能过大。`,
        timedOut: true,
        filesChecked: 0,
      };
    }

    const errors = parseTscOutput(output, cwd);
    return {
      success: errors.filter((e) => e.severity === 'error').length === 0,
      errors,
      durationMs: Date.now() - startTime,
      rawOutput: output.slice(0, 2000),
      timedOut: false,
      filesChecked: cfg.files?.length ?? 0,
    };
  }
}

/** 查找 tsc 可执行文件路径（优先本地 node_modules，其次全局） */
function findTsc(cwd: string): string | null {
  const candidates = [
    join(cwd, 'node_modules', '.bin', 'tsc'),
    join(cwd, 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  for (const p of candidates) {
    if (existsSync(p) || existsSync(p + '.cmd') || existsSync(p + '.ps1')) {
      return p;
    }
  }
  // 尝试全局 tsc
  try {
    const result = execFileSync('where', ['tsc'], { encoding: 'utf8', timeout: 5000 }) as string;
    const firstLine = result.trim().split('\n')[0]?.trim();
    if (firstLine && existsSync(firstLine)) return firstLine;
  } catch {
    /* 全局 tsc 未找到 */
  }
  return null;
}

/** 创建临时 tsconfig.json，只包含指定文件（用于单文件类型检查） */
function createTempTsConfig(cwd: string, files: string[]): string | null {
  try {
    const tmpDir = mkdtempSync(join(tmpdir(), 'fhcode-tsc-'));
    const config = {
      compilerOptions: {
        noEmit: true,
        target: 'ES2020',
        module: 'commonjs',
        strict: false,
        esModuleInterop: true,
        skipLibCheck: true,
        moduleResolution: 'node',
        resolveJsonModule: true,
      },
      include: files.map((f) => resolve(cwd, f)),
    };
    const configPath = join(tmpDir, 'tsconfig.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return configPath;
  } catch {
    return null;
  }
}

/** 按文件过滤类型错误（只返回指定文件的错误） */
export function filterErrorsByFile(result: TypeCheckResult, files: string[]): TypeCheckError[] {
  const fileSet = new Set(files.map((f) => f.replace(/\\/g, '/')));
  return result.errors.filter((e) => fileSet.has(e.file));
}

/** 获取错误摘要（按文件分组，用于 self-correction 提示） */
export function summarizeErrors(errors: TypeCheckError[], maxPerFile = 5): string {
  if (errors.length === 0) return '无类型错误。';

  const byFile = new Map<string, TypeCheckError[]>();
  for (const e of errors) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file)!.push(e);
  }

  const lines: string[] = [];
  lines.push(`类型检查发现 ${errors.length} 个问题（${errors.filter((e) => e.severity === 'error').length} 错误, ${errors.filter((e) => e.severity === 'warning').length} 警告）：`);

  for (const [file, fileErrors] of byFile) {
    lines.push(`\n📄 ${file}:`);
    const shown = fileErrors.slice(0, maxPerFile);
    for (const e of shown) {
      lines.push(`  L${e.line}:${e.column} [${e.code}] ${e.message}`);
    }
    if (fileErrors.length > maxPerFile) {
      lines.push(`  ... 还有 ${fileErrors.length - maxPerFile} 个问题`);
    }
  }
  return lines.join('\n');
}

/** 便捷函数：快速检查单个文件的类型错误 */
export function checkFileTypes(cwd: string, filePath: string): TypeCheckResult {
  return runTypeCheck({ cwd, files: [filePath], timeoutMs: 15000 });
}

/** 便捷函数：全项目类型检查 */
export function checkProjectTypes(cwd: string, timeoutMs = 30000): TypeCheckResult {
  return runTypeCheck({ cwd, timeoutMs });
}

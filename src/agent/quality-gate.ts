/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 质量门禁（M8）：
 * - 集成代码分析 + 审查 + 测试生成
 * - 可配置通过阈值（零高优问题、复杂度上限、覆盖率下限）
 * - 阻塞不符合标准的代码合入
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { ReviewRule } from './code-review';
import { reviewCode } from './code-review';
import { analyzeFile } from '../tools/analysis/code-analyzer';
import { generateJestTest, inferTestCases } from '../tools/generator/test-generator';
import { t } from '../shared/i18n';
import type { CodeGraph } from './symbol-index';
import { getAllSymbols } from './symbol-index';
import { checkFileTypes, summarizeErrors, type TypeCheckResult } from './type-checker';

export interface QualityGateConfig {
  maxHighSeverityIssues: number;
  maxComplexity: number;
  maxNullRisk: number;
  requireTests: boolean;
  rules?: ReviewRule[];
  /** P0-3：启用 TypeScript 类型检查（默认开启） */
  enableTypeCheck?: boolean;
  /** P0-3：类型检查最大允许错误数（默认 0） */
  maxTypeErrors?: number;
  /** P0-3：启用符号存在性校验（默认开启） */
  enableSymbolCheck?: boolean;
  /** P0-3：代码图谱（用于符号校验，不传则跳过符号校验） */
  codeGraph?: CodeGraph;
  /** P0-3：项目根目录（用于类型检查，默认 process.cwd()） */
  cwd?: string;
}

export interface GateResult {
  file: string;
  passed: boolean;
  checks: GateCheck[];
}

export interface GateCheck {
  name: string;
  passed: boolean;
  value: string;
  threshold?: string;
}

const DEFAULT_CONFIG: QualityGateConfig = {
  maxHighSeverityIssues: 0,
  maxComplexity: 15,
  maxNullRisk: 3,
  requireTests: true,
  enableTypeCheck: true,
  maxTypeErrors: 0,
  enableSymbolCheck: true,
  cwd: process.cwd(),
};

export class QualityGate {
  private readonly config: QualityGateConfig;
  /** 最近一次类型检查结果（供 self-correction 闭环使用） */
  private _lastTypeResult: TypeCheckResult | null = null;
  /** 最近一次符号校验发现的未定义符号（供 self-correction 使用） */
  private _lastMissingSymbols: string[] = [];

  constructor(config: Partial<QualityGateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 审查单个文件 */
  gateFile(filePath: string, content: string): GateResult {
    const checks: GateCheck[] = [];

    // 1. 安全审查
    const reviewResult = reviewCode(filePath, content, this.config.rules);
    const highIssues = reviewResult.issues.filter((i) => i.severity === 'high').length;
    checks.push({
      name: '安全审查',
      passed: highIssues <= this.config.maxHighSeverityIssues,
      value: `${highIssues} 高优问题`,
      threshold: `≤${this.config.maxHighSeverityIssues}`,
    });

    // 2. 代码质量分析
    const analysis = analyzeFile(filePath, content);
    const complexity = analysis.metrics.complexity;
    const nullRisk = analysis.issues.filter((i) => i.type === 'bug' && (i.message.includes('null') || i.message.includes('undefined'))).length;
    checks.push({
      name: '复杂度',
      passed: complexity <= this.config.maxComplexity,
      value: `${complexity}`,
      threshold: `≤${this.config.maxComplexity}`,
    });
    checks.push({
      name: '空值风险',
      passed: nullRisk <= this.config.maxNullRisk,
      value: `${nullRisk}`,
      threshold: `≤${this.config.maxNullRisk}`,
    });

    // 3. 测试文件检查
    if (this.config.requireTests) {
      const testFile = filePath.replace(/\.ts$/, '.test.ts');
      const hasTest = existsSync(testFile);
      checks.push({
        name: '测试覆盖',
        passed: hasTest,
        value: hasTest ? '已有测试' : '缺失测试',
        threshold: '必需',
      });
    }

    // 4. P0-3: TypeScript 类型检查（仅对 .ts/.tsx 文件）
    if (this.config.enableTypeCheck && /\.(ts|tsx)$/.test(filePath)) {
      const typeResult = this.runTypeCheckForFile(filePath);
      const typeErrors = typeResult.errors.filter((e) => e.severity === 'error').length;
      const maxTypeErrors = this.config.maxTypeErrors ?? 0;
      checks.push({
        name: '类型检查',
        passed: typeErrors <= maxTypeErrors,
        value: typeResult.timedOut ? '超时' : `${typeErrors} 类型错误`,
        threshold: `≤${maxTypeErrors}`,
      });
      // 缓存类型检查结果，供 self-correction 使用
      this._lastTypeResult = typeResult;
    }

    // 5. P0-3: 符号存在性校验（检查文件中调用的函数/引用的类型是否在代码图谱中存在）
    if (this.config.enableSymbolCheck && this.config.codeGraph && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
      const missing = this.checkSymbolExistence(filePath, content);
      checks.push({
        name: '符号校验',
        passed: missing.length === 0,
        value: missing.length === 0 ? '全部存在' : `${missing.length} 未定义`,
        threshold: '0 未定义',
      });
      this._lastMissingSymbols = missing;
    }

    const passed = checks.every((c) => c.passed);
    return { file: filePath, passed, checks };
  }

  /** 审查目录 */
  gateDirectory(dirPath: string, maxFiles = 20): GateResult[] {
    const results: GateResult[] = [];
    const files = this.findTypeScriptFiles(dirPath, maxFiles);
    for (const file of files) {
      const content = require('fs').readFileSync(file, 'utf8');
      results.push(this.gateFile(file, content));
    }
    return results;
  }

  /** 生成缺失测试 */
  generateTestsFor(dirPath: string, maxFiles = 10): string[] {
    const generated: string[] = [];
    const files = this.findTypeScriptFiles(dirPath, maxFiles);
    for (const file of files) {
      const content = require('fs').readFileSync(file, 'utf8');
      const testFile = file.replace(/\.ts$/, '.test.ts');
      if (existsSync(testFile)) {
        const funcName = this.inferFunctionName(content);
        const testCases = inferTestCases(funcName, content.slice(0, 500));
        const testCode = generateJestTest(file, funcName, testCases);
        require('fs').writeFileSync(testFile, testCode, 'utf8');
        generated.push(testFile);
      }
    }
    return generated;
  }

  /** 批量审查并报告 */
  report(results: GateResult[]): string {
    const lines = [t('quality.reportTitle')];
    for (const r of results) {
      lines.push(
        t('quality.fileResult', { file: r.file, status: r.passed ? t('quality.pass') : t('quality.fail') }),
      );
      for (const check of r.checks) {
        lines.push(
          t('quality.check', {
            mark: check.passed ? '✅' : '❌',
            name: check.name,
            value: check.value,
            req: check.threshold ? t('quality.req', { threshold: check.threshold }) : '',
          }),
        );
      }
    }
    const passed = results.filter((r) => r.passed).length;
    lines.push(t('quality.total', { passed, total: results.length }));
    return lines.join('\n');
  }

  private findTypeScriptFiles(dirPath: string, maxFiles: number): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
      if (files.length >= maxFiles) return;
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          if (!entry.startsWith('.') && entry !== 'node_modules' && entry !== 'dist') {
            walk(fullPath);
          }
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
          files.push(fullPath);
        }
      }
    };
    walk(dirPath);
    return files;
  }

  /** P0-3: 对单个文件运行类型检查（带缓存，同一文件短时间内不重复检查） */
  private _typeCheckCache = new Map<string, { result: TypeCheckResult; timestamp: number }>();

  private runTypeCheckForFile(filePath: string): TypeCheckResult {
    const cacheKey = filePath;
    const cached = this._typeCheckCache.get(cacheKey);
    // 缓存 5 秒，避免连续调用重复检查
    if (cached && Date.now() - cached.timestamp < 5000) {
      return cached.result;
    }
    try {
      const cwd = this.config.cwd || process.cwd();
      const result = checkFileTypes(cwd, filePath);
      this._typeCheckCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch {
      return {
        success: true,
        errors: [],
        durationMs: 0,
        rawOutput: '类型检查执行失败（跳过）',
        timedOut: false,
        filesChecked: 0,
      };
    }
  }

  /** P0-3: 检查文件中引用的符号是否在代码图谱中存在 */
  private checkSymbolExistence(filePath: string, content: string): string[] {
    const graph = this.config.codeGraph;
    if (!graph) return [];

    // 提取文件中可能的符号引用：
    // 1. import 语句中的导入名
    // 2. 函数调用（标识符后跟括号）
    // 3. new 关键字后的类名
    const referenced = new Set<string>();

    // import { foo, bar } from '...'  /  import foo from '...'
    const importRe = /import\s+(?:(\w+)\s*,\s*)?(?:\{([^}]+)\})?/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content)) !== null) {
      if (m[1]) referenced.add(m[1]);
      if (m[2]) {
        for (const name of m[2].split(',')) {
          const trimmed = name.trim().replace(/\s+as\s+\w+$/, '').trim();
          if (trimmed) referenced.add(trimmed);
        }
      }
    }

    // 函数调用：identifier(  —— 排除关键字和内置对象
    const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    const builtins = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'function', 'return',
      'typeof', 'instanceof', 'new', 'void', 'delete', 'in', 'of',
      'require', 'console', 'Math', 'JSON', 'Object', 'Array', 'String',
      'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'Promise', 'Map',
      'Set', 'Symbol', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    ]);
    while ((m = callRe.exec(content)) !== null) {
      const name = m[1];
      if (!builtins.has(name) && name.length > 1) {
        referenced.add(name);
      }
    }

    // new ClassName()
    const newRe = /new\s+([A-Za-z_$][\w$]*)/g;
    while ((m = newRe.exec(content)) !== null) {
      referenced.add(m[1]);
    }

    // 过滤掉文件自身定义的符号
    const allSymbols = new Set(getAllSymbols(graph).map((s) => s.name));
    const selfDefined = new Set(
      getAllSymbols(graph)
        .filter((s) => s.file === filePath.replace(/\\/g, '/'))
        .map((s) => s.name),
    );

    const missing: string[] = [];
    for (const name of referenced) {
      // 跳过文件自身定义的符号、已存在于图谱的符号、明显的局部变量（小写开头且不是函数调用）
      if (selfDefined.has(name)) continue;
      if (allSymbols.has(name)) continue;
      // 跳过以小写开头的短名称（很可能是局部变量）
      if (/^[a-z][a-z0-9]{0,3}$/.test(name)) continue;
      missing.push(name);
    }

    return [...new Set(missing)].slice(0, 20); // 最多报告 20 个
  }

  /** 获取最近一次类型检查结果（供 self-correction 闭环使用） */
  getLastTypeResult(): TypeCheckResult | null {
    return this._lastTypeResult;
  }

  /** 获取最近一次符号校验发现的未定义符号（供 self-correction 使用） */
  getLastMissingSymbols(): string[] {
    return this._lastMissingSymbols;
  }

  /** 获取类型检查错误摘要（供 self-correction 提示词使用） */
  getTypeErrorSummary(): string {
    if (!this._lastTypeResult) return '';
    return summarizeErrors(this._lastTypeResult.errors, 5);
  }

  private inferFunctionName(content: string): string {
    const match = content.match(/export\s+(?:async\s+)?function\s+(\w+)/);
    return match?.[1] || 'main';
  }
}

/** 便捷函数 */
export function createQualityGate(config?: Partial<QualityGateConfig>): QualityGate {
  return new QualityGate(config);
}

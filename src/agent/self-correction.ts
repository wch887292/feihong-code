/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-3 自我修正闭环（Self-Correction Loop）：
 *  - 代码生成后自动运行类型检查 + 符号校验
 *  - 发现错误时，将错误信息 + 原始代码回灌给模型，请求修复
 *  - 最多 N 轮修复，每轮修复后重新验证
 *  - 与 quality-gate、type-checker、symbol-index 深度集成
 *  - 修复失败时保留原始代码并返回详细错误报告
 *
 * 设计原则：
 *  - 不破坏原始文件：修复过程写入临时文件，验证通过后才覆盖
 *  - 有限重试：最多 maxRounds 轮，防止无限循环
 *  - 可观测：每轮修复记录错误数、修复内容、验证结果
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CodeGraph } from './symbol-index';
import { findMissingSymbols } from './symbol-index';
import { runTypeCheck, summarizeErrors, type TypeCheckResult } from './type-checker';
import { logger } from '../shared/logger';

/** 模型调用函数类型：接收提示词，返回修复后的代码 */
export type ModelFixFn = (prompt: string) => Promise<string>;

/** 单轮修复记录 */
export interface CorrectionRound {
  round: number;
  /** 修复前的错误数 */
  errorsBefore: number;
  /** 修复后的错误数 */
  errorsAfter: number;
  /** 类型错误摘要 */
  typeErrorSummary: string;
  /** 缺失符号列表 */
  missingSymbols: string[];
  /** 修复是否成功（错误数减少或归零） */
  improved: boolean;
  /** 修复后的代码（截断到 500 字符用于日志） */
  fixedCodePreview: string;
}

/** 自我修正结果 */
export interface CorrectionResult {
  /** 最终是否通过验证（零类型错误 + 零缺失符号） */
  success: boolean;
  /** 修复后的文件路径（与输入相同，修复成功则内容已更新） */
  filePath: string;
  /** 实际执行的修复轮数 */
  roundsCompleted: number;
  /** 每轮修复记录 */
  rounds: CorrectionRound[];
  /** 最终类型检查结果 */
  finalTypeCheck: TypeCheckResult | null;
  /** 最终缺失符号列表 */
  finalMissingSymbols: string[];
  /** 最终错误摘要（供展示） */
  finalErrorSummary: string;
}

/** 自我修正配置 */
export interface CorrectionConfig {
  /** 最大修复轮数（默认 2） */
  maxRounds: number;
  /** 项目根目录 */
  cwd: string;
  /** 代码图谱（用于符号校验） */
  codeGraph?: CodeGraph;
  /** 类型检查超时（毫秒） */
  typeCheckTimeoutMs: number;
  /** 是否在修复失败时回滚到原始代码（默认 true） */
  rollbackOnFailure: boolean;
  /** 最小改进阈值：错误数减少超过此值才视为有效修复（默认 1） */
  minImprovement: number;
}

const DEFAULT_CONFIG: CorrectionConfig = {
  maxRounds: 2,
  cwd: process.cwd(),
  typeCheckTimeoutMs: 20000,
  rollbackOnFailure: true,
  minImprovement: 1,
};

/**
 * 自我修正器：封装验证→修复→再验证循环
 */
export class SelfCorrector {
  private config: CorrectionConfig;

  constructor(config: Partial<CorrectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 对单个文件执行自我修正闭环
   * @param filePath 相对项目根的文件路径
   * @param modelFix 模型修复函数（接收提示词，返回修复后的完整代码）
   */
  async correctFile(filePath: string, modelFix: ModelFixFn): Promise<CorrectionResult> {
    const absPath = join(this.config.cwd, filePath);
    const rounds: CorrectionRound[] = [];

    if (!existsSync(absPath)) {
      return this.failResult(filePath, [], null, [], `文件不存在: ${filePath}`);
    }

    // 备份原始代码（用于回滚）
    const originalCode = readFileSync(absPath, 'utf8');
    let currentCode = originalCode;

    for (let round = 1; round <= this.config.maxRounds; round++) {
      // 1. 验证当前代码
      const validation = this.validateCode(filePath, currentCode);
      const totalErrors = validation.typeErrors + validation.missingSymbols.length;

      // 如果已经没有错误，直接成功
      if (totalErrors === 0) {
        logger.info('self-correction: already passing', { file: filePath, round });
        return {
          success: true,
          filePath,
          roundsCompleted: round - 1,
          rounds,
          finalTypeCheck: validation.typeCheckResult,
          finalMissingSymbols: validation.missingSymbols,
          finalErrorSummary: '无类型错误，所有符号均存在。',
        };
      }

      // 2. 构建修复提示词，调用模型修复
      const fixPrompt = this.buildFixPrompt(filePath, currentCode, validation);
      let fixedCode: string;
      try {
        fixedCode = await modelFix(fixPrompt);
      } catch (e) {
        logger.warn('self-correction: model fix failed', {
          file: filePath,
          round,
          error: e instanceof Error ? e.message : String(e),
        });
        break;
      }

      // 清洗模型输出（提取代码块）
      fixedCode = this.extractCodeFromResponse(fixedCode, currentCode);

      // 3. 验证修复后的代码
      const afterValidation = this.validateCode(filePath, fixedCode);
      const errorsAfter = afterValidation.typeErrors + afterValidation.missingSymbols.length;
      const improved = totalErrors - errorsAfter >= this.config.minImprovement;

      rounds.push({
        round,
        errorsBefore: totalErrors,
        errorsAfter,
        typeErrorSummary: summarizeErrors(validation.typeCheckResult?.errors ?? [], 3),
        missingSymbols: validation.missingSymbols,
        improved,
        fixedCodePreview: fixedCode.slice(0, 500),
      });

      logger.info('self-correction: round completed', {
        file: filePath,
        round,
        errorsBefore: totalErrors,
        errorsAfter,
        improved,
      });

      // 如果修复后通过验证，写入文件并成功返回
      if (errorsAfter === 0) {
        writeFileSync(absPath, fixedCode, 'utf8');
        return {
          success: true,
          filePath,
          roundsCompleted: round,
          rounds,
          finalTypeCheck: afterValidation.typeCheckResult,
          finalMissingSymbols: afterValidation.missingSymbols,
          finalErrorSummary: '修复后无类型错误，所有符号均存在。',
        };
      }

      // 如果有改进，接受修复并继续下一轮
      if (improved) {
        currentCode = fixedCode;
        writeFileSync(absPath, fixedCode, 'utf8');
      } else {
        // 没有改进，停止修复（避免模型在错误方向上越走越远）
        logger.info('self-correction: no improvement, stopping', { file: filePath, round });
        break;
      }
    }

    // 修复失败：回滚或保留最后一次改进
    if (this.config.rollbackOnFailure) {
      writeFileSync(absPath, originalCode, 'utf8');
    }

    const finalValidation = this.validateCode(filePath, currentCode);
    return this.failResult(
      filePath,
      rounds,
      finalValidation.typeCheckResult,
      finalValidation.missingSymbols,
      this.buildFinalErrorSummary(finalValidation),
    );
  }

  /** 验证代码：类型检查 + 符号校验 */
  private validateCode(filePath: string, code: string): {
    typeErrors: number;
    typeCheckResult: TypeCheckResult | null;
    missingSymbols: string[];
  } {
    // 类型检查
    let typeCheckResult: TypeCheckResult | null = null;
    let typeErrors = 0;
    try {
      typeCheckResult = runTypeCheck({
        cwd: this.config.cwd,
        files: [filePath],
        timeoutMs: this.config.typeCheckTimeoutMs,
      });
      typeErrors = typeCheckResult.errors.filter((e) => e.severity === 'error').length;
    } catch (e) {
      logger.warn('self-correction: type check failed', { error: e instanceof Error ? e.message : String(e) });
    }

    // 符号校验
    let missingSymbols: string[] = [];
    if (this.config.codeGraph) {
      try {
        missingSymbols = this.extractMissingSymbols(code, filePath);
      } catch {
        /* 符号校验失败跳过 */
      }
    }

    return { typeErrors, typeCheckResult, missingSymbols };
  }

  /** 从代码中提取缺失符号 */
  private extractMissingSymbols(code: string, _filePath: string): string[] {
    const graph = this.config.codeGraph;
    if (!graph) return [];

    const referenced = new Set<string>();
    // import 导入名
    const importRe = /import\s+(?:(\w+)\s*,\s*)?(?:\{([^}]+)\})?/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(code)) !== null) {
      if (m[1]) referenced.add(m[1]);
      if (m[2]) {
        for (const name of m[2].split(',')) {
          const trimmed = name.trim().replace(/\s+as\s+\w+$/, '').trim();
          if (trimmed) referenced.add(trimmed);
        }
      }
    }
    // 函数调用
    const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    const builtins = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'require', 'console', 'Math', 'JSON']);
    while ((m = callRe.exec(code)) !== null) {
      if (!builtins.has(m[1]) && m[1].length > 1) referenced.add(m[1]);
    }

    return findMissingSymbols(graph, [...referenced]).slice(0, 15);
  }

  /** 构建修复提示词 */
  private buildFixPrompt(
    filePath: string,
    code: string,
    validation: { typeErrors: number; typeCheckResult: TypeCheckResult | null; missingSymbols: string[] },
  ): string {
    const typeSummary = validation.typeCheckResult
      ? summarizeErrors(validation.typeCheckResult.errors, 8)
      : '类型检查不可用。';

    const missingSummary = validation.missingSymbols.length > 0
      ? `以下符号在代码库中未找到定义（可能是拼写错误或缺少 import）：\n${validation.missingSymbols.map((s) => `  - ${s}`).join('\n')}`
      : '所有引用的符号均存在。';

    return `你是一个 TypeScript 代码修复专家。请修复以下文件中的类型错误和未定义符号。

**文件**: ${filePath}
**类型错误数**: ${validation.typeErrors}
**缺失符号数**: ${validation.missingSymbols.length}

**类型错误详情**:
${typeSummary}

**符号校验**:
${missingSummary}

**原始代码**:
\`\`\`typescript
${code}
\`\`\`

**修复要求**:
1. 只修复上述类型错误和未定义符号，不要改变代码的核心逻辑
2. 对于缺失符号，检查是否是拼写错误，或者需要添加正确的 import 语句
3. 对于类型错误，修复类型不匹配、缺少属性、参数错误等问题
4. 保持代码风格和缩进一致
5. 返回完整的修复后代码，不要只返回修改部分

请直接输出修复后的完整代码（用 \`\`\`typescript 代码块包裹）。`;
  }

  /** 从模型响应中提取代码块 */
  private extractCodeFromResponse(response: string, fallback: string): string {
    // 尝试提取 ```typescript 或 ``` 代码块
    const codeBlockRe = /```(?:typescript|ts)?\s*([\s\S]*?)```/i;
    const m = codeBlockRe.exec(response);
    if (m && m[1].trim()) {
      return m[1].trim();
    }
    // 如果没有代码块，检查响应是否本身就是代码（包含 import/export/function 等）
    if (/\b(import|export|function|const|class|interface)\b/.test(response) && response.length > 50) {
      return response.trim();
    }
    // 都不行，返回原始代码（不做修改）
    return fallback;
  }

  /** 构建最终错误摘要 */
  private buildFinalErrorSummary(validation: { typeCheckResult: TypeCheckResult | null; missingSymbols: string[] }): string {
    const parts: string[] = [];
    if (validation.typeCheckResult && validation.typeCheckResult.errors.length > 0) {
      parts.push(summarizeErrors(validation.typeCheckResult.errors, 5));
    }
    if (validation.missingSymbols.length > 0) {
      parts.push(`未定义符号: ${validation.missingSymbols.join(', ')}`);
    }
    return parts.length > 0 ? parts.join('\n') : '验证通过。';
  }

  /** 构建失败结果 */
  private failResult(
    filePath: string,
    rounds: CorrectionRound[],
    typeCheck: TypeCheckResult | null,
    missingSymbols: string[],
    errorSummary: string,
  ): CorrectionResult {
    return {
      success: false,
      filePath,
      roundsCompleted: rounds.length,
      rounds,
      finalTypeCheck: typeCheck,
      finalMissingSymbols: missingSymbols,
      finalErrorSummary: errorSummary,
    };
  }
}

/** 便捷函数：创建自我修正器 */
export function createSelfCorrector(config?: Partial<CorrectionConfig>): SelfCorrector {
  return new SelfCorrector(config);
}

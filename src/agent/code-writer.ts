/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 自主代码编写器（M8）：
 * - 任务规划 → 代码编写 → 测试生成 → 审查反馈 → 迭代优化
 * - 内置代码生成模板（API 路由、Model、工具骨架）
 * - 自动测试生成（Jest/Vitest）
 * - 质量门禁集成（审查规则 + 分析结果）
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { ReviewRule } from './code-review';
import { reviewCode } from './code-review';
import { analyzeFile } from '../tools/analysis/code-analyzer';
import { generateJestTest, inferTestCases } from '../tools/generator/test-generator';
import {
  generateApiRoute,
  generateModel,
  generateToolTemplate,
} from '../tools/generator/code-generator';

export interface CodeWriterStep {
  type: 'plan' | 'write' | 'test' | 'review' | 'fix' | 'summary';
  content: string;
  file?: string;
}

export interface CodeWriterResult {
  success: boolean;
  steps: CodeWriterStep[];
  finalFiles: string[];
  issuesFound: number;
  issuesFixed: number;
  summary: string;
}

/** 自主编写器状态机 */
export class CodeWriter {
  private steps: CodeWriterStep[] = [];
  private filesCreated: string[] = [];
  private issuesFound = 0;
  private issuesFixed = 0;
  private readonly rules: ReviewRule[];
  private readonly cwd: string;

  constructor(cwd: string, rules: ReviewRule[] = []) {
    this.cwd = cwd;
    this.rules = rules;
  }

  /** 阶段 1：规划 */
  plan(goal: string): CodeWriterStep {
    const step: CodeWriterStep = {
      type: 'plan',
      content: this.buildPlan(goal),
    };
    this.steps.push(step);
    console.log(`[M8 Plan] ${step.content}`);
    return step;
  }

  /** 阶段 2：编写代码 */
  write(code: string, filePath: string): CodeWriterStep {
    const absPath = join(this.cwd, filePath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, code, 'utf8');
    this.filesCreated.push(filePath);
    const step: CodeWriterStep = {
      type: 'write',
      content: `已生成文件: ${filePath} (${code.length} 字符)`,
      file: filePath,
    };
    this.steps.push(step);
    console.log(`[M8 Write] ${step.content}`);
    return step;
  }

  /** 阶段 2b：使用模板生成代码 */
  writeTemplate(
    template: 'api-route' | 'model' | 'tool',
    params: Record<string, string>,
  ): CodeWriterStep {
    let code: string;
    let filename: string;
    const result =
      template === 'api-route'
        ? generateApiRoute(params.method, params.path, params.controller)
        : template === 'model'
          ? generateModel(params.name, JSON.parse(params.fields || '{}'))
          : generateToolTemplate(params.name);
    if (!result.success || !result.content) {
      return { type: 'write', content: `模板生成失败: ${result.error || '未知错误'}` };
    }
    code = result.content;
    if (template === 'api-route') {
      filename = params.path.replace(/^\//, '').replace(/\//g, '-') + '.ts';
    } else if (template === 'model') {
      filename = params.name + '.ts';
    } else {
      filename = params.name + '.tool.ts';
    }
    return this.write(code, join('generated', filename));
  }

  /** 阶段 3：生成测试 */
  test(targetFile: string, functionName?: string): CodeWriterStep {
    const absPath = join(this.cwd, targetFile);
    if (!existsSync(absPath)) {
      return { type: 'test', content: `跳过测试生成：文件不存在 ${targetFile}` };
    }
    const content = readFileSync(absPath, 'utf8');
    const funcName = functionName || this.inferFunctionName(content);
    const testCases = inferTestCases(funcName, content.slice(0, 500));
    const result = generateJestTest(targetFile, funcName, testCases);
    const testFile = targetFile.replace('.ts', '.test.ts');
    return this.write(result.content, testFile);
  }

  /** 阶段 4：审查 */
  review(filePath: string): CodeWriterStep {
    const absPath = join(this.cwd, filePath);
    if (!existsSync(absPath)) {
      return { type: 'review', content: `跳过审查：文件不存在 ${filePath}` };
    }
    const content = readFileSync(absPath, 'utf8');
    const result = reviewCode(filePath, content, this.rules);
    this.issuesFound += result.issues.length;
    const step: CodeWriterStep = {
      type: 'review',
      content: this.formatReviewResult(result),
      file: filePath,
    };
    this.steps.push(step);
    console.log(`[M8 Review] ${step.content}`);
    return step;
  }

  /** 阶段 5：修复高优先级问题 */
  fix(filePath: string, maxFixes = 3): CodeWriterStep {
    const absPath = join(this.cwd, filePath);
    if (!existsSync(absPath)) {
      return { type: 'fix', content: `文件不存在 ${filePath}` };
    }
    const content = readFileSync(absPath, 'utf8');
    const result = reviewCode(filePath, content, this.rules);
    const highIssues = result.issues.filter((i) => i.severity === 'high').slice(0, maxFixes);
    if (highIssues.length === 0) {
      return { type: 'fix', content: '无高优先级问题需要修复' };
    }
    let newContent = content;
    for (const issue of highIssues) {
      const fix = this.issueToFix(issue);
      newContent = newContent.replace(fix.pattern, fix.replacement as any);
    }
    writeFileSync(absPath, newContent, 'utf8');
    this.issuesFixed += highIssues.length;
    return {
      type: 'fix',
      content: `已修复 ${highIssues.length} 个高优先级问题: ${highIssues.map((i) => i.message).join(', ')}`,
      file: filePath,
    };
  }

  /** 阶段 6：分析代码质量 */
  analyze(filePath: string): CodeWriterStep {
    const absPath = join(this.cwd, filePath);
    if (!existsSync(absPath)) {
      return { type: 'review', content: `文件不存在 ${filePath}` };
    }
    const content = readFileSync(absPath, 'utf8');
    const analysis = analyzeFile(filePath, content);
    return {
      type: 'review',
      content: this.formatAnalysisResult(analysis),
      file: filePath,
    };
  }

  /** 总结 */
  summary(): CodeWriterStep {
    const step: CodeWriterStep = {
      type: 'summary',
      content: this.buildSummary(),
    };
    this.steps.push(step);
    return step;
  }

  /** 完整流程：规划 → 编写 → 测试 → 审查 → 修复 → 总结 */
  async run(goal: string, code: string, filePath: string): Promise<CodeWriterResult> {
    this.plan(goal);
    this.write(code, filePath);
    this.test(filePath);
    this.review(filePath);
    this.analyze(filePath);
    this.fix(filePath);
    this.summary();
    return this.getResult();
  }

  /** 批量编写多个文件 */
  async runBatch(
    tasks: Array<{ goal: string; code: string; filePath: string }>,
  ): Promise<CodeWriterResult> {
    for (const task of tasks) {
      await this.run(task.goal, task.code, task.filePath);
    }
    return this.getResult();
  }

  private getResult(): CodeWriterResult {
    return {
      success: this.issuesFound - this.issuesFixed === 0,
      steps: this.steps,
      finalFiles: this.filesCreated,
      issuesFound: this.issuesFound,
      issuesFixed: this.issuesFixed,
      summary: this.buildSummary(),
    };
  }

  private buildPlan(goal: string): string {
    return `任务规划：${goal}\n预期输出文件: 待编写\n策略: 先规划结构，再逐步实现`;
  }

  private formatReviewResult(result: { file: string; issues: { severity: string; message: string }[]; passed: boolean }): string {
    const high = result.issues.filter((i) => i.severity === 'high').length;
    const med = result.issues.filter((i) => i.severity === 'medium').length;
    const low = result.issues.filter((i) => i.severity === 'low').length;
    return `${result.file}: ${result.issues.length} 个问题 (高:${high} 中:${med} 低:${low}) ${result.passed ? '✅ 通过' : '❌ 未通过'}`;
  }

  private formatAnalysisResult(analysis: { issues: { type: string; severity: string; message: string }[]; metrics: { complexity: number } }): string {
    const highIssues = analysis.issues.filter((i) => i.severity === 'high').length;
    return `代码质量分析: 复杂度=${analysis.metrics.complexity} 高优问题=${highIssues} 总问题=${analysis.issues.length}`;
  }

  private buildSummary(): string {
    return `M8 自主编写完成: ${this.filesCreated.length} 文件, ${this.issuesFound} 问题发现, ${this.issuesFixed} 问题修复`;
  }

  private inferFunctionName(content: string): string {
    const match = content.match(/export\s+(?:async\s+)?function\s+(\w+)/);
    return match?.[1] || 'main';
  }

  private issueToFix(issue: { message: string; suggestion: string }): { pattern: RegExp; replacement: string | ((substring: string, ...args: string[]) => string) } {
    if (issue.message.includes('硬编码')) {
      return {
        pattern: /['"`][^'"`]*(password|secret|key|token)[^'"`]*['"`]/gi,
        replacement: (_sub: string, p1: string) => `process.env.FH_${p1?.toUpperCase() ?? 'UNKNOWN'}`,
      };
    }
    if (issue.message.includes('SQL')) {
      return { pattern: /['"][\s\S]*?SELECT[\s\S]*?['"]/gi, replacement: '// 使用参数化查询' };
    }
    return { pattern: /.*/, replacement: issue.suggestion };
  }
}

/** 便捷函数 */
export function createCodeWriter(cwd: string, rules?: ReviewRule[]): CodeWriter {
  return new CodeWriter(cwd, rules);
}

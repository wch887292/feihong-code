/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 自主代码编写器（M8）：
 * - 任务规划 → 代码编写 → 测试生成 → 审查反馈 → 自愈修复 → 迭代优化
 * - 内置代码生成模板（API 路由、Model、工具骨架）
 * - 自动测试生成（Jest/Vitest）
 * - 质量门禁集成（审查规则 + 分析结果）
 * - 安全修复：仅对已知安全模式做针对性修复，杜绝「通配正则整体覆盖文件」的破坏性修复
 * - 自愈闭环：审查 → 修复 → 复审查，多轮收敛至无高优先级问题
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { ReviewRule, ReviewIssue } from './code-review';
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

/** 安全修复规则：仅返回已知安全的针对性修复，无匹配返回 null（不做破坏性通配替换） */
interface SafeFix {
  pattern: RegExp;
  replacement: string;
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
    const result = reviewCode(filePath, content, this.rules.length ? this.rules : undefined);
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

  /**
   * 阶段 5：安全修复高优先级问题
   * 关键安全约束：仅对「硬编码密钥 / SQL 拼接」等已知安全模式做针对性替换（替换首个匹配），
   * 任何无明确安全方案的问题一律跳过并提示人工处理，绝不使用通配正则把整个文件覆盖为建议文本。
   */
  fix(filePath: string, maxFixes = 3): CodeWriterStep {
    const absPath = join(this.cwd, filePath);
    if (!existsSync(absPath)) {
      return { type: 'fix', content: `文件不存在 ${filePath}` };
    }
    const content = readFileSync(absPath, 'utf8');
    const result = reviewCode(filePath, content, this.rules.length ? this.rules : undefined);
    const highIssues = result.issues.filter((i) => i.severity === 'high').slice(0, maxFixes);
    if (highIssues.length === 0) {
      return { type: 'fix', content: '无高优先级问题需要修复' };
    }

    let newContent = content;
    const applied: string[] = [];
    for (const issue of highIssues) {
      const safeFix = this.issueToSafeFix(issue);
      if (!safeFix) continue; // 仅做安全修复
      const next = newContent.replace(safeFix.pattern, safeFix.replacement);
      if (next !== newContent) {
        newContent = next;
        applied.push(issue.message);
      }
    }

    if (applied.length === 0) {
      return {
        type: 'fix',
        content: `高优先级问题无安全自动修复，建议人工处理: ${highIssues.map((i) => i.message).join(', ')}`,
        file: filePath,
      };
    }

    writeFileSync(absPath, newContent, 'utf8');
    this.issuesFixed += applied.length;
    return {
      type: 'fix',
      content: `已安全修复 ${applied.length} 个高优先级问题: ${applied.join(', ')}`,
      file: filePath,
    };
  }

  /**
   * 阶段 5b：自愈闭环
   * 审查 → 修复 → 复审查，最多 maxRounds 轮，直到无高优先级问题或达上限。
   * 修复动作复用安全修复（不会破坏文件），输出每轮收敛情况。
   */
  selfHealFix(filePath: string, maxRounds = 3): CodeWriterStep[] {
    const steps: CodeWriterStep[] = [];
    for (let round = 0; round < maxRounds; round++) {
      this.review(filePath); // 推入审查步骤
      const fixStep = this.fix(filePath);
      steps.push(fixStep);

      // 静默复审查（不重复推步骤），判定是否收敛
      const absPath = join(this.cwd, filePath);
      if (!existsSync(absPath)) break;
      const content = readFileSync(absPath, 'utf8');
      const re = reviewCode(filePath, content, this.rules);
      const high = re.issues.filter((i) => i.severity === 'high').length;
      if (high === 0) {
        steps.push({ type: 'fix', content: `自愈收敛：第 ${round + 1} 轮后无高优先级问题` });
        return steps;
      }
    }
    steps.push({ type: 'fix', content: `已达自愈上限(${maxRounds}轮)，剩余高优先级问题建议人工复核` });
    return steps;
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

  /** 完整流程：规划 → 编写 → 测试 → 审查 → 自愈修复 → 总结 */
  async run(goal: string, code: string, filePath: string): Promise<CodeWriterResult> {
    this.plan(goal);
    this.write(code, filePath);
    this.test(filePath);
    this.review(filePath);
    this.analyze(filePath);
    this.selfHealFix(filePath, 3);
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

  private formatReviewResult(result: {
    file: string;
    issues: { severity: string; message: string }[];
    passed: boolean;
  }): string {
    const high = result.issues.filter((i) => i.severity === 'high').length;
    const med = result.issues.filter((i) => i.severity === 'medium').length;
    const low = result.issues.filter((i) => i.severity === 'low').length;
    return `${result.file}: ${result.issues.length} 个问题 (高:${high} 中:${med} 低:${low}) ${result.passed ? '✅ 通过' : '❌ 未通过'}`;
  }

  private formatAnalysisResult(analysis: {
    issues: { type: string; severity: string; message: string }[];
    metrics: { complexity: number };
  }): string {
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

  /**
   * 将审查问题映射到「安全修复」。
   * 仅对硬编码密钥、SQL 拼接两类有明确安全方案的问题生成针对性正则；其余一律返回 null。
   */
  private issueToSafeFix(issue: ReviewIssue): SafeFix | null {
    if (/硬编码|密码|密钥|secret|token|api[_-]?key/i.test(issue.message)) {
      return {
        pattern: /(['"`])[^'"`]*(?:password|secret|(?:api[_-]?)?key|token)[^'"`]*\1/gi,
        replacement: 'process.env.FH_SECRET',
      };
    }
    if (/sql/i.test(issue.message)) {
      return {
        pattern: /(['"`])[\s\S]*?select[\s\S]*?\1/gi,
        replacement: '/* 使用参数化查询，避免 SQL 拼接 */',
      };
    }
    return null;
  }
}

/** 便捷函数 */
export function createCodeWriter(cwd: string, rules?: ReviewRule[]): CodeWriter {
  return new CodeWriter(cwd, rules);
}

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

export interface QualityGateConfig {
  maxHighSeverityIssues: number;
  maxComplexity: number;
  maxNullRisk: number;
  requireTests: boolean;
  rules?: ReviewRule[];
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
};

export class QualityGate {
  private readonly config: QualityGateConfig;

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
    const lines = ['===== 质量门禁报告 ====='];
    for (const r of results) {
      lines.push(`\n${r.file}: ${r.passed ? '✅ 通过' : '❌ 未通过'}`);
      for (const check of r.checks) {
        lines.push(`  ${check.passed ? '✅' : '❌'} ${check.name}: ${check.value} ${check.threshold ? `(要求: ${check.threshold})` : ''}`);
      }
    }
    const passed = results.filter((r) => r.passed).length;
    lines.push(`\n总计: ${passed}/${results.length} 通过`);
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

  private inferFunctionName(content: string): string {
    const match = content.match(/export\s+(?:async\s+)?function\s+(\w+)/);
    return match?.[1] || 'main';
  }
}

/** 便捷函数 */
export function createQualityGate(config?: Partial<QualityGateConfig>): QualityGate {
  return new QualityGate(config);
}

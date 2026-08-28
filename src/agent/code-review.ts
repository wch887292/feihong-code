/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * AI 代码审查器（M7）：
 * - 读取代码 → 分析风险 → 提出修复建议 → 应用修复
 * - 安全检查：硬编码密钥、SQL 注入、路径穿越
 * - 性能审查：N+1 查询、未使用索引、内存泄漏
 * - 可配置审查规则（.fhcode-review.yml）
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';

export interface ReviewRule {
  id: string;
  name: string;
  pattern: RegExp;
  severity: 'high' | 'medium' | 'low';
  message: string;
  fix?: string;
}

export interface ReviewResult {
  file: string;
  issues: ReviewIssue[];
  passed: boolean;
}

export interface ReviewIssue {
  ruleId: string;
  line?: number;
  severity: 'high' | 'medium' | 'low';
  message: string;
  suggestion: string;
}

/** 默认审查规则 */
const DEFAULT_RULES: ReviewRule[] = [
  {
    id: 'hardcoded-secret',
    name: '硬编码密钥',
    pattern: /['"`](password|secret|key|token|api[_-]?key)[^'"`]*['"`]/gi,
    severity: 'high',
    message: '检测到可能硬编码的密钥/密码',
    fix: '使用环境变量 FH_* 管理',
  },
  {
    id: 'sql-injection',
    name: 'SQL 注入风险',
    pattern: /['"]\s*(SELECT|INSERT|UPDATE|DELETE)\s+.*['"]\s*\+\s*\w+/i,
    severity: 'high',
    message: '可能的 SQL 注入',
    fix: '使用参数化查询',
  },
  {
    id: 'path-traversal',
    name: '路径穿越',
    pattern: /join\s*\(\s*[^)]+\s*,\s*[^)]*\)/,
    severity: 'medium',
    message: '检查路径拼接安全性',
    fix: '使用 safePath 工具校验',
  },
  {
    id: 'console-log',
    name: 'Console 输出残留',
    pattern: /console\.(log|warn|error)\(/,
    severity: 'low',
    message: '生产环境不应有 console 输出',
    fix: '使用 logger 替代',
  },
];

/** 执行代码审查 */
export function reviewCode(filePath: string, content: string, rules: ReviewRule[] = DEFAULT_RULES): ReviewResult {
  const issues: ReviewIssue[] = [];

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of rules) {
      // 关键：规则正则带 g 标志时 RegExp.test 会残留 lastIndex，必须每次重置，否则跨行误判
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) {
        issues.push({
          ruleId: rule.id,
          line: i + 1,
          severity: rule.severity,
          message: rule.message,
          suggestion: rule.fix || '请手动修复',
        });
      }
    }
  }

  return {
    file: filePath,
    issues,
    passed: issues.filter(i => i.severity === 'high').length === 0,
  };
}

/** 批量审查目录 */
export function reviewDirectory(dirPath: string, _rules?: ReviewRule[]): ReviewResult[] {
  const { analyzeDirectory } = require('../../tools/analysis/code-analyzer');
  const results = analyzeDirectory(dirPath, 50);
  return results.map((r: any) => ({
    file: r.file,
    issues: r.issues.map((i: any) => ({
      ruleId: 'auto',
      line: undefined,
      severity: i.severity,
      message: i.message,
      suggestion: i.suggestion || '',
    })),
    passed: r.issues.filter((i: any) => i.severity === 'high').length === 0,
  }));
}

/** 加载自定义规则 */
export function loadReviewRules(configPath: string): ReviewRule[] {
  if (!existsSync(configPath)) return DEFAULT_RULES;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return (config.rules as ReviewRule[]) || DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

/** 应用修复建议（简化版） */
export function applyFixes(filePath: string, content: string, fixes: Array<{ pattern: RegExp; replacement: string }>): string {
  let result = content;
  for (const fix of fixes) {
    result = result.replace(fix.pattern, fix.replacement);
  }
  writeFileSync(filePath, result, 'utf8');
  console.log('[M7 Review] 修复已应用', { file: filePath, count: fixes.length });
  return result;
}

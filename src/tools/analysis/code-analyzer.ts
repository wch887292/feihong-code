/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 智能代码分析器（M7）：
 * - 静态代码分析：复杂度、潜在 Bug、代码异味
 * - 代码风格检查：命名规范、import 顺序、注释覆盖率
 * - 依赖分析：package.json 依赖关系、版本冲突
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface CodeIssue {
  type: 'bug' | 'warning' | 'style' | 'security';
  severity: 'high' | 'medium' | 'low';
  line?: number;
  message: string;
  suggestion?: string;
}

export interface CodeSuggestion {
  category: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

export interface CodeAnalysisResult {
  file: string;
  metrics: { lines: number; functions: number; complexity: number; commentRatio: number };
  issues: CodeIssue[];
  suggestions: CodeSuggestion[];
}

/** 分析单文件 */
export function analyzeFile(filePath: string, content: string): CodeAnalysisResult {
  const lines = content.split('\n');
  const issues: CodeIssue[] = [];
  const suggestions: CodeSuggestion[] = [];

  // 基础指标
  const funcRegex = /\b(function|const\s+\w+\s*=\s*(async\s+)?\(|class\s+\w+)/g;
  const functions = (content.match(funcRegex) || []).length;

  // 复杂度估算
  const complexity = (
    (content.match(/\bif\b/g) || []).length +
    (content.match(/\bfor\b/g) || []).length +
    (content.match(/\bwhile\b/g) || []).length +
    (content.match(/\bswitch\b/g) || []).length +
    (content.match(/\bcatch\b/g) || []).length
  ) || 1;

  // Bug 检测：未使用变量
  const varRegex = /\b(const|let|var)\s+(\w+)\s*=/g;
  const declaredVars = new Set<string>();
  let match;
  while ((match = varRegex.exec(content)) !== null) {
    declaredVars.add(match[2]);
  }
  for (const v of declaredVars) {
    const uses = (content.match(new RegExp(`\\b${v}\\b`, 'g')) || []).length;
    if (uses === 1) {
      issues.push({ type: 'bug', severity: 'medium', message: `变量 \`${v}\` 可能未使用`, suggestion: '检查是否需要删除或正确使用' });
    }
  }

  // Bug 检测：空值风险
  if (content.match(/!\./g)?.length) {
    issues.push({ type: 'bug', severity: 'high', message: '检测到非空断言 (!.)', suggestion: '使用可选链 (?.) 替代' });
  }

  // Security：硬编码敏感字符串
  if (content.match(/['"`](password|secret|key|token)[^'"`]*['"`]/gi)?.length) {
    issues.push({ type: 'security', severity: 'high', message: '检测到可能硬编码的敏感字符串', suggestion: '使用环境变量管理敏感信息' });
  }

  // Style：console.log 残留
  const consoleLogs = (content.match(/console\.(log|warn|error)\(/g) || []).length;
  if (consoleLogs > 0) {
    issues.push({ type: 'style', severity: 'low', message: `检测到 ${consoleLogs} 处 console 输出`, suggestion: '生产环境应移除' });
  }

  // TODO/FIXME
  const todos = (content.match(/\/\/\s*(TODO|FIXME)/gi) || []).length;
  if (todos > 0) {
    suggestions.push({ category: '技术债务', description: `发现 ${todos} 处 TODO/FIXME`, impact: 'medium' });
  }

  // 注释覆盖率
  const commentLines = content.split('\n').filter(l => l.trim().startsWith('//') || l.trim().startsWith('*')).length;
  const commentRatio = lines.length > 0 ? Math.round(commentLines / lines.length * 100) : 0;

  return {
    file: filePath,
    metrics: { lines: lines.length, functions, complexity, commentRatio },
    issues,
    suggestions,
  };
}

/** 分析目录 */
export function analyzeDirectory(dirPath: string, maxFiles: number = 50): CodeAnalysisResult[] {
  const results: CodeAnalysisResult[] = [];
  if (!existsSync(dirPath)) return results;

  const search = (dir: string, count: number): string[] => {
    if (count >= maxFiles) return [];
    const entries = readdirSync(dir);
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) files.push(...search(fullPath, count - files.length));
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) files.push(fullPath);
    }
    return files;
  };

  for (const file of search(dirPath, maxFiles)) {
    try {
      const content = readFileSync(file, 'utf8');
      results.push(analyzeFile(file, content));
    } catch { /* skip */ }
  }
  return results;
}

/** 分析依赖 */
export function analyzeDependencies(pkgPath: string) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const conflicts: string[] = [];
    const suggestions: CodeSuggestion[] = [];
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      const major = parseInt((version as string).replace('^', '').replace('~', '').split('.')[0]);
      if (major === 0) conflicts.push(`${name}@${version}`);
    }
    return { deps: pkg.dependencies, devDeps: pkg.devDependencies, conflicts, suggestions };
  } catch { return { deps: {}, devDeps: {}, conflicts: [], suggestions: [] }; }
}

/** 生成报告 */
export function generateReport(results: CodeAnalysisResult[]) {
  const allIssues = results.flatMap(r => r.issues);
  const issuesByType: Record<string, number> = {};
  const issuesBySeverity: Record<string, number> = {};
  for (const issue of allIssues) {
    issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
    issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] || 0) + 1;
  }
  const severityOrder = { high: 0, medium: 1, low: 2 };
  allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return {
    summary: { totalFiles: results.length, totalIssues: allIssues.length, issuesByType, issuesBySeverity },
    topIssues: allIssues.slice(0, 10),
    topSuggestions: results.flatMap(r => r.suggestions).slice(0, 5),
  };
}

/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * /grill 技能：红队式代码审查。对指定路径/文件做安全与质量审查，
 * 输出问题清单与严重级别（不修改任何文件，只审查）。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  rule: string;
  detail: string;
}

export interface GrillResult {
  scanned: string[];
  findings: Finding[];
  summary: string;
}

const RULES: Array<{
  id: string;
  severity: Severity;
  pattern: RegExp;
  detail: string;
}> = [
  {
    id: 'secret-leak',
    severity: 'critical',
    pattern: /(?:api[_-]?key|secret|token|password|passwd|私钥)\s*[:=]\s*['"][^'"]{6,}['"]/i,
    detail: '疑似硬编码密钥/凭证，应迁移到环境变量并经脱敏处理',
  },
  {
    id: 'eval-injection',
    severity: 'critical',
    pattern: /\b(eval|execSync|child_process\.exec|new\s+Function)\s*\(/,
    detail: '动态执行/构造代码存在注入风险，需白名单与校验',
  },
  {
    id: 'path-traversal',
    severity: 'high',
    pattern: /\.\.\//,
    detail: '路径中出现 ../，需确认已做沙箱边界校验防止越权访问',
  },
  {
    id: 'no-input-validation',
    severity: 'medium',
    pattern: /JSON\.parse\s*\([^)]*\)\s*(?!\.catch)/,
    detail: 'JSON.parse 未包裹 try/catch，畸形输入将导致进程崩溃',
  },
  {
    id: 'todo-fixme',
    severity: 'low',
    pattern: /\b(TODO|FIXME|XXX)\b/,
    detail: '存在待办标记，需跟进或关联任务跟踪',
  },
];

export function runGrill(rootDir: string, target = '.'): GrillResult {
  const base = join(rootDir, target);
  // 支持单文件目标（M1.1a IDE 内联评审）：文件路径直接分析，否则按目录递归收集
  const files = existsSync(base) && statSync(base).isFile() ? [base] : collectFiles(base);
  const findings: Finding[] = [];

  for (const file of files) {
    if (!/\.(ts|js|tsx|jsx|json|md|py|go|java)$/.test(file)) continue;
    const isCode = /\.(ts|js|tsx|jsx|py|go|java)$/.test(file);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      // 规则定义本身（id/severity/pattern/detail）不参与自检，避免自我误报
      if (/^\s*(id|severity|pattern|detail)\s*:/.test(line)) return;
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
      for (const rule of RULES) {
        // 路径穿越与 JSON.parse 仅针对真实代码文件，文档(.md/.json)按行文处理，避免误报
        if ((rule.id === 'path-traversal' || rule.id === 'no-input-validation') && !isCode) continue;
        // 排除 import/require/export 语句里的 ../（模块相对路径，非文件穿越）
        if (rule.id === 'path-traversal' && /(import\s|export\s|require\(|from\s+['"])/.test(line)) continue;
        // 注释中的 ../ 多为文档说明，非真实路径穿越
        if (rule.id === 'path-traversal' && isComment) continue;
        // no-input-validation：若 JSON.parse 已在 try/catch 窗口内则视为已防护
        if (rule.id === 'no-input-validation') {
          const before = lines.slice(Math.max(0, idx - 3), idx + 1).join('\n');
          const after = lines.slice(idx, Math.min(lines.length, idx + 4)).join('\n');
          if (/try\s*\{/.test(before) || /catch\s*[\(\{]/.test(after)) continue;
        }
        if (rule.pattern.test(line)) {
          findings.push({
            file: relative(rootDir, file),
            line: idx + 1,
            severity: rule.severity,
            rule: rule.id,
            detail: rule.detail,
          });
        }
      }
    });
  }

  const counts = findings.reduce<Record<Severity, number>>(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );

  const summary =
    `审查 ${files.length} 个文件，发现 ${findings.length} 个问题：` +
    `致命 ${counts.critical} / 高危 ${counts.high} / 中 ${counts.medium} / 低 ${counts.low}`;

  return { scanned: files.map((f) => relative(rootDir, f)), findings, summary };
}

function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (p: string) => {
    let entries: string[];
    try {
      entries = readdirSync(p);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
      const full = join(p, e);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

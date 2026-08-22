/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * /self-heal 技能：系统化自我修复错误。
 *  - 复用 M6 agent/self-heal.ts 的错误分类器（compile-error/runtime-error/...）
 *  - 输入：错误文本（可附带命令/文件上下文）
 *  - 输出：结构化诊断（类别/根因/修复建议/验证步骤/复现命令）
 * 只读诊断：不修改任何文件，供 Agent 决策与用户参考。
 */
import { classifyError } from '../agent/self-heal';

export interface SelfHealResult {
  category: string;
  message: string;
  fixHint: string;
  /** 建议的验证/复现命令 */
  verifyCommands: string[];
  /** 是否识别为已知错误类别 */
  known: boolean;
  /** 输出给用户的完整文本 */
  text: string;
}

/** 各类别对应的验证命令建议（编译类可增量聚焦，shell 类通用） */
const VERIFY_BY_CATEGORY: Record<string, string[]> = {
  'compile-error': ['npm run build', 'npx tsc --noEmit'],
  'runtime-error': ['node --trace-uncaught <入口>', '重跑触发异常的最小用例'],
  'path-traversal': ['核对相对/绝对路径，确认目标在工作区内', 'ls 目标路径确认存在'],
  timeout: ['检查死循环/长任务，缩短超时或分批执行', 'ps 查看残留进程'],
  'permission-denied': ['检查文件权限/目录存在性', '确认进程用户是否有写权限'],
  'model-error': ['检查 API Key / 配额 / 网络连通性', 'curl 直连模型端点验证'],
};

function categoryName(cat: string): string {
  const map: Record<string, string> = {
    'compile-error': '编译错误',
    'runtime-error': '运行时错误',
    'path-traversal': '路径穿越/越界',
    timeout: '超时',
    'permission-denied': '权限拒绝',
    'model-error': '模型调用错误',
    unknown: '未知',
  };
  return map[cat] || cat;
}

/**
 * 诊断错误文本，返回结构化自我修复建议。
 * @param errorText  错误输出（尽可能完整）
 * @param context    可选上下文（触发命令/涉及文件），用于增强提示
 */
export function runSelfHeal(errorText: string, context = ''): SelfHealResult {
  const text = (errorText || '').trim();
  const ctx = (context || '').trim();
  const analysis = classifyError(text);
  const known = analysis !== null;
  const category = known ? analysis.category : 'unknown';
  const fixHint = known ? analysis.fixHint : '无法按规则表归类，建议人工查看完整堆栈与上下文。';
  const verifyCommands = VERIFY_BY_CATEGORY[category] || ['重跑原失败操作确认'];

  const lines: string[] = [];
  lines.push('【/self-heal】错误诊断');
  lines.push(`  类别: ${categoryName(category)}${known ? ` (${category})` : ''}`);
  lines.push(`  根因: ${known ? fixHint : '未能自动归类'}`);
  if (ctx) lines.push(`  上下文: ${ctx}`);
  if (known) {
    lines.push(`  修复建议: ${fixHint}`);
    lines.push('  验证步骤:');
    verifyCommands.forEach((c, i) => lines.push(`    ${i + 1}. ${c}`));
  } else {
    lines.push('  建议: 提供完整错误堆栈 + 触发命令 + 涉及文件，再执行 /self-heal');
  }
  lines.push('  状态: ' + (known ? '可自动修复（按建议执行后重验）' : '需人工介入'));

  return {
    category,
    message: text.slice(0, 2000),
    fixHint,
    verifyCommands,
    known,
    text: lines.join('\n'),
  };
}

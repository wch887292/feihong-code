/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 报告器（可插拔）：把评测报告渲染为 markdown / JSON 等格式。
 * 复刻自 scripts/eval-swebench.mjs buildReport，拆分为独立可插拔实现。
 */
import type { HarnessReport } from './types';
import type { VerifyResult } from '../agent/swe-verifier';

/** 报告器契约：将报告渲染为字符串（markdown / JSON / 其他） */
export interface HarnessReporter {
  readonly id: string;
  render(report: HarnessReport): string;
}

/** Markdown 报告器：表格 + 汇总（人类可读，可写文件） */
export class MarkdownReporter implements HarnessReporter {
  readonly id = 'markdown';

  render(report: HarnessReport): string {
    const { meta, results, summary } = report;
    const lines: string[] = [];
    lines.push('# SWE-bench 跑分报告');
    lines.push('');
    lines.push(`- 数据集: ${meta.split} · 实例数: ${summary.total} · 完成: ${summary.completed} · 通过率: ${Math.round(summary.rate * 100)}%`);
    lines.push(`- 运行时间: ${meta.startedAt} · 模式: ${meta.mode}`);
    lines.push('');
    lines.push('| instance_id | repo | 问题 | F2P | P2P | 结果 | 迭代 | 工具 |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const r of results) {
      lines.push(`| ${r.instance_id} | ${r.repo} | ${r.problem} | ${r.failToPass} | ${r.passToPass} | ${r.ok ? '✅' : '❌'} | ${r.iterations} | ${r.toolCalls} |`);
    }
    lines.push('');
    lines.push(`汇总: ${summary.completed}/${summary.total} 通过（${meta.mode}）`);
    return lines.join('\n');
  }
}

/** JSON 报告器：结构化输出（CI 门禁 / 程序消费） */
export class JsonReporter implements HarnessReporter {
  readonly id = 'json';

  render(report: HarnessReport): string {
    return JSON.stringify(report, null, 2);
  }
}

/**
 * 验证矩阵渲染器（P0-B · 对齐 ruflo 签名验证矩阵 + 「验证跑通再汇报」纪律）：
 *  - 数据源复用 swe-verifier 的 VerifyResult.steps[]（name/command/status/exitCode/durationMs）
 *  - 渲染一张可核对的 markdown 矩阵：| 用例 | 命令 | 状态 | 退出码 | 耗时 |
 *  - 末尾一行汇总「共 N 例 · 通过 X · 失败 Y · 跳过 Z」，便于人工/CI 一眼核对
 *  - 纯渲染函数，无副作用、不触盘；落地由调用方（swe-agent finalize）决定写文件
 */
export class VerificationMatrixReporter {
  readonly id = 'verification-matrix';

  /** 单个子任务的验证矩阵（markdown 文本） */
  renderTask(matrix: { taskId: string; title: string; result: VerifyResult }): string {
    const lines: string[] = [];
    lines.push(`### 验证矩阵 · [${matrix.taskId}] ${matrix.title}`);
    lines.push('');
    lines.push('| 用例 | 命令 | 状态 | 退出码 | 耗时 |');
    lines.push('|---|---|---|---|---|');
    const steps = matrix.result.steps;
    if (steps.length === 0) {
      lines.push(`| （无验证步骤） | ${matrix.result.errorSummary || 'skipped'} | ⚠️ ${matrix.result.overall} | - | - |`);
    } else {
      for (const s of steps) {
        const mark = s.status === 'pass' ? '✅' : s.status === 'fail' ? '❌' : '⚠️';
        lines.push(`| ${s.name} | \`${s.command}\` | ${mark} ${s.status} | ${s.exitCode} | ${s.durationMs}ms |`);
      }
    }
    lines.push('');
    const pass = steps.filter((s) => s.status === 'pass').length;
    const fail = steps.filter((s) => s.status === 'fail').length;
    const skip = steps.filter((s) => s.status === 'skipped').length;
    lines.push(`共 ${steps.length} 例 · 通过 ${pass} · 失败 ${fail} · 跳过 ${skip} · 总体: ${matrix.result.overall}`);
    if (matrix.result.overall === 'fail') {
      lines.push(`错误摘要: ${matrix.result.errorSummary.slice(0, 500)}`);
    }
    return lines.join('\n');
  }

  /** 全部子任务的验证矩阵（markdown 文本） */
  renderAll(tasksWithResults: Array<{ taskId: string; title: string; result: VerifyResult }>): string {
    const header = [
      '# 任务验证矩阵',
      '',
      '> 本矩阵是任务收尾的可核对证据；任何「已通过」结论必须与本表一致，否则不得标记 done。',
      '',
    ];
    if (tasksWithResults.length === 0) {
      return header.concat(['（无子任务执行记录）']).join('\n');
    }
    const body = tasksWithResults.map((t) => this.renderTask(t)).join('\n\n---\n\n');
    const allPass = tasksWithResults.every((t) => t.result.overall === 'pass' || t.result.overall === 'skipped');
    const totalSteps = tasksWithResults.reduce((n, t) => n + t.result.steps.length, 0);
    const footer = `\n\n## 汇总\n\n- 子任务: ${tasksWithResults.length} · 验证步骤总数: ${totalSteps} · 总体: ${allPass ? '✅ 全部通过' : '❌ 存在失败'}`;
    return header.concat(body, footer).join('\n');
  }
}

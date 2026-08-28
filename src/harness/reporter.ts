/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 报告器（可插拔）：把评测报告渲染为 markdown / JSON 等格式。
 * 复刻自 scripts/eval-swebench.mjs buildReport，拆分为独立可插拔实现。
 */
import type { HarnessReport } from './types';

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

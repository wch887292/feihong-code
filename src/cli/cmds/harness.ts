/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 评测命令
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { writeFileSync } from 'fs';
import { t } from '../../shared/i18n';
import { loadConfig } from '../../shared/config';
import { Harness } from '../../harness/harness';
import { SwebenchLoader } from '../../harness/loader';
import { MockOrchestratorExecutor, RealModelExecutor } from '../../harness/executor';
import { FileExistsVerifier, TestVerifier } from '../../harness/verifier';
import { MarkdownReporter, JsonReporter } from '../../harness/reporter';

export interface HarnessCmdOptions {
  split: string;
  limit: number;
  offset: number;
  mode: 'mock' | 'real';
  /** P7-1: 验证器类型 file=文件存在（默认）/ test=官方测试通过（TestVerifier，跑 FAIL_TO_PASS） */
  verifier?: 'file' | 'test';
  testCommand?: string;
  report?: string;
  json: boolean;
}

/** fhcode harness [--split lite|verified] [--limit N] [--offset N] [--mode mock|real] [--report 路径] [--json] */
export async function runHarness(opts: HarnessCmdOptions): Promise<void> {
  console.log(t('harness.start', { mode: opts.mode, split: opts.split, limit: String(opts.limit) }));

  // 真实模式就绪检查：未配置任何模型供应商时给出明确接入指引
  if (opts.mode === 'real') {
    const cfg = loadConfig();
    if (!cfg.models.providers.length) {
      console.error(t('harness.noProvider'));
      return;
    }
  }

  const loader = new SwebenchLoader({ split: opts.split });
  const executor = opts.mode === 'real' ? new RealModelExecutor() : new MockOrchestratorExecutor();
  // P7-1: 可插拔验证器——--verifier test 用 TestVerifier 跑 FAIL_TO_PASS 官方测试（真实硬指标）
  const verifier = opts.verifier === 'test'
    ? new TestVerifier({ testCommand: opts.testCommand })
    : new FileExistsVerifier();
  const harness = new Harness({
    loader,
    executor,
    verifier,
    reporter: opts.json ? new JsonReporter() : new MarkdownReporter(),
    limit: opts.limit,
    offset: opts.offset,
    onProgress: (r, i, total) => {
      console.log(`  [${i}/${total}] ${r.ok ? '✅' : '❌'} ${r.instance_id} iter=${r.iterations} tools=${r.toolCalls}`);
    },
  });

  const { report, rendered } = await harness.run();
  if (opts.report) {
    writeFileSync(opts.report, rendered, 'utf8');
    console.log(t('harness.reportWritten', { path: opts.report }));
  } else {
    console.log('\n' + rendered);
  }
  console.log(t('harness.summary', {
    completed: String(report.summary.completed),
    total: String(report.summary.total),
    rate: String(Math.round(report.summary.rate * 100)),
  }));
  // 有失败实例 → 退出码非零（供 CI 门禁复用）
  if (report.summary.completed < report.summary.total) process.exitCode = 1;
  console.log(t('app.signature'));
}

/* ===================== computer：命令行直接控制电脑（手机端/终端双通道） ===================== */


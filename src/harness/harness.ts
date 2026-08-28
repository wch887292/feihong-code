/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 编排入口：加载实例 → 逐条执行 → 验证 → 报告。
 * 所有组件（加载器/执行器/验证器/报告器）均可插拔注入。
 */
import type { DatasetLoader } from './loader';
import type { HarnessExecutor } from './executor';
import type { HarnessVerifier } from './verifier';
import type { HarnessReporter } from './reporter';
import type { HarnessReport, HarnessResult } from './types';

export interface HarnessOptions {
  loader: DatasetLoader;
  executor: HarnessExecutor;
  /** 缺省不验证（仅看编排是否收尾） */
  verifier?: HarnessVerifier;
  /** 缺省 markdown */
  reporter?: HarnessReporter;
  limit?: number;
  offset?: number;
  /** 逐实例进度回调（CLI 实时打印用） */
  onProgress?: (result: HarnessResult, index: number, total: number) => void;
}

export interface HarnessRunResult {
  report: HarnessReport;
  rendered: string;
}

/** harness 编排器：load → execute → verify → report */
export class Harness {
  constructor(private readonly opts: HarnessOptions) {}

  async run(): Promise<HarnessRunResult> {
    const { loader, executor, verifier, reporter, limit = 10, offset = 0, onProgress } = this.opts;

    const all = await loader.load();
    const slice = all.slice(offset, offset + limit);

    const results: HarnessResult[] = [];
    for (const inst of slice) {
      const exec = await executor.execute(inst);
      const verified = verifier ? await verifier.verify(exec.cwd, inst) : true;
      const result: HarnessResult = {
        instance_id: exec.instance_id,
        repo: exec.repo,
        problem: exec.problem,
        failToPass: exec.failToPass,
        passToPass: exec.passToPass,
        ok: exec.runOk && verified,
        iterations: exec.iterations,
        toolCalls: exec.toolCalls,
        verified,
      };
      exec.cleanup();
      results.push(result);
      onProgress?.(result, results.length, slice.length);
    }

    const completed = results.filter((r) => r.ok).length;
    const report: HarnessReport = {
      meta: {
        split: (loader as { opts?: { split?: string } }).opts?.split ?? loader.id,
        limit,
        offset,
        mode: executor.id,
        startedAt: new Date().toISOString(),
      },
      results,
      summary: {
        total: results.length,
        completed,
        rate: results.length ? completed / results.length : 0,
      },
    };

    const renderer = reporter ?? new (await import('./reporter')).MarkdownReporter();
    return { report, rendered: renderer.render(report) };
  }
}

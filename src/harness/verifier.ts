/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 验证器（可插拔）：判定执行产出是否满足通过条件。
 *  - HarnessVerifier 接口：文件存在 / 测试通过 / 自定义规则均可实现接入（异步，跑测试需要）
 *  - FileExistsVerifier：检查工作区是否生成了指定文件（当前 mock 闭环的通过标准）
 *  - TestVerifier：在工作区运行测试命令判定通过——实例带 FAIL_TO_PASS 时
 *    优先以这些失败用例为测试目标（`npm test -- <用例>`），否则跑默认测试套件。
 *    命令经 sanitizeManagedCommand 约束（仅包管理器脚本，防命令注入）。
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { runCommand, sanitizeManagedCommand } from '../tools/shell/exec';
import type { HarnessInstance } from './types';

/** 验证器契约：在执行工作区上判定单个实例是否通过（异步） */
export interface HarnessVerifier {
  readonly id: string;
  verify(cwd: string, instance: HarnessInstance): Promise<boolean>;
}

/** 文件存在验证器：默认检查方案文件是否生成 */
export class FileExistsVerifier implements HarnessVerifier {
  readonly id = 'file-exists';

  constructor(private readonly file: string = 'SOLUTION.md') {}

  async verify(cwd: string, _instance: HarnessInstance): Promise<boolean> {
    return existsSync(join(cwd, this.file));
  }
}

/** 测试通过型验证器：在工作区运行测试，退出码 0 即通过 */
export class TestVerifier implements HarnessVerifier {
  readonly id = 'test-run';

  constructor(
    private readonly opts: { testCommand?: string; timeoutMs?: number } = {},
  ) {}

  async verify(cwd: string, instance: HarnessInstance): Promise<boolean> {
    // 有 FAIL_TO_PASS 用例时优先跑这些用例（回归到「失败用例现在应通过」）；否则跑默认套件
    const defaultCmd =
      instance.FAIL_TO_PASS.length > 0 ? `npm test -- ${instance.FAIL_TO_PASS.join(' ')}` : 'npm test';
    const cmd = sanitizeManagedCommand(this.opts.testCommand, defaultCmd);
    if (!cmd) return false; // 命令未通过受管约束，判为不通过
    const res = await runCommand(cmd, cwd, this.opts.timeoutMs ?? 120000);
    return res.code === 0;
  }
}

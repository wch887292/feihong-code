/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 验证器（可插拔）：判定执行产出是否满足通过条件。
 *  - HarnessVerifier 接口：文件存在 / 测试通过 / 自定义规则均可实现接入（异步，跑测试需要）
 *  - FileExistsVerifier：检查工作区是否生成了指定文件（mock 闭环冒烟用）
 *  - TestVerifier：按 SWE-bench 语义验证——
 *      ① FAIL_TO_PASS 用例必须先失败后通过（修复前验证失败可选用 beforeCommand）；
 *      ② 修复后 FAIL_TO_PASS 必须全部通过；
 *      ③ PASS_TO_PASS 回归测试必须仍然通过（防止修坏既有功能）。
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

/**
 * 测试通过型验证器（SWE-bench 语义）：
 * 修复后 FAIL_TO_PASS 全部通过 且 PASS_TO_PASS 回归全部通过，才算验证通过。
 * 可选 beforeCommand：在验证前先跑一次（确认 FAIL_TO_PASS 原本确实失败，防"测试本来就过"的假阳性）。
 */
export class TestVerifier implements HarnessVerifier {
  readonly id = 'test-run';

  constructor(
    private readonly opts: {
      testCommand?: string;
      timeoutMs?: number;
      /** 若有 FAIL_TO_PASS 时的测试命令；缺省 npm test -- <用例> */
      failToPassCommand?: string;
      /** 跑 PASS_TO_PASS 回归的命令；缺省 npm test */
      passToPassCommand?: string;
      /** 修复前冒烟命令（验证 FAIL_TO_PASS 原本失败）；缺省不执行 */
      beforeCommand?: string;
    } = {},
  ) {}

  /** 在 cwd 执行单条命令并返回退出码；命令不合法时返回 -1（判为不通过，防注入） */
  private async runOne(cmd: string, cwd: string): Promise<number> {
    const safe = sanitizeManagedCommand(cmd, cmd);
    if (!safe) return -1;
    const res = await runCommand(safe, cwd, this.opts.timeoutMs ?? 120000);
    return res.code;
  }

  /** 从命令的退出码判断"存在失败用例"（退出码非 0 即视为有失败） */
  private anyFailed(cmd: string, cwd: string): Promise<boolean> {
    return this.runOne(cmd, cwd).then((code) => code !== 0);
  }

  async verify(cwd: string, instance: HarnessInstance): Promise<boolean> {
    // 0) 可选：修复前确认 FAIL_TO_PASS 原本失败（真 SWE-bench 的差分前提）
    if (this.opts.beforeCommand) {
      const preFail = await this.anyFailed(this.opts.beforeCommand, cwd);
      // 若修复前没有失败用例，则本次验证无意义（用例本来就过），判为不通过
      if (!preFail) return false;
    }

    // 1) FAIL_TO_PASS：修复后这些用例必须全部通过
    const ftpCmd =
      this.opts.failToPassCommand ??
      (instance.FAIL_TO_PASS.length > 0
        ? `npm test -- ${instance.FAIL_TO_PASS.map(quoteTestId).join(' ')}`
        : this.opts.testCommand ?? 'npm test');
    const ftpCode = await this.runOne(ftpCmd, cwd);
    if (ftpCode !== 0) return false;

    // 2) PASS_TO_PASS：既有功能回归必须仍然通过（防止修坏）
    if (instance.PASS_TO_PASS.length > 0) {
      const p2pCmd = this.opts.passToPassCommand ?? this.opts.testCommand ?? 'npm test';
      const p2pCode = await this.runOne(p2pCmd, cwd);
      if (p2pCode !== 0) return false;
    }

    return true;
  }
}

/** 将测试用例 id 安全转义为 shell 参数（仅允许 [A-Za-z0-9_\-.:/\[\]#]） */
function quoteTestId(id: string): string {
  if (!/^[A-Za-z0-9_\-.:/[\]#]+$/.test(id)) return '';
  return id;
}

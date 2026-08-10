#!/usr/bin/env node
/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * CLI 入口：参数解析 → 版本/帮助/单命令/REPL 分发
 */
import { randomUUID } from 'crypto';
import { setRunId } from '../shared/logger';
import { parseArgs } from './commands';
import { startRepl } from './repl';
import { runGoal, isOfflineByDefault } from './run';
import { VERSION, PRODUCT, TAGLINE, SIGNATURE } from './version';

function printVersion(): void {
  console.log(`fhcode v${VERSION}`);
  console.log(`${PRODUCT} — ${TAGLINE}`);
  console.log(SIGNATURE);
}

function printHelp(): void {
  console.log(`飞虹 Code (fhcode) v${VERSION}

用法:
  fhcode                 进入交互 REPL
  fhcode "<需求>"       以单命令模式执行一条需求
  fhcode --version      显示版本 (-v)
  fhcode --help         显示帮助 (-h)

说明: 未配置 FH_PROVIDERS 时自动进入离线模式（脚本化 Mock 驱动闭环验证）。
配置 FH_PROVIDERS（OpenAI 兼容 / Ollama）后，将调用真实大模型执行任务。
署名: ${SIGNATURE}`);
}

async function main(): Promise<void> {
  setRunId(randomUUID());

  const args = parseArgs(process.argv.slice(2));

  if (args.flags.version) {
    printVersion();
    return;
  }
  if (args.flags.help) {
    printHelp();
    return;
  }
  if (args.command) {
    const offline = isOfflineByDefault();
    await runGoal(args.command, { offline });
    return;
  }

  await startRepl();
}

main().catch((err: unknown) => {
  setRunId(randomUUID());
  // 结构化错误日志
  console.error('运行出错:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

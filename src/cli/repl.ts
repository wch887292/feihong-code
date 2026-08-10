/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 交互式 REPL：逐条需求交给编排器执行。未配置模型时走离线模式。
 */
import * as readline from 'readline';
import { runGoal, isOfflineByDefault } from './run';

export async function startRepl(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('飞虹 Code REPL（输入需求回车执行，exit 退出）');
  console.log('提示：未配置 FH_PROVIDERS 时自动离线模式运行。\n');

  while (true) {
    const line = await new Promise<string>((resolve) => rl.question('飞虹> ', resolve));
    const cmd = line.trim();
    if (cmd === 'exit' || cmd === 'quit') break;
    if (!cmd) continue;
    const offline = isOfflineByDefault();
    try {
      await runGoal(cmd, { offline });
    } catch (e) {
      console.error('执行出错:', e instanceof Error ? e.message : String(e));
    }
  }

  rl.close();
  console.log('\n再见。');
}

/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 交互式 REPL：逐条需求交给编排器执行。未配置模型时走离线模式。
 */
import * as readline from 'readline';
import { runGoal, isOfflineByDefault } from './run';
import { t } from '../shared/i18n';

export async function startRepl(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(t('repl.welcome'));
  console.log(t('repl.hint'));

  while (true) {
    const line = await new Promise<string>((resolve) => rl.question(t('repl.prompt'), resolve));
    const cmd = line.trim();
    if (cmd === 'exit' || cmd === 'quit') break;
    if (!cmd) continue;
    const offline = isOfflineByDefault();
    try {
      await runGoal(cmd, { offline });
    } catch (e) {
      console.error(t('repl.errorPrefix') + (e instanceof Error ? e.message : String(e)));
    }
  }

  rl.close();
  console.log(t('repl.bye'));
}

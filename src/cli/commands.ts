/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 命令行参数解析
 */
export interface ParsedArgs {
  flags: { version?: boolean; help?: boolean };
  /** 单命令模式下的需求文本（首个非 flag 参数） */
  command?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: ParsedArgs['flags'] = {};
  let command: string | undefined;

  for (const arg of argv) {
    if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      // 未知长选项：忽略，避免阻断
    } else if (command === undefined) {
      command = arg;
    }
  }

  return { flags, command };
}

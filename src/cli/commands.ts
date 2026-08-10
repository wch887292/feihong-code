/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 命令行参数解析：
 *  - --version / -v   版本
 *  - --help / -h      帮助
 *  - --parallel       多子代理并行模式（M2）
 *  - /plan <目标>     生成实现计划（只读）
 *  - /grill [路径]    红队式代码审查（只读）
 *  - /goal <目标>     分解并保存高层目标（只读）
 *  - 其余文本          单命令需求
 */
export type SkillCommand = 'plan' | 'grill' | 'goal';

export interface ParsedArgs {
  flags: { version?: boolean; help?: boolean; parallel?: boolean };
  /** 单命令模式下的需求文本（首个非 flag 参数） */
  command?: string;
  /** 斜杠技能命令：/plan /grill /goal */
  skill?: { kind: SkillCommand; arg: string };
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: ParsedArgs['flags'] = {};
  let command: string | undefined;
  let skill: ParsedArgs['skill'] | undefined;
  const rest: string[] = [];

  for (const arg of argv) {
    if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--parallel') {
      flags.parallel = true;
    } else if (arg.startsWith('/')) {
      const [kind, ...parts] = arg.slice(1).split(/\s+/);
      const valid = ['plan', 'grill', 'goal'] as const;
      if (valid.includes(kind as (typeof valid)[number])) {
        skill = { kind: kind as SkillCommand, arg: parts.join(' ') };
      }
    } else if (arg.startsWith('--')) {
      // 未知长选项：忽略
    } else {
      rest.push(arg);
    }
  }

  // 斜杠技能后面的自由文本也算其参数
  if (skill) {
    skill.arg = (skill.arg + ' ' + rest.join(' ')).trim();
  } else if (rest.length > 0) {
    command = rest.join(' ');
  }

  return { flags, command, skill };
}

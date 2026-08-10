/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 命令行参数解析：
 *  - --version / -v   版本
 *  - --help / -h      帮助
 *  - --parallel       多子代理并行模式（M2）
 *  - --yes            危险操作确认（M3 rollback 用）
 *  - /plan <目标>     生成实现计划（只读）
 *  - /grill [路径]    红队式代码审查（只读）
 *  - /goal <目标>     分解并保存高层目标（只读）
 *  - sessions         列出历史会话（M3）
 *  - resume <id>      从检查点恢复会话（M3）
 *  - diff [id]        展示会话/工作区变更（M3）
 *  - rollback <id>    回滚会话改动（M3，需 --yes）
 *  - whoami           当前租户/用户/角色（M4）
 *  - policy           查看生效权限策略（M4）
 *  - audit [verify]   审计记录 / 哈希链校验（M4）
 *  - tenants          租户用量汇总（M4）
 *  - 其余文本          单命令需求
 */
export type SkillCommand = 'plan' | 'grill' | 'goal';

export type ManagementCommand =
  | { kind: 'sessions' }
  | { kind: 'resume'; id: string }
  | { kind: 'diff'; id?: string }
  | { kind: 'rollback'; id: string; yes: boolean }
  | { kind: 'whoami' }
  | { kind: 'policy' }
  | { kind: 'audit'; verify: boolean; limit: number }
  | { kind: 'tenants' };

export interface ParsedArgs {
  flags: {
    version?: boolean;
    help?: boolean;
    parallel?: boolean;
    yes?: boolean;
    limit?: number;
  };
  /** 单命令模式下的需求文本（首个非 flag 参数） */
  command?: string;
  /** 斜杠技能命令：/plan /grill /goal */
  skill?: { kind: SkillCommand; arg: string };
  /** M3 会话管理命令 */
  manage?: ManagementCommand;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: ParsedArgs['flags'] = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') flags.version = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--parallel') flags.parallel = true;
    else if (arg === '--yes') flags.yes = true;
    else if (arg === '--limit') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) flags.limit = Math.floor(n);
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) flags.limit = Math.floor(n);
    } else positional.push(arg);
  }

  const head = positional[0];
  const rest = positional.slice(1);

  // 会话管理命令
  if (head === 'sessions') {
    return { flags, manage: { kind: 'sessions' } };
  }
  if (head === 'resume') {
    return { flags, manage: { kind: 'resume', id: rest[0] ?? '' } };
  }
  if (head === 'diff') {
    return { flags, manage: { kind: 'diff', id: rest[0] } };
  }
  if (head === 'rollback') {
    return { flags, manage: { kind: 'rollback', id: rest[0] ?? '', yes: !!flags.yes } };
  }

  // M4 企业管理命令
  if (head === 'whoami') return { flags, manage: { kind: 'whoami' } };
  if (head === 'policy') return { flags, manage: { kind: 'policy' } };
  if (head === 'tenants') return { flags, manage: { kind: 'tenants' } };
  if (head === 'audit') {
    return {
      flags,
      manage: { kind: 'audit', verify: rest[0] === 'verify', limit: flags.limit ?? 20 },
    };
  }

  // 斜杠技能
  if (head?.startsWith('/')) {
    const [kind, ...parts] = head.slice(1).split(/\s+/);
    const valid = ['plan', 'grill', 'goal'] as const;
    if (valid.includes(kind as (typeof valid)[number])) {
      const arg = [...parts, ...rest].join(' ').trim();
      return { flags, skill: { kind: kind as SkillCommand, arg } };
    }
  }

  // 单命令需求
  if (head) {
    return { flags, command: positional.join(' ') };
  }
  return { flags };
}

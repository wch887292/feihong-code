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
 *  - serve [--port N] 启动 Web 管理控制台（M5）
 *  - code-write <目标> 自主编写代码（M8）
 *  - quality-gate [路径] 质量门禁审查（M8）
 *  - self-improve     自我改进统计（M8）
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
  | { kind: 'tenants' }
  | { kind: 'serve'; port?: number }
  | { kind: 'model-stats' }
  | { kind: 'experiences'; path?: string }
  | { kind: 'code-write'; goal: string; filePath: string }
  | { kind: 'quality-gate'; path: string }
  | { kind: 'self-improve' }
  | {
      kind: 'swe';
      goal: string;
      repo?: string;
      maxTasks: number;
      maxRetries: number;
      verifyOnly: boolean;
      planOnly: boolean;
    };

export interface ParsedArgs {
  flags: {
    version?: boolean;
    help?: boolean;
    parallel?: boolean;
    yes?: boolean;
    limit?: number;
    port?: number;
    repo?: string;
    maxTasks?: number;
    maxRetries?: number;
    verifyOnly?: boolean;
    planOnly?: boolean;
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
    else if (arg === '--port') {
      const next = argv[++i];
      const n = Number(next);
      if (next !== undefined && Number.isFinite(n) && n > 0) flags.port = Math.floor(n);
    } else if (arg.startsWith('--port=')) {
      const n = Number(arg.slice('--port='.length));
      if (Number.isFinite(n) && n > 0) flags.port = Math.floor(n);
    }
    else if (arg === '--limit') {
      const next = argv[++i];
      const n = Number(next);
      if (next !== undefined && Number.isFinite(n) && n > 0) flags.limit = Math.floor(n);
    }     else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) flags.limit = Math.floor(n);
    } else if (arg === '--repo') {
      flags.repo = argv[++i];
    } else if (arg.startsWith('--repo=')) {
      flags.repo = arg.slice('--repo='.length);
    } else if (arg === '--max-tasks') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) flags.maxTasks = Math.floor(n);
    } else if (arg.startsWith('--max-tasks=')) {
      const n = Number(arg.slice('--max-tasks='.length));
      if (Number.isFinite(n) && n > 0) flags.maxTasks = Math.floor(n);
    } else if (arg === '--max-retries') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n >= 0) flags.maxRetries = Math.floor(n);
    } else if (arg.startsWith('--max-retries=')) {
      const n = Number(arg.slice('--max-retries='.length));
      if (Number.isFinite(n) && n >= 0) flags.maxRetries = Math.floor(n);
    } else if (arg === '--verify-only') {
      flags.verifyOnly = true;
    } else if (arg === '--plan-only') {
      flags.planOnly = true;
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
  if (head === 'serve') return { flags, manage: { kind: 'serve', port: flags.port } };
  if (head === 'audit') {
    return {
      flags,
      manage: { kind: 'audit', verify: rest[0] === 'verify', limit: flags.limit ?? 20 },
    };
  }

  // M6 自我进化命令
  if (head === 'model-stats') return { flags, manage: { kind: 'model-stats' } };
  if (head === 'experiences') return { flags, manage: { kind: 'experiences', path: rest[0] } };

  // M8 自主编程命令
  if (head === 'code-write') {
    return {
      flags,
      manage: {
        kind: 'code-write',
        goal: rest.join(' ') || 'auto-generate',
        filePath: 'output.ts',
      },
    };
  }
  if (head === 'quality-gate') {
    return { flags, manage: { kind: 'quality-gate', path: rest[0] || '.' } };
  }
  if (head === 'self-improve') {
    return { flags, manage: { kind: 'self-improve' } };
  }

  // M9 全自动软件工程 Agent
  if (head === 'swe') {
    return {
      flags,
      manage: {
        kind: 'swe',
        goal: rest.join(' ') || 'auto-improve',
        repo: flags.repo,
        maxTasks: flags.maxTasks ?? 8,
        maxRetries: flags.maxRetries ?? 2,
        verifyOnly: !!flags.verifyOnly,
        planOnly: !!flags.planOnly,
      },
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

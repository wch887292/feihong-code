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
      maxIterations: number;
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
    maxIterations?: number;
    verifyOnly?: boolean;
    planOnly?: boolean;
    lang?: string;
  };
  /** 单命令模式下的需求文本（首个非 flag 参数） */
  command?: string;
  /** 斜杠技能命令：/plan /grill /goal */
  skill?: { kind: SkillCommand; arg: string };
  /** M3 会话管理命令 */
  manage?: ManagementCommand;
}

type FlagKey = keyof ParsedArgs['flags'];
type FlagSpec =
  | { kind: 'bool'; key: FlagKey }
  | { kind: 'int'; min: number; key: FlagKey }
  | { kind: 'str'; key: FlagKey };

/** 标志规格表：统一处理 `--flag` 与 `--flag=value` 两种写法，降低解析分支复杂度 */
const FLAG_SPECS: Record<string, FlagSpec> = {
  version: { kind: 'bool', key: 'version' },
  help: { kind: 'bool', key: 'help' },
  parallel: { kind: 'bool', key: 'parallel' },
  yes: { kind: 'bool', key: 'yes' },
  'verify-only': { kind: 'bool', key: 'verifyOnly' },
  'plan-only': { kind: 'bool', key: 'planOnly' },
  port: { kind: 'int', min: 1, key: 'port' },
  limit: { kind: 'int', min: 1, key: 'limit' },
  repo: { kind: 'str', key: 'repo' },
  lang: { kind: 'str', key: 'lang' },
  'max-tasks': { kind: 'int', min: 1, key: 'maxTasks' },
  'max-retries': { kind: 'int', min: 0, key: 'maxRetries' },
  'max-iterations': { kind: 'int', min: 1, key: 'maxIterations' },
};

const SHORT_FLAGS: Record<string, FlagKey> = {
  '-v': 'version',
  '-h': 'help',
};

/** 类型安全的标志赋值：用泛型把联合键收敛为单一键，避免联合键写入报错 */
function setFlag<K extends FlagKey>(flags: ParsedArgs['flags'], key: K, value: ParsedArgs['flags'][K]): void {
  flags[key] = value;
}

function applyFlag(flags: ParsedArgs['flags'], name: string, inline: string | undefined, consume: () => string | undefined): void {
  const spec = FLAG_SPECS[name];
  if (!spec) return;
  if (spec.kind === 'bool') {
    setFlag(flags, spec.key, true);
  } else if (spec.kind === 'str') {
    setFlag(flags, spec.key, (inline ?? consume()) || undefined);
  } else {
    const raw = inline ?? consume();
    const n = Number(raw);
    if (raw !== undefined && Number.isFinite(n) && n >= spec.min) setFlag(flags, spec.key, Math.floor(n));
  }
}

function buildSweCommand(flags: ParsedArgs['flags'], rest: string[]): ManagementCommand {
  return {
    kind: 'swe',
    goal: rest.join(' ') || 'auto-improve',
    repo: flags.repo,
    maxTasks: flags.maxTasks ?? 8,
    maxRetries: flags.maxRetries ?? 2,
    maxIterations: flags.maxIterations ?? 6,
    verifyOnly: !!flags.verifyOnly,
    planOnly: !!flags.planOnly,
  };
}

type ManageCtx = { flags: ParsedArgs['flags']; rest: string[] };
type ManageBuilder = (ctx: ManageCtx) => ManagementCommand;

/** 管理命令分发表：head -> 构造对应 ManagementCommand，表驱动替代长 if 链 */
const MANAGE_BUILDERS: Record<string, ManageBuilder> = {
  sessions: () => ({ kind: 'sessions' }),
  resume: ({ rest }) => ({ kind: 'resume', id: rest[0] ?? '' }),
  diff: ({ rest }) => ({ kind: 'diff', id: rest[0] }),
  rollback: ({ flags, rest }) => ({ kind: 'rollback', id: rest[0] ?? '', yes: !!flags.yes }),
  whoami: () => ({ kind: 'whoami' }),
  policy: () => ({ kind: 'policy' }),
  tenants: () => ({ kind: 'tenants' }),
  serve: ({ flags }) => ({ kind: 'serve', port: flags.port }),
  audit: ({ flags, rest }) => ({ kind: 'audit', verify: rest[0] === 'verify', limit: flags.limit ?? 20 }),
  'model-stats': () => ({ kind: 'model-stats' }),
  experiences: ({ rest }) => ({ kind: 'experiences', path: rest[0] }),
  'code-write': ({ rest }) => ({ kind: 'code-write', goal: rest.join(' ') || 'auto-generate', filePath: 'output.ts' }),
  'quality-gate': ({ rest }) => ({ kind: 'quality-gate', path: rest[0] || '.' }),
  'self-improve': () => ({ kind: 'self-improve' }),
  swe: ({ flags, rest }) => buildSweCommand(flags, rest),
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: ParsedArgs['flags'] = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-') && !arg.startsWith('--')) {
      const key = SHORT_FLAGS[arg];
      if (key) setFlag(flags, key, true);
      else positional.push(arg);
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
      if (FLAG_SPECS[name]) {
        applyFlag(flags, name, inline, () => argv[++i]);
        continue;
      }
    }
    positional.push(arg);
  }

  const head = positional[0];
  const rest = positional.slice(1);

  // 管理命令分发表驱动（M3/M4/M6/M8/M9）
  const buildManage = MANAGE_BUILDERS[head];
  if (buildManage) return { flags, manage: buildManage({ flags, rest }) };

  // 斜杠技能
  if (head?.startsWith('/')) {
    const [kind, ...parts] = head.slice(1).split(/\s+/);
    const valid = ['plan', 'grill', 'goal'] as const;
    if (valid.includes(kind as (typeof valid)[number])) {
      return { flags, skill: { kind: kind as SkillCommand, arg: [...parts, ...rest].join(' ').trim() } };
    }
  }

  // 单命令需求
  if (head) return { flags, command: positional.join(' ') };
  return { flags };
}

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
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
 *  - /self-heal <错误> 系统化自我修复错误诊断（只读）
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
import type { ComputeTier } from '../shared/types';
import { normalizeTier } from '../models/tier';

export type SkillCommand = 'plan' | 'grill' | 'goal' | 'self-heal';

export type ManagementCommand =
  | { kind: 'sessions' }
  | { kind: 'resume'; id: string }
  | { kind: 'diff'; id?: string }
  | { kind: 'rollback'; id: string; yes: boolean }
  | { kind: 'whoami' }
  | { kind: 'policy' }
  | { kind: 'audit'; verify: boolean; limit: number }
  | { kind: 'tenants' }
  | { kind: 'doctor' }
  | { kind: 'tui' }
  | { kind: 'plugin'; action: 'install' | 'list'; source?: string }
  | { kind: 'skill-market'; action: 'search' | 'install' | 'list'; query?: string; market?: string }
  | { kind: 'skill-new'; name: string; template?: string; global?: boolean }
  | { kind: 'review'; path: string; json: boolean }
  | { kind: 'team'; goal: string }
  | { kind: 'serve'; port?: number }
  | { kind: 'computer'; action: string; args: string[] }
  | { kind: 'bridge'; action: string; args: string[] }
  | { kind: 'license'; action: string; args: string[] }
  | { kind: 'model-stats' }
  | { kind: 'experiences'; path?: string }
  | { kind: 'code-write'; goal: string; filePath: string }
  | { kind: 'quality-gate'; path: string }
  | { kind: 'self-improve' }
  | { kind: 'self-evolve'; action: string; args: string[] }
  | { kind: 'harness'; split: string; limit: number; offset: number; mode: 'mock' | 'real'; verifier?: 'file' | 'test'; testCommand?: string; report?: string; json: boolean }
  | {
      kind: 'swe';
      goal: string;
      repo?: string;
      maxTasks: number;
      maxRetries: number;
      maxIterations: number;
      verifyOnly: boolean;
      planOnly: boolean;
    }
  | { kind: 'tier'; action: 'get' | 'set'; value?: ComputeTier }
  | { kind: 'agent-new'; name?: string; prompt?: string; tools?: string; category?: string; tier?: ComputeTier }
  | { kind: 'routine'; action: 'list' | 'add' | 'run' | 'enable' | 'rm'; id?: string; cron?: string; goal?: string; command?: string; name?: string; tier?: ComputeTier; workspaceDir?: string; enabled?: boolean }
  | { kind: 'memory'; action: 'profile' | 'stats' | 'clear'; yes: boolean }
  | { kind: 'approvals'; action: 'list' | 'show' | 'approve' | 'reject'; id?: string; all: boolean; by?: string };

export interface ParsedArgs {
  flags: {
    version?: boolean;
    help?: boolean;
    parallel?: boolean;
    yes?: boolean;
    all?: boolean;
    by?: string;
    stream?: boolean;
    limit?: number;
    port?: number;
    repo?: string;
    maxTasks?: number;
    maxRetries?: number;
    maxIterations?: number;
    verifyOnly?: boolean;
    planOnly?: boolean;
    json?: boolean;
    contextFile?: string;
    lang?: string;
    /** 指定模型（如 deepseek-ai/DeepSeek-V4-Flash），覆盖默认模型选择 */
    model?: string;
    /** -e 直接执行命令（不进入 Agent 编排） */
    exec?: string;
    /** harness 评测：数据集 split / 偏移 / 执行模式 / 报告输出路径 */
    split?: string;
    offset?: number;
    mode?: string;
    report?: string;
    /** P0-3: skill-new 脚手架参数 */
    template?: string;
    global?: boolean;
    /** P7-1: harness 验证器 file|test 与自定义测试命令 */
    verifier?: string;
    testCommand?: string;
    /** 算力档位（对标纳米Work 轻量/省钱/满血），覆盖自动分类 */
    tier?: ComputeTier;
    /** agent-new：专家名称 */
    name?: string;
    /** agent-new：专家系统提示 */
    prompt?: string;
    /** agent-new：专家工具集（逗号分隔） */
    tools?: string;
    /** agent-new：专家分类 */
    category?: string;
    /** routine：cron 表达式 */
    cron?: string;
    /** routine：AI 目标 */
    goal?: string;
    /** routine：shell 命令 */
    command?: string;
    /** routine：任务目录（goal/command 工作区） */
    workspaceDir?: string;
  };
  /** 单命令模式下的需求文本（首个非 flag 参数） */
  command?: string;
  /** 斜杠技能命令：/plan /grill /goal /self-heal */
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
  all: { kind: 'bool', key: 'all' },
  by: { kind: 'str', key: 'by' },
  stream: { kind: 'bool', key: 'stream' },
  'verify-only': { kind: 'bool', key: 'verifyOnly' },
  'plan-only': { kind: 'bool', key: 'planOnly' },
  json: { kind: 'bool', key: 'json' },
  port: { kind: 'int', min: 1, key: 'port' },
  limit: { kind: 'int', min: 1, key: 'limit' },
  repo: { kind: 'str', key: 'repo' },
  lang: { kind: 'str', key: 'lang' },
  'context-file': { kind: 'str', key: 'contextFile' },
  model: { kind: 'str', key: 'model' },
  'max-tasks': { kind: 'int', min: 1, key: 'maxTasks' },
  'max-retries': { kind: 'int', min: 0, key: 'maxRetries' },
  'max-iterations': { kind: 'int', min: 1, key: 'maxIterations' },
  split: { kind: 'str', key: 'split' },
  offset: { kind: 'int', min: 0, key: 'offset' },
  mode: { kind: 'str', key: 'mode' },
  report: { kind: 'str', key: 'report' },
  tier: { kind: 'str', key: 'tier' },
  name: { kind: 'str', key: 'name' },
  prompt: { kind: 'str', key: 'prompt' },
  tools: { kind: 'str', key: 'tools' },
  category: { kind: 'str', key: 'category' },
  cron: { kind: 'str', key: 'cron' },
  goal: { kind: 'str', key: 'goal' },
  command: { kind: 'str', key: 'command' },
  'workspace-dir': { kind: 'str', key: 'workspaceDir' },
};

const SHORT_FLAGS: Record<string, FlagKey> = {
  '-v': 'version',
  '-h': 'help',
  '-e': 'exec',
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
    maxIterations: flags.maxIterations ?? 15,
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
  doctor: () => ({ kind: 'doctor' }),
  tui: () => ({ kind: 'tui' }),
  plugin: ({ rest }) => ({
    kind: 'plugin',
    action: rest[0] === 'install' ? 'install' : 'list',
    source: rest[0] === 'install' ? rest[1] : undefined,
  }),
  'skill-market': ({ flags, rest }) => ({
    kind: 'skill-market',
    action: rest[0] === 'search' || rest[0] === 'install' ? rest[0] : 'list',
    query: rest[1],
    market: flags.repo, // 复用 --repo 承载市场源地址
  }),
  'skill-new': ({ flags, rest }) => ({
    kind: 'skill-new',
    name: rest[0] ?? '',
    template: flags.template,
    global: !!flags.global,
  }),
  review: ({ flags, rest }) => ({ kind: 'review', path: rest[0] || '.', json: !!flags.json }),
  team: ({ rest }) => ({ kind: 'team', goal: rest.join(' ') || '协作开发' }),
  serve: ({ flags }) => ({ kind: 'serve', port: flags.port }),
  computer: ({ rest }) => ({ kind: 'computer', action: rest[0] ?? 'status', args: rest.slice(1) }),
  bridge: ({ rest }) => ({ kind: 'bridge', action: rest[0] ?? 'status', args: rest.slice(1) }),
  license: ({ rest }) => ({ kind: 'license', action: rest[0] ?? 'show', args: rest.slice(1) }),
  audit: ({ flags, rest }) => ({ kind: 'audit', verify: rest[0] === 'verify', limit: flags.limit ?? 20 }),
  'model-stats': () => ({ kind: 'model-stats' }),
  experiences: ({ rest }) => ({ kind: 'experiences', path: rest[0] }),
  'code-write': ({ rest }) => ({ kind: 'code-write', goal: rest.join(' ') || 'auto-generate', filePath: 'output.ts' }),
  'quality-gate': ({ rest }) => ({ kind: 'quality-gate', path: rest[0] || '.' }),
  'self-improve': () => ({ kind: 'self-improve' }),
  'self-evolve': ({ rest }) => ({
    kind: 'self-evolve',
    action: rest[0] ?? 'status',
    args: rest.slice(1),
  }),
  harness: ({ flags, rest }) => ({
    kind: 'harness',
    split: flags.split ?? rest[0] ?? 'lite',
    limit: flags.limit ?? 5,
    offset: flags.offset ?? 0,
    mode: flags.mode === 'real' ? 'real' : 'mock',
    verifier: flags.verifier === 'test' ? 'test' : 'file',
    testCommand: flags.testCommand,
    report: flags.report,
    json: !!flags.json,
  }),
  swe: ({ flags, rest }) => buildSweCommand(flags, rest),
  tier: ({ rest }) => ({ kind: 'tier', action: rest[0] === 'set' ? 'set' : 'get', value: normalizeTier(rest[1]) }),
  'agent-new': ({ flags, rest }) => ({
    kind: 'agent-new',
    name: flags.name || rest[0],
    prompt: flags.prompt,
    tools: flags.tools,
    category: flags.category,
    tier: flags.tier,
  }),
  routine: ({ flags, rest }) => ({
    kind: 'routine',
    action: (rest[0] as 'list' | 'add' | 'run' | 'enable' | 'rm') ?? 'list',
    id: rest[1] || flags.name,
    cron: flags.cron,
    goal: flags.goal,
    command: flags.command,
    name: flags.name,
    tier: flags.tier,
    workspaceDir: flags.workspaceDir,
    // enable 子命令：rest[1] 为 on/off；其余子命令不存在该语义则视为 true
    enabled: rest[0] === 'enable' ? rest[1] !== 'off' : undefined,
  }),
  memory: ({ flags, rest }) => ({
    kind: 'memory',
    action: (rest[0] as 'profile' | 'stats' | 'clear') ?? 'profile',
    yes: !!flags.yes,
  }),
  approvals: ({ flags, rest }) => ({
    kind: 'approvals',
    action: (rest[0] as 'list' | 'show' | 'approve' | 'reject') ?? 'list',
    id: rest[1],
    all: !!flags.all,
    by: flags.by,
  }),
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
    const valid = ['plan', 'grill', 'goal', 'self-heal'] as const;
    if (valid.includes(kind as (typeof valid)[number])) {
      return { flags, skill: { kind: kind as SkillCommand, arg: [...parts, ...rest].join(' ').trim() } };
    }
  }

  // 单命令需求
  if (head) return { flags, command: positional.join(' ') };
  return { flags };
}

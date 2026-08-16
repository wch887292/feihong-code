/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M4 权限：RBAC + 策略引擎。
 *
 * 判定顺序（deny 优先，永远不可被角色权限反超）：
 *   1) 危险 shell 命令黑名单        → deny
 *   2) 敏感路径黑名单（读/写皆拦）  → deny
 *   3) 越界路径（逃出工作区）       → deny
 *   4) 角色-工具矩阵                → deny / approval / allow
 *   5) shell 白名单                 → allow（否则 approval）
 *
 * 策略来源（后者覆盖前者）：
 *   DEFAULT_POLICY → <FH_HOME>/policy.json → <租户目录>/policy.json → FH_POLICY 内联 JSON
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { logger } from '../shared/logger';
import { ROLES, type Role } from './tenant';
import { t } from '../shared/i18n';

export type Effect = 'allow' | 'deny' | 'approval';

export interface RolePolicy {
  /** 允许直接执行的工具（支持 "*"） */
  allowTools: string[];
  /** 需人工审批的工具 */
  approvalTools: string[];
  /** 单次任务成本上限（USD），0 表示不限 */
  maxCostUsd: number;
}

export interface Policy {
  version: 1;
  roles: Record<Role, RolePolicy>;
  /** 危险 shell 命令片段（大小写不敏感，子串/词首匹配），命中即 deny */
  denyShell: string[];
  /** 敏感路径片段，命中即 deny（防密钥/凭据外泄与 .git 破坏） */
  denyPaths: string[];
  /** 租户每日成本上限（USD），0 表示不限 */
  tenantDailyBudgetUsd: number;
}

export const DEFAULT_POLICY: Policy = {
  version: 1,
  roles: {
    viewer: {
      allowTools: ['read_file', 'list_dir', 'grep'],
      approvalTools: [],
      maxCostUsd: 0.1,
    },
    developer: {
      allowTools: [
        'read_file',
        'list_dir',
        'grep',
        'write_file',
        'edit_file',
        'run_tests',
        'build_check',
      ],
      approvalTools: ['run_shell'],
      maxCostUsd: 1,
    },
    operator: {
      allowTools: ['*'],
      approvalTools: ['run_shell'],
      maxCostUsd: 5,
    },
    admin: {
      allowTools: ['*'],
      approvalTools: ['run_shell'],
      maxCostUsd: 0,
    },
  },
  denyShell: [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf *',
    'mkfs',
    'dd if=',
    ':(){',
    'shutdown',
    'reboot',
    'halt',
    'format ',
    'del /s',
    'rd /s',
    'chmod 777 /',
    'chown -R root',
    'curl | sh',
    'curl|sh',
    'wget | sh',
    'wget|sh',
    'iptables -F',
    'net user',
    'reg delete',
    'history -c',
    'shred ',
  ],
  denyPaths: [
    '.env',
    '.git/config',
    '.git/hooks',
    '.npmrc',
    '.ssh',
    'id_rsa',
    'id_ed25519',
    'credentials',
    '.aws',
    '.kube/config',
    'shadow',
  ],
  tenantDailyBudgetUsd: 0,
};

export interface PolicyDecision {
  effect: Effect;
  /** 人类可读理由，会写入审计日志 */
  reason: string;
  /** 命中的规则标识，便于统计与排障 */
  rule: string;
}

export interface EvalInput {
  role: Role;
  tool: string;
  args: Record<string, unknown>;
  cwd: string;
  /** 运行时 shell 白名单（FH_SHELL_ALLOW） */
  shellAllowlist: string[];
}

/** 深合并：仅覆盖用户显式提供的键，避免局部配置抹掉默认安全基线 */
function mergePolicy(base: Policy, patch: Partial<Policy> | null): Policy {
  if (!patch) return base;
  const roles = { ...base.roles };
  for (const r of ROLES) {
    const p = patch.roles?.[r];
    if (p) roles[r] = { ...base.roles[r], ...p };
  }
  return {
    version: 1,
    roles,
    // 黑名单永远是"并集"：租户策略只能加严，不能放松
    denyShell: [...new Set([...base.denyShell, ...(patch.denyShell ?? [])])],
    denyPaths: [...new Set([...base.denyPaths, ...(patch.denyPaths ?? [])])],
    tenantDailyBudgetUsd: patch.tenantDailyBudgetUsd ?? base.tenantDailyBudgetUsd,
  };
}

function readPolicyFile(file: string): Partial<Policy> | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<Policy>;
  } catch (e) {
    logger.warn('策略文件解析失败，已忽略', {
      file,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** 加载生效策略（默认 → 全局 policy.json → 租户 policy.json → FH_POLICY） */
export function loadPolicy(baseHome: string, tenantRoot?: string): Policy {
  let policy = DEFAULT_POLICY;
  policy = mergePolicy(policy, readPolicyFile(join(baseHome, 'policy.json')));
  if (tenantRoot) policy = mergePolicy(policy, readPolicyFile(join(tenantRoot, 'policy.json')));
  const inline = process.env.FH_POLICY?.trim();
  if (inline) {
    try {
      policy = mergePolicy(policy, JSON.parse(inline) as Partial<Policy>);
    } catch {
      logger.warn('FH_POLICY 不是合法 JSON，已忽略');
    }
  }
  return policy;
}

/** 从工具入参中提取涉及的路径（read/write/edit/list/grep 统一用 path/dir/file 字段） */
function extractPaths(args: Record<string, unknown>): string[] {
  const keys = ['path', 'file', 'dir', 'target', 'from', 'to'];
  const out: string[] = [];
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  return out;
}

function normalizeForMatch(s: string): string {
  return s.replace(/\\/g, '/').toLowerCase();
}

/** 路径是否逃出工作区（沙箱二次校验，与 safe-path 互为纵深防御） */
function escapesWorkspace(cwd: string, p: string): boolean {
  const abs = resolve(cwd, p);
  const root = resolve(cwd);
  return abs !== root && !abs.startsWith(root + sep);
}

/** 策略判定核心 */
export function evaluate(policy: Policy, input: EvalInput): PolicyDecision {
  const { role, tool, args, cwd, shellAllowlist } = input;
  const rolePolicy = policy.roles[role];

  // 1) 危险 shell 命令：无条件拒绝，admin 也不例外
  if (tool === 'run_shell') {
    const cmd = String(args.command ?? args.cmd ?? '');
    const flat = normalizeForMatch(cmd).replace(/\s+/g, ' ');
    for (const bad of policy.denyShell) {
      if (flat.includes(normalizeForMatch(bad).replace(/\s+/g, ' '))) {
        return {
          effect: 'deny',
          reason: `命中危险命令黑名单: ${bad}`,
          rule: 'denyShell',
        };
      }
    }
  }

  // 2) 敏感路径 + 3) 越界路径
  for (const p of extractPaths(args)) {
    const np = normalizeForMatch(p);
    for (const bad of policy.denyPaths) {
      const nb = normalizeForMatch(bad);
      if (np === nb || np.endsWith('/' + nb) || np.includes(nb + '/') || np.includes('/' + nb)) {
        return { effect: 'deny', reason: `命中敏感路径黑名单: ${bad}`, rule: 'denyPaths' };
      }
    }
    if (escapesWorkspace(cwd, p)) {
      return { effect: 'deny', reason: `路径越出工作区: ${p}`, rule: 'sandbox' };
    }
  }

  // 4) 角色-工具矩阵
  const allowed = rolePolicy.allowTools.includes('*') || rolePolicy.allowTools.includes(tool);
  const needsApproval = rolePolicy.approvalTools.includes(tool);

  if (!allowed && !needsApproval) {
    return {
      effect: 'deny',
      reason: `角色 ${role} 无权调用工具 ${tool}`,
      rule: 'rbac',
    };
  }

  // 5) shell 白名单可免审批
  if (tool === 'run_shell' && needsApproval) {
    const cmd = String(args.command ?? args.cmd ?? '');
    const head = cmd.trim().split(/\s+/)[0] || '';
    if (shellAllowlist.includes(head)) {
      return { effect: 'allow', reason: `命中 shell 白名单: ${head}`, rule: 'shellAllowlist' };
    }
    return { effect: 'approval', reason: `工具 ${tool} 需人工审批`, rule: 'rbac.approval' };
  }

  if (needsApproval && !allowed) {
    return { effect: 'approval', reason: `工具 ${tool} 需人工审批`, rule: 'rbac.approval' };
  }

  return { effect: 'allow', reason: `角色 ${role} 允许调用 ${tool}`, rule: 'rbac.allow' };
}

/** 渲染策略摘要（fhcode policy） */
export function renderPolicy(policy: Policy, role: Role): string {
  const rp = policy.roles[role];
  const lines = [
    t('policy.version', { v: policy.version }),
    t('policy.role', { v: role }),
    t('policy.allow', { v: rp.allowTools.join(', ') }),
    t('policy.approval', { v: rp.approvalTools.join(', ') || t('enterprise.none') }),
    t('policy.taskCap', { v: rp.maxCostUsd > 0 ? `$${rp.maxCostUsd}` : t('enterprise.unlimited') }),
    t('policy.tenantCap', { v: policy.tenantDailyBudgetUsd > 0 ? `$${policy.tenantDailyBudgetUsd}` : t('enterprise.unlimited') }),
    t('policy.denyShell', {
      n: policy.denyShell.length,
      v: policy.denyShell.slice(0, 8).join(' | ') + (policy.denyShell.length > 8 ? ' ...' : ''),
    }),
    t('policy.denyPaths', {
      n: policy.denyPaths.length,
      v: policy.denyPaths.slice(0, 8).join(' | ') + (policy.denyPaths.length > 8 ? ' ...' : ''),
    }),
    '',
    t('policy.matrixTitle'),
    ...ROLES.map(
      (r) =>
        t('policy.matrixRow', {
          role: r.padEnd(10),
          allow: policy.roles[r].allowTools.join(','),
          approval: policy.roles[r].approvalTools.join(',') || '-',
          max: policy.roles[r].maxCostUsd || '∞',
        }),
    ),
  ];
  return lines.join('\n');
}

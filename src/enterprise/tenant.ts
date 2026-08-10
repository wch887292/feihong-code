/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M4 多租户：身份解析与数据隔离。
 *
 * 隔离模型（物理目录隔离，最简单也最难出错）：
 *   <FH_HOME>/tenants/<tenantId>/sessions/   会话检查点与事件日志
 *   <FH_HOME>/tenants/<tenantId>/audit/      审计链
 *   <FH_HOME>/tenants/<tenantId>/goals/      /goal 产物
 *   <FH_HOME>/tenants/<tenantId>/policy.json 租户级策略覆盖（可选）
 *
 * 身份来自环境变量（便于容器 / CI / 网关注入）：
 *   FH_TENANT  租户 ID（缺省 default）
 *   FH_USER    用户标识（缺省 系统用户名）
 *   FH_ROLE    角色（viewer|developer|operator|admin，缺省 developer）
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { userInfo } from 'os';
import { resolveHomeDir } from '../shared/config';
import { AppError } from '../shared/errors';

export const ROLES = ['viewer', 'developer', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: Role;
  /** 租户隔离根目录 */
  root: string;
  sessionDir: string;
  auditDir: string;
  goalDir: string;
}

/** 租户 / 用户 ID 合法性：仅字母数字与 - _ .，防止 ../ 路径穿越 */
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function assertValidId(kind: string, id: string): void {
  if (!ID_RE.test(id)) {
    throw new AppError(
      `${kind} 非法: "${id}"（仅允许字母数字与 . _ -，长度 1-64）`,
      'TENANT_ID_INVALID',
      400,
    );
  }
}

function normalizeRole(raw: string | undefined): Role {
  const r = (raw || '').trim().toLowerCase();
  if ((ROLES as readonly string[]).includes(r)) return r as Role;
  if (r) {
    throw new AppError(
      `FH_ROLE 非法: "${raw}"（可选值: ${ROLES.join(' | ')}）`,
      'ROLE_INVALID',
      400,
    );
  }
  return 'developer';
}

/**
 * 解析当前租户上下文。
 *
 * 兼容性：默认租户（default）且尚未创建 tenants/default 目录、但存在旧版
 * <FH_HOME>/sessions 时，继续沿用旧目录，避免升级后历史会话"消失"。
 */
export function resolveTenantContext(baseHome = resolveHomeDir()): TenantContext {
  const tenantId = (process.env.FH_TENANT || 'default').trim();
  assertValidId('FH_TENANT', tenantId);

  let userId = (process.env.FH_USER || '').trim();
  if (!userId) {
    try {
      userId = userInfo().username || 'unknown';
    } catch {
      userId = 'unknown';
    }
  }
  userId = userId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'unknown';

  const role = normalizeRole(process.env.FH_ROLE);
  const root = join(baseHome, 'tenants', tenantId);

  const legacySessions = join(baseHome, 'sessions');
  const useLegacy = tenantId === 'default' && !existsSync(root) && existsSync(legacySessions);

  return {
    tenantId,
    userId,
    role,
    root,
    sessionDir: useLegacy ? legacySessions : join(root, 'sessions'),
    auditDir: join(root, 'audit'),
    goalDir: useLegacy ? join(baseHome, 'goals') : join(root, 'goals'),
  };
}

export interface TenantUsage {
  tenantId: string;
  sessions: number;
  costUsd: number;
  lastActiveAt: string;
  auditRecords: number;
}

/** 扫描 <FH_HOME>/tenants 汇总各租户用量（用于 fhcode tenants） */
export function listTenants(baseHome = resolveHomeDir()): TenantUsage[] {
  const dir = join(baseHome, 'tenants');
  if (!existsSync(dir)) return [];
  const out: TenantUsage[] = [];
  for (const name of readdirSync(dir)) {
    const root = join(dir, name);
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({
      tenantId: name,
      ...summarizeSessions(join(root, 'sessions')),
      auditRecords: countAuditLines(join(root, 'audit')),
    });
  }
  return out.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

function summarizeSessions(sessionDir: string): {
  sessions: number;
  costUsd: number;
  lastActiveAt: string;
} {
  if (!existsSync(sessionDir)) return { sessions: 0, costUsd: 0, lastActiveAt: '-' };
  let sessions = 0;
  let costUsd = 0;
  let lastActiveAt = '-';
  // 避免为汇总而反序列化整份对话：仅正则提取所需字段
  for (const f of readdirSync(sessionDir)) {
    if (!f.endsWith('.session.json')) continue;
    sessions++;
    try {
      const text = readTextSafe(join(sessionDir, f));
      costUsd += Number(/"costUsd":\s*([0-9.eE+-]+)/.exec(text)?.[1] ?? 0);
      const at = /"updatedAt":\s*"([^"]+)"/.exec(text)?.[1] ?? '';
      if (at > lastActiveAt) lastActiveAt = at;
    } catch {
      /* 跳过损坏文件 */
    }
  }
  return { sessions, costUsd, lastActiveAt };
}

function countAuditLines(auditDir: string): number {
  if (!existsSync(auditDir)) return 0;
  let n = 0;
  for (const f of readdirSync(auditDir)) {
    if (!f.endsWith('.jsonl')) continue;
    n += readTextSafe(join(auditDir, f)).split('\n').filter(Boolean).length;
  }
  return n;
}

function readTextSafe(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

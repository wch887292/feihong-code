/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 手机号账号体系（v8.11 账号升级）：
 *  - 手机号即账号：首次登录自动注册，默认密码 = 手机号后 4 位，可修改
 *  - 密码以 scrypt 哈希存储（防离线爆破），不落明文
 *  - 每手机号数据全隔离：账号目录 <FH_HOME>/accounts/<phone>/
 *    内含凭据（.credentials.json）、记忆（honcho/feihong.db）、会话/审计/goals（tenants/）
 *  - 激活账号：<FH_HOME>/active-account.json；运行期所有数据路径经 resolveAccountHome() 落进账号目录
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { resolveHomeDir } from '../shared/config';
import { AppError } from '../shared/errors';

export const ACCOUNTS_DIR = 'accounts';
export const ACTIVE_ACCOUNT_FILE = 'active-account.json';

/** 手机号合法性：6-20 位数字，允许 + 前缀 */
const PHONE_RE = /^\+?[0-9]{6,20}$/;

export function isValidPhone(p: string): boolean {
  return PHONE_RE.test(p.trim());
}

/** 账号目录名（手机号本身，纯数字安全；+ 号在目录名中合法） */
export function accountDirName(phone: string): string {
  return phone.trim();
}

/** 账号目录：<FH_HOME>/accounts/<phone> */
export function accountHome(phone: string, baseHome = resolveHomeDir()): string {
  return join(baseHome, ACCOUNTS_DIR, accountDirName(phone));
}

/** 账号注册表根目录 */
export function accountsRoot(baseHome = resolveHomeDir()): string {
  return join(baseHome, ACCOUNTS_DIR);
}

/** 账号元数据文件 */
function accountMetaFile(phone: string, baseHome = resolveHomeDir()): string {
  return join(accountHome(phone, baseHome), 'account.json');
}

export interface AccountMeta {
  phone: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
}

/** 密码哈希（scrypt，N=16384；返回 base64） */
export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): { hash: string; salt: string } {
  const hash = scryptSync(password, salt, 64).toString('base64');
  return { hash, salt };
}

/** 校验密码 */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'base64');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** 首次登录默认密码 = 手机号后 4 位 */
export function defaultPassword(phone: string): string {
  return phone.trim().slice(-4);
}

/** 账号是否存在 */
export function accountExists(phone: string, baseHome = resolveHomeDir()): boolean {
  return existsSync(accountMetaFile(phone, baseHome));
}

/** 注册账号（首次登录）；默认密码 = 手机号后 4 位 */
export function registerAccount(phone: string, baseHome = resolveHomeDir()): AccountMeta {
  const valid = phone.trim();
  if (!isValidPhone(valid)) {
    throw new AppError(`手机号非法: ${valid}（需 6-20 位数字）`, 'PHONE_INVALID', 400);
  }
  if (accountExists(valid, baseHome)) {
    throw new AppError(`账号已存在: ${valid}（请直接登录）`, 'ACCOUNT_EXISTS', 409);
  }
  const dir = accountHome(valid, baseHome);
  mkdirSync(dir, { recursive: true });
  const { hash, salt } = hashPassword(defaultPassword(valid));
  const now = new Date().toISOString();
  const meta: AccountMeta = {
    phone: valid,
    passwordHash: hash,
    salt,
    createdAt: now,
    updatedAt: now,
  };
  writeFileSync(accountMetaFile(valid, baseHome), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return meta;
}

/** 读取账号元数据（不存在返回 null） */
export function loadAccountMeta(phone: string, baseHome = resolveHomeDir()): AccountMeta | null {
  const file = accountMetaFile(phone, baseHome);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as AccountMeta;
    if (typeof raw.phone !== 'string' || typeof raw.passwordHash !== 'string' || typeof raw.salt !== 'string') return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * 登录校验：账号不存在 → 自动注册（首次登录，返回 isFirstLogin=true，默认密码=后 4 位）；
 * 账号存在 → 校验密码，失败抛 ACCOUNT_PASSWORD_MISMATCH。
 */
export function loginAccount(phone: string, password: string, baseHome = resolveHomeDir()): { phone: string; isFirstLogin: boolean } {
  const valid = phone.trim();
  if (!isValidPhone(valid)) {
    throw new AppError(`手机号非法: ${valid}（需 6-20 位数字）`, 'PHONE_INVALID', 400);
  }
  const meta = loadAccountMeta(valid, baseHome);
  if (!meta) {
    registerAccount(valid, baseHome);
    return { phone: valid, isFirstLogin: true };
  }
  if (!verifyPassword(password, meta.passwordHash, meta.salt)) {
    throw new AppError('密码错误（首次登录默认密码为手机号后 4 位）', 'ACCOUNT_PASSWORD_MISMATCH', 401);
  }
  return { phone: valid, isFirstLogin: false };
}

/** 修改密码（旧密码校验；返回是否成功） */
export function changePassword(phone: string, oldPassword: string, newPassword: string, baseHome = resolveHomeDir()): boolean {
  const meta = loadAccountMeta(phone, baseHome);
  if (!meta) throw new AppError(`账号不存在: ${phone}`, 'ACCOUNT_NOT_FOUND', 404);
  if (!verifyPassword(oldPassword, meta.passwordHash, meta.salt)) {
    throw new AppError('旧密码错误', 'ACCOUNT_PASSWORD_MISMATCH', 401);
  }
  if (typeof newPassword !== 'string' || newPassword.length < 4) {
    throw new AppError('新密码至少 4 位', 'PASSWORD_TOO_SHORT', 400);
  }
  const { hash, salt } = hashPassword(newPassword);
  meta.passwordHash = hash;
  meta.salt = salt;
  meta.updatedAt = new Date().toISOString();
  writeFileSync(accountMetaFile(phone, baseHome), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  return true;
}

/** 列出全部已注册账号（仅手机号与创建时间，绝不暴露哈希） */
export function listAccounts(baseHome = resolveHomeDir()): Array<{ phone: string; createdAt: string }> {
  const root = accountsRoot(baseHome);
  if (!existsSync(root)) return [];
  const out: Array<{ phone: string; createdAt: string }> = [];
  for (const name of readdirSync(root)) {
    const meta = loadAccountMeta(name, baseHome);
    if (meta) out.push({ phone: meta.phone, createdAt: meta.createdAt });
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 删除账号（破坏性，需显式确认；同时清空该账号全部数据目录） */
export function removeAccount(phone: string, baseHome = resolveHomeDir()): boolean {
  const dir = accountHome(phone, baseHome);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  // 若删除的是当前激活账号，同时清除激活状态
  if (getActiveAccount(baseHome) === phone.trim()) clearActiveAccount(baseHome);
  return true;
}

/* ========== 激活账号 ========== */

function activeFile(baseHome = resolveHomeDir()): string {
  return join(baseHome, ACTIVE_ACCOUNT_FILE);
}

/** 读取当前激活账号（无返回 null） */
export function getActiveAccount(baseHome = resolveHomeDir()): string | null {
  const file = activeFile(baseHome);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { phone?: string };
    return typeof raw.phone === 'string' && raw.phone ? raw.phone : null;
  } catch {
    return null;
  }
}

/** 激活账号（写入 active-account.json，原子写） */
export function setActiveAccount(phone: string, baseHome = resolveHomeDir()): void {
  const valid = phone.trim();
  if (!accountExists(valid, baseHome)) {
    throw new AppError(`账号不存在: ${valid}（请先登录注册）`, 'ACCOUNT_NOT_FOUND', 404);
  }
  mkdirSync(baseHome, { recursive: true });
  const file = activeFile(baseHome);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ phone: valid, activatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  writeFileSync(file, JSON.stringify({ phone: valid, activatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  rmSync(tmp, { force: true });
}

/** 清除激活账号（登出） */
export function clearActiveAccount(baseHome = resolveHomeDir()): void {
  rmSync(activeFile(baseHome), { force: true });
}

/**
 * 解析账号化主目录：存在激活账号 → <FH_HOME>/accounts/<phone>；否则 → FH_HOME。
 * 所有数据路径（凭据/记忆/会话/审计/goals）经此隔离；全局配置（fhcode.config.json）仍读 FH_HOME 根。
 */
export function resolveAccountHome(baseHome = resolveHomeDir()): string {
  const active = getActiveAccount(baseHome);
  if (!active) return baseHome;
  return accountHome(active, baseHome);
}

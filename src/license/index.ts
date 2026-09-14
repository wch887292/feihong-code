/**
 * fhcode 商业授权模块（闭源收费核心）
 *
 * 授权模型：
 *  - 激活码（License Key）：由开发商持有主密钥生成，格式 FH-XXXX-XXXX-XXXX-XXXX
 *  - 激活码绑定：可指定到期时间（天数）与授权类型（standard / pro / enterprise）
 *  - 首次激活：输入激活码 → 校验签名 → 写入 FH_HOME/license.json（含设备指纹）
 *  - 离线校验：每次启动读取本地 license.json，校验签名 + 到期时间 + 设备指纹
 *  - 试用期：未激活时默认 60 天试用（以首次运行时间起算）
 *
 * 安全说明：
 *  - 主密钥 FH_LICENSE_SECRET（环境变量或 license-secret 文件），部署在服务端/开发商侧
 *  - 客户端只保存激活码与设备指纹，不保存主密钥
 *  - 设备指纹 = SHA256(hostname + mac + os 平台)
 */

import { createHmac, createHash, randomBytes } from 'crypto';
import { homedir, hostname, networkInterfaces, platform } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

export type LicenseType = 'standard' | 'pro' | 'enterprise';

export interface LicenseRecord {
  key: string;
  type: LicenseType;
  issuedTo: string;
  issuedAt: string;
  expiresAt: string; // ISO；永久授权为空串
  deviceFingerprint: string;
  seats: number; // 授权设备数
}

export interface LicenseState {
  activated: boolean;
  trial: boolean;
  trialDaysLeft: number;
  type?: LicenseType;
  issuedTo?: string;
  expiresAt?: string;
  seats?: number;
  daysLeft?: number; // 剩余授权天数（永久授权为 -1）
  deviceFingerprint?: string;
  error?: string;
}

const TRIAL_DAYS = 60;

function homeDir(): string {
  return process.env.FH_HOME?.trim() || join(homedir(), '.feihong-code');
}

function licenseFile(): string {
  return join(homeDir(), 'license.json');
}

function secret(): string {
  // 优先级：环境变量 > license-secret 文件 > 内置占位（生产必须配置环境变量）
  if (process.env.FH_LICENSE_SECRET?.trim()) return process.env.FH_LICENSE_SECRET.trim();
  const secretFile = join(homeDir(), 'license-secret');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf-8').trim();
  return 'fhcode-dev-secret-do-not-use-in-production';
}

/** 设备指纹：主机名 + 所有网卡 MAC + 平台 */
export function deviceFingerprint(): string {
  const macs: string[] = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.mac && info.mac !== '00:00:00:00:00:00') macs.push(info.mac);
    }
  }
  macs.sort();
  const raw = `${hostname()}|${macs.join(',')}|${platform()}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

/** 生成激活码（开发商侧） */
export function generateLicenseKey(opts: {
  type: LicenseType;
  issuedTo: string;
  days?: number; // 到期天数；不传 = 永久
  seats?: number;
  secret?: string;
}): string {
  const days = opts.days ?? 0;
  const seats = opts.seats ?? 1;
  const payload = [
    opts.type,
    opts.issuedTo.replace(/[|]/g, ''),
    String(days),
    String(seats),
    randomBytes(3).toString('hex'),
  ].join('|');
  const sig = createHmac('sha256', opts.secret || secret())
    .update(payload)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  const body = Buffer.from(payload, 'utf-8').toString('base64url');
  return `FH-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}-${sig}`;
}

interface ParsedKey {
  type: LicenseType;
  issuedTo: string;
  days: number;
  seats: number;
  sig: string;
  ok: boolean;
  reason?: string;
}

/** 解析 + 校验激活码签名 */
export function parseLicenseKey(key: string, secretOverride?: string): ParsedKey {
  const k = String(key || '').trim();
  if (!/^FH-[A-Za-z0-9_-]{4}-[A-Za-z0-9_-]{4}-[A-Za-z0-9_-]{4}-[A-Za-z0-9_-]{4}-[A-F0-9]{12}$/.test(k)) {
    return { type: 'standard', issuedTo: '', days: 0, seats: 1, sig: '', ok: false, reason: '激活码格式不正确' };
  }
  const [, b0, b1, b2, b3, sig] = k.split('-');
  const body = `${b0}${b1}${b2}${b3}`;
  const payload = Buffer.from(body, 'base64url').toString('utf-8');
  const parts = payload.split('|');
  if (parts.length !== 5) return { type: 'standard', issuedTo: '', days: 0, seats: 1, sig: '', ok: false, reason: '激活码内容损坏' };
  const [type, issuedTo, daysStr, seatsStr] = parts;
  const expectSig = createHmac('sha256', secretOverride || secret())
    .update(payload)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  if (expectSig !== sig) return { type: 'standard', issuedTo: '', days: 0, seats: 1, sig: '', ok: false, reason: '激活码签名无效' };
  return {
    type: (['standard', 'pro', 'enterprise'].includes(type) ? type : 'standard') as LicenseType,
    issuedTo,
    days: parseInt(daysStr, 10) || 0,
    seats: parseInt(seatsStr, 10) || 1,
    sig,
    ok: true,
  };
}

/** 激活：校验激活码 → 写入 license.json */
export function activateLicense(key: string): { ok: boolean; state?: LicenseState; error?: string } {
  const parsed = parseLicenseKey(key);
  if (!parsed.ok) return { ok: false, error: parsed.reason };
  const now = Date.now();
  const expiresAt = parsed.days > 0 ? new Date(now + parsed.days * 86400_000).toISOString() : '';
  const rec: LicenseRecord = {
    key,
    type: parsed.type,
    issuedTo: parsed.issuedTo,
    issuedAt: new Date(now).toISOString(),
    expiresAt,
    deviceFingerprint: deviceFingerprint(),
    seats: parsed.seats,
  };
  try {
    mkdirSync(homeDir(), { recursive: true });
    writeFileSync(licenseFile(), JSON.stringify(rec, null, 2), 'utf-8');
    return { ok: true, state: licenseState() };
  } catch (e) {
    return { ok: false, error: '写入授权文件失败: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** 读取当前授权状态（含试用期计算） */
export function licenseState(): LicenseState {
  try {
    if (!existsSync(licenseFile())) {
      return trialState();
    }
    const rec = JSON.parse(readFileSync(licenseFile(), 'utf-8')) as LicenseRecord;
    // 设备指纹校验：换机后授权失效
    if (rec.deviceFingerprint && rec.deviceFingerprint !== deviceFingerprint()) {
      return { activated: false, trial: false, trialDaysLeft: 0, error: '授权与当前设备不匹配，请重新激活' };
    }
    // 签名复验（防止篡改 license.json）
    const parsed = parseLicenseKey(rec.key);
    if (!parsed.ok) {
      return { activated: false, trial: false, trialDaysLeft: 0, error: '授权文件被篡改' };
    }
    const now = Date.now();
    if (rec.expiresAt) {
      const left = Math.ceil((new Date(rec.expiresAt).getTime() - now) / 86400_000);
      if (left <= 0) return { activated: false, trial: false, trialDaysLeft: 0, error: '授权已过期' };
      return { activated: true, trial: false, trialDaysLeft: 0, type: rec.type, issuedTo: rec.issuedTo, expiresAt: rec.expiresAt, seats: rec.seats, daysLeft: left, deviceFingerprint: rec.deviceFingerprint };
    }
    return { activated: true, trial: false, trialDaysLeft: 0, type: rec.type, issuedTo: rec.issuedTo, seats: rec.seats, daysLeft: -1, deviceFingerprint: rec.deviceFingerprint };
  } catch (e) {
    return { activated: false, trial: false, trialDaysLeft: 0, error: '授权文件读取失败' };
  }
}

/** 试用状态：以 .trial-started 文件首次时间起算 7 天 */
function trialState(): LicenseState {
  const marker = join(homeDir(), '.trial-started');
  let start = 0;
  try {
    if (existsSync(marker)) start = parseInt(readFileSync(marker, 'utf-8').trim(), 10) || 0;
    else {
      start = Date.now();
      mkdirSync(homeDir(), { recursive: true });
      writeFileSync(marker, String(start), 'utf-8');
    }
  } catch (e) {
    start = Date.now();
  }
  const left = TRIAL_DAYS - Math.floor((Date.now() - start) / 86400_000);
  return {
    activated: false,
    trial: true,
    trialDaysLeft: Math.max(0, left),
    error: left <= 0 ? '试用已结束，请购买授权码激活' : undefined,
  };
}

/** 获取授权到期文案（用于 UI 展示） */
export function licenseText(state: LicenseState): string {
  if (state.activated) {
    const typeName = { standard: '标准版', pro: '专业版', enterprise: '企业版' }[state.type || 'standard'];
    const expire = state.daysLeft === -1 ? '永久授权' : `剩余 ${state.daysLeft} 天`;
    return `${typeName} · 授权给 ${state.issuedTo} · ${expire} · ${state.seats} 台设备`;
  }
  if (state.trial) return `未激活 · 试用期剩余 ${state.trialDaysLeft} 天`;
  return `未授权：${state.error || '请激活'}`;
}

/** 服务端鉴权门：未激活且试用过期时返回 true（表示需拦截） */
export function licenseBlocked(): boolean {
  const s = licenseState();
  return !s.activated && (!s.trial || s.trialDaysLeft <= 0);
}

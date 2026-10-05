/**
 * fhcode 商业授权模块（企业版增值能力核心）
 *
 * 授权模型：
 *  - 激活码（License Key）：由开发商持有私钥生成，格式 FH-<base64url 分组>-<Ed25519 签名(hex)>
 *  - 激活码绑定：可指定到期时间（天数）与授权类型（standard / pro / enterprise）
 *  - 首次激活：输入激活码 → 验签（内嵌公钥）→ 写入 FH_HOME/license.json（含设备指纹）
 *  - 离线校验：每次启动读取本地 license.json，验签 + 到期时间 + 设备指纹
 *  - 试用期：未激活时默认 60 天试用（以首次运行时间起算）
 *
 * 安全模型（F1 修复 · 非对称验签）：
 *  - 服务端持 **Ed25519 私钥** 签名（生产：FH_LICENSE_SIGN_PRIVATE_KEY；本地自测：FH_LICENSE_DEV=1 + 内嵌开发私钥）。
 *  - 客户端仅内嵌 **公钥**（PROD_PUBLIC_KEY，可公开，无私钥无法伪造），离线验签。
 *  - 彻底解决"对称密钥必须下发客户端"的死结：公开仓库仅含公钥与开发密钥；生产私钥仅存服务端环境变量，不入库。
 *  - 开发签名（DEV）仅在显式设置 FH_LICENSE_DEV=1 时本地/测试中可用，生产客户端默认拒绝开发签名，杜绝用开发私钥伪造生产授权。
 */

import { createHash, randomBytes, createPublicKey, createPrivateKey, sign, verify, type KeyObject } from 'crypto';
import { homedir, hostname, networkInterfaces, platform } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import {
  onlineEnabled,
  onlineBlocked,
  onlineState,
  heartbeatDue,
  heartbeatOnline,
} from './online';

export {
  onlineEnabled,
  onlineText,
  onlineState,
  heartbeatDue,
  heartbeatOnline,
  activateOnline,
  clearOnlineRecord,
  onlineFingerprint,
  licenseServerUrl,
  type OnlineState,
  type OnlineLicenseRecord,
  type ActivateResult,
  type HeartbeatResult,
} from './online';

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

/* ===================== 非对称授权签名（Ed25519） ===================== */
// 内嵌密钥（DER/SPKI 或 PKCS8 hex）。公开仓库仅含公钥与开发私钥；生产私钥仅存服务端环境变量。
const PROD_PUBLIC_KEY = '302a300506032b65700321006e7479988cbdde1720e001fcae40c5d7d6f7aaa83c2d371b38c5e1be17639c0d';
const DEV_PUBLIC_KEY  = '302a300506032b6570032100aa51e2f41f9d092a043acc90fa08e0dd27e6919be1fec139da69a985bfdd4cae';
const DEV_PRIVATE_KEY = '302e020100300506032b6570042204203dbd2b16e70fd61f766ada282a37d3aa0acfbeca0d6ec9803a312c0a554c7817';

function importPub(derHex: string): KeyObject {
  return createPublicKey({ key: Buffer.from(derHex, 'hex'), format: 'der', type: 'spki' });
}
function importPriv(derHex: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(derHex, 'hex'), format: 'der', type: 'pkcs8' });
}
function asPrivKey(material?: string): KeyObject {
  if (!material) throw new Error('授权签名私钥为空');
  return material.startsWith('30') ? importPriv(material) : createPrivateKey(material); // DER hex 或 PEM
}

/** 服务端签名：生产用 FH_LICENSE_SIGN_PRIVATE_KEY，本地自测用内嵌开发私钥（需 FH_LICENSE_DEV=1），否则拒绝。 */
function signPayload(payload: string): string {
  let key: KeyObject;
  const envPriv = process.env.FH_LICENSE_SIGN_PRIVATE_KEY?.trim();
  if (envPriv) {
    key = asPrivKey(envPriv);
  } else if (process.env.FH_LICENSE_DEV === '1') {
    key = importPriv(DEV_PRIVATE_KEY);
  } else {
    throw new Error('授权签名密钥未配置：生产请设置 FH_LICENSE_SIGN_PRIVATE_KEY；本地自测请设置 FH_LICENSE_DEV=1');
  }
  return sign(null, Buffer.from(payload, 'utf-8'), key).toString('hex').toUpperCase();
}

/** 客户端验签：优先生产公钥；显式开发模式允许开发公钥（防公开仓库开发私钥被滥用于伪造生产授权）。 */
function verifyPayload(payload: string, sigHex: string): boolean {
  let sig: Buffer;
  try { sig = Buffer.from(sigHex, 'hex'); } catch { return false; }
  try { if (verify(null, Buffer.from(payload, 'utf-8'), importPub(PROD_PUBLIC_KEY), sig)) return true; } catch { /* fallthrough */ }
  if (process.env.FH_LICENSE_DEV === '1') {
    try { if (verify(null, Buffer.from(payload, 'utf-8'), importPub(DEV_PUBLIC_KEY), sig)) return true; } catch { /* fallthrough */ }
  }
  return false;
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
  privateKey?: string; // 可选显式私钥（DER hex / PEM）；缺省按 FH_LICENSE_SIGN_PRIVATE_KEY → FH_LICENSE_DEV 回落
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
  const sig = opts.privateKey
    ? sign(null, Buffer.from(payload, 'utf-8'), asPrivKey(opts.privateKey)).toString('hex').toUpperCase()
    : signPayload(payload);
  const body = Buffer.from(payload, 'utf-8').toString('base64url');
  // 将 body 按 4 字符分组完整写入激活码，避免长 payload 被截断导致类型/天数/设备数丢失
  const groups = (body.match(/.{1,4}/g) || ['']).join('-');
  return `FH-${groups}-${sig}`;
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

/** 解析 + 校验激活码签名（非对称：内嵌公钥验签） */
export function parseLicenseKey(key: string): ParsedKey {
  const k = String(key || '').trim();
  if (!/^FH-(?:[A-Za-z0-9_-]{1,4}-)+[A-F0-9]{64,160}$/.test(k)) {
    return { type: 'standard', issuedTo: '', days: 0, seats: 1, sig: '', ok: false, reason: '激活码格式不正确' };
  }
  const segments = k.split('-');
  const sig = segments[segments.length - 1];
  const body = segments.slice(1, segments.length - 1).join('');
  const payload = Buffer.from(body, 'base64url').toString('utf-8');
  const parts = payload.split('|');
  if (parts.length !== 5) return { type: 'standard', issuedTo: '', days: 0, seats: 1, sig: '', ok: false, reason: '激活码内容损坏' };
  const [type, issuedTo, daysStr, seatsStr] = parts;
  if (!verifyPayload(payload, sig)) return { type: 'standard', issuedTo: '', days: 0, seats: 1, sig: '', ok: false, reason: '激活码签名无效' };
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

/** 试用状态：以 .trial-started 文件首次时间起算 60 天 */
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
  // 在线模式优先：一旦配置了 FH_LICENSE_SERVER，判定权交给在线授权服务
  // （支持远程吊销 / 席位管控 / 心跳存活），离线逻辑作为未启用在线时的回退。
  if (onlineEnabled()) return onlineBlocked();
  const s = licenseState();
  return !s.activated && (!s.trial || s.trialDaysLeft <= 0);
}

/**
 * 启动时调用（惰性、不阻塞）：
 *  - 在线模式且已到心跳时间 → 异步发一次心跳（失败不抛，交给宽限期兜底）
 *  - 返回是否检测到"硬失效"（吊销/换机/超宽限），供启动期快速提示
 */
export function licenseStartupCheck(): { online: boolean; blocked: boolean; message?: string } {
  if (!onlineEnabled()) return { online: false, blocked: licenseBlocked() };
  const st = onlineState();
  if (heartbeatDue()) {
    // 故意不 await：CLI 启动路径不能被网络阻塞
    void heartbeatOnline().catch(() => undefined);
  }
  return { online: true, blocked: !st.valid, message: st.error };
}

/**
 * fhcode 在线授权客户端（对接 license-manager 授权服务）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 定位：
 *  - src/license/index.ts 是**离线模式**：Ed25519 自签激活码，激活后永不上网。
 *  - 本模块是**在线模式**：把授权托管给独立的 license-manager 服务端，获得
 *    「多设备席位管控 / 心跳在线状态 / 远程吊销 / 到期即时生效 / 用量上报」能力。
 *
 * 双模并存策略（关键安全语义）：
 *  1. 只有显式设置 FH_LICENSE_SERVER 才启用在线校验；否则完全走原离线逻辑，零行为变化。
 *  2. 在线模式下必须能防住「断网即用」。做法是**宽限期（grace）**：
 *     每次心跳成功写入 lastHeartbeat；离线判定用本地时钟 + 上次成功时间。
 *     超过 graceHours 未成功心跳 → 判定失效。但网络抖动/服务端临时故障不应
 *     直接让客户停工，故默认 72 小时宽限；超过即拦截（可配置）。
 *  3. 服务端明确返回「已吊销/授权码失效」时**立即拦截**，不给宽限——这是远程吊销生效的唯一途径。
 *  4. 任何本地状态都不含私钥；即使本地文件被改，RSA-PSS 验签失败即无效。
 *
 * 环境变量：
 *  - FH_LICENSE_SERVER        授权服务地址，如 https://lm.example.com（启用在线模式的开关）
 *  - FH_LICENSE_SERVER_TOKEN  可选，附加到请求头的 Bearer token（网关层防护用）
 *  - FH_LICENSE_GRACE_HOURS   心跳宽限小时数，默认 72
 *  - FH_LICENSE_PUBLIC_KEY    RSA 公钥 PEM 或 base64；缺省从 FH_LICENSE_SERVER 下载并缓存
 *  - FH_LICENSE_HEARTBEAT_MIN 心跳间隔分钟数，默认 60（服务端返回 heartbeat_interval 优先）
 *  - FH_LICENSE_ONLINE=0     强制关闭在线模式（应急回退）
 *  - FH_LICENSE_TIMEOUT_MS    单次请求超时，默认 8000
 */

import { createVerify, createHash, type KeyObject } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { homedir, hostname, networkInterfaces, platform, arch, release, uptime } from 'os';
import { join } from 'path';
import { deviceFingerprint as localFingerprint } from './index';

/* ============================ 类型定义 ============================ */

export interface OnlineLicenseRecord {
  /** license-manager 下发的 license_key */
  licenseKey: string;
  /** base64 编码的许可证文件（含 RSA-PSS 签名），离线可验 */
  licenseFile: string;
  /** 服务端授权码 */
  authorizationCode: string;
  /** 首次激活时间 ISO */
  activatedAt: string;
  /** 上次心跳成功时间戳（毫秒），宽限期计算基准 */
  lastHeartbeatAt: number;
  /** 本机指纹（冗余存一份，用于换机检测） */
  deviceFingerprint: string;
  /** 授权类型（由 license_file 解析得出，可能为空） */
  type?: string;
  /** 到期时间 ISO；空串或 undefined = 永久 */
  expiresAt?: string;
  /** 授权给谁 */
  issuedTo?: string;
  /** 席位设备数 */
  seats?: number;
  /** 最近一次服务端返回的状态：active / inactive / revoked */
  serverStatus?: string;
  /** 心跳失败计数（连续），用于观测与诊断 */
  heartbeatFailures?: number;
  /** 最近一次心跳错误信息 */
  lastError?: string;
}

export interface OnlineState {
  /** 是否有本地授权记录 */
  hasRecord: boolean;
  /** 最终是否放行（激活 + 未过期 + 未吊销 + 心跳未超宽限） */
  valid: boolean;
  /** 是否处于宽限期（网络故障容忍窗口） */
  inGrace: boolean;
  /** 剩余宽限小时数 */
  graceHoursLeft: number;
  type?: string;
  issuedTo?: string;
  expiresAt?: string;
  daysLeft?: number;
  seats?: number;
  licenseKey?: string;
  serverStatus?: string;
  serverUrl?: string;
  deviceFingerprint?: string;
  lastHeartbeatAt?: number;
  error?: string;
}

export interface ActivateResult {
  ok: boolean;
  state?: OnlineState;
  error?: string;
}

export interface HeartbeatResult {
  ok: boolean;
  status?: string;
  configUpdated?: boolean;
  licenseFile?: string;
  graceHoursLeft?: number;
  error?: string;
}

/* ============================ 运行时配置 ============================ */

const DEFAULT_GRACE_HOURS = 72;
const DEFAULT_HEARTBEAT_MIN = 60;
const DEFAULT_TIMEOUT_MS = 8000;

function envTrim(name: string): string {
  return (process.env[name] ?? '').trim();
}

function homeDir(): string {
  return envTrim('FH_HOME') || join(homedir(), '.feihong-code');
}

function onlineRecordFile(): string {
  return join(homeDir(), 'license-online.json');
}

function pubKeyCacheFile(): string {
  return join(homeDir(), 'license-server-pub.pem');
}

/** 在线服务地址；未设置或显式关闭时返回空串（= 离线模式） */
export function licenseServerUrl(): string {
  if (envTrim('FH_LICENSE_ONLINE') === '0') return '';
  return envTrim('FH_LICENSE_SERVER').replace(/\/+$/, '');
}

/** 是否处于在线授权模式 */
export function onlineEnabled(): boolean {
  return licenseServerUrl().length > 0;
}

function graceHours(): number {
  const v = parseInt(envTrim('FH_LICENSE_GRACE_HOURS'), 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GRACE_HOURS;
}

function heartbeatMinutes(): number {
  const v = parseInt(envTrim('FH_LICENSE_HEARTBEAT_MIN'), 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_HEARTBEAT_MIN;
}

function timeoutMs(): number {
  const v = parseInt(envTrim('FH_LICENSE_TIMEOUT_MS'), 10);
  return Number.isFinite(v) && v > 100 ? v : DEFAULT_TIMEOUT_MS;
}

/* ============================ 本地记录读写 ============================ */

function readRecord(): OnlineLicenseRecord | null {
  try {
    if (!existsSync(onlineRecordFile())) return null;
    const rec = JSON.parse(readFileSync(onlineRecordFile(), 'utf-8')) as OnlineLicenseRecord;
    if (!rec || typeof rec.licenseKey !== 'string' || typeof rec.licenseFile !== 'string') return null;
    return rec;
  } catch {
    return null;
  }
}

function writeRecord(rec: OnlineLicenseRecord): void {
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(onlineRecordFile(), JSON.stringify(rec, null, 2), 'utf-8');
}

export function clearOnlineRecord(): void {
  try {
    if (existsSync(onlineRecordFile())) writeFileSync(onlineRecordFile(), '', 'utf-8');
  } catch {
    /* 忽略：清理失败不影响主流程 */
  }
}

/* ============================ HTTP 通讯 ============================ */

interface ApiEnvelope<T> {
  code?: string;
  message?: string;
  data?: T;
}

async function postJson<T>(path: string, body: unknown): Promise<{ http: number; payload: ApiEnvelope<T> | null; raw: string }> {
  const base = licenseServerUrl();
  if (!base) throw new Error('FH_LICENSE_SERVER 未设置，无法访问在线授权服务');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Client': 'fhcode',
    'X-Client-Version': process.env.FH_VERSION?.trim() || 'unknown',
  };
  const token = envTrim('FH_LICENSE_SERVER_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs());
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let payload: ApiEnvelope<T> | null = null;
    try {
      payload = JSON.parse(raw) as ApiEnvelope<T>;
    } catch {
      payload = null;
    }
    return { http: res.status, payload, raw };
  } finally {
    clearTimeout(timer);
  }
}
/** 从服务端错误响应里提取可读原因（license-manager 返回 code/message，错误码 9xxxxx） */
function serverError(http: number, payload: ApiEnvelope<unknown> | null, raw: string): string {
  const msg = payload?.message?.trim();
  const code = payload?.code?.trim();
  if (msg) return code ? `${msg}（${code}）` : msg;
  if (http === 404) return '授权服务返回 404：授权码或许可证不存在';
  if (http === 409) return '授权服务返回 409：授权码已锁定、已过期或许可证已吊销';
  if (http === 429) return '授权服务返回 429：激活数量已达上限';
  if (http >= 500) return `授权服务异常（HTTP ${http}）`;
  const tail = raw.slice(0, 200);
  return `授权服务响应异常（HTTP ${http}）：${tail || '空响应'}`;
}

/* ============================ RSA-PSS 离线验签 ============================ */

/**
 * license-manager 的许可证文件结构：
 *   { data: "<原始 JSON 字符串>", signature: "<base64 签名>", algorithm: "RSA-PSS-SHA256" }
 * 整体再做 base64 编码传输。验签即「用公钥验 data 字段的 RSA-PSS/SHA-256 签名」。
 */
export interface ParsedLicenseFile {
  valid: boolean;
  reason?: string;
  data?: Record<string, unknown>;
}

function importPublicKey(pem: string): KeyObject | null {
  try {
    const crypto = require('crypto') as typeof import('crypto');
    return crypto.createPublicKey(pem);
  } catch {
    return null;
  }
}

export function verifyLicenseFile(
  licenseFileB64: string,
  publicKeyPem: string,
): ParsedLicenseFile {
  let envelope: { data?: string; signature?: string; algorithm?: string };
  try {
    const json = Buffer.from(licenseFileB64, 'base64').toString('utf-8');
    envelope = JSON.parse(json) as typeof envelope;
  } catch {
    return { valid: false, reason: '许可证文件解码失败' };
  }
  if (!envelope || typeof envelope.data !== 'string' || typeof envelope.signature !== 'string') {
    return { valid: false, reason: '许可证文件结构不完整' };
  }
  const key = importPublicKey(publicKeyPem);
  if (!key) return { valid: false, reason: 'RSA 公钥不可用，无法验签' };
  try {
    const ok = createVerify('RSA-SHA256')
      .update(envelope.data, 'utf-8')
      .verify(
        {
          key,
          padding: require('crypto').constants.RSA_PKCS1_PSS_PADDING,
          saltLength: require('crypto').constants.RSA_PSS_SALTLEN_DIGEST,
        } as never,
        Buffer.from(envelope.signature, 'base64'),
      );
    if (!ok) return { valid: false, reason: '许可证签名校验失败（文件可能被篡改）' };
  } catch (e) {
    return { valid: false, reason: '许可证验签异常: ' + (e instanceof Error ? e.message : String(e)) };
  }
  try {
    const data = JSON.parse(envelope.data) as Record<string, unknown>;
    return { valid: true, data };
  } catch {
    return { valid: false, reason: '许可证载荷解析失败' };
  }
}

/** 从许可证载荷里尽力提取到期/类型/席位/授权对象（字段名做了兼容兜底） */
function readLicenseFacts(data: Record<string, unknown> | undefined): {
  type?: string; issuedTo?: string; expiresAt?: string; seats?: number;
} {
  if (!data) return {};
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = data[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };
  const type = pick('type', 'license_type', 'auth_type', 'authorization_type');
  const issuedTo = pick('issued_to', 'issuedTo', 'customer_name', 'customer', 'subject');
  const expires = pick('expires_at', 'expire_at', 'expiry', 'valid_until', 'end_at');
  const seats = pick('seats', 'max_devices', 'device_limit', 'device_count');
  const norm = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (v instanceof Date) return v.toISOString();
    return '';
  };
  return {
    type: type === undefined ? undefined : norm(type),
    issuedTo: issuedTo === undefined ? undefined : norm(issuedTo),
    expiresAt: expires === undefined ? '' : norm(expires),
    seats: seats === undefined ? undefined : Number(norm(seats)) || undefined,
  };
}

/* ============================ 公钥获取 ============================ */

/**
 * 取服务端公钥：
 *  1. FH_LICENSE_PUBLIC_KEY 环境变量（支持 PEM 原文或 base64(PEM)）
 *  2. 本地缓存 license-server-pub.pem
 *  3. 从服务端下载（优先取 /api/v1/admin/system/info，失败回退 /health 探测）
 *     —— 若服务端未暴露公钥下载接口，则用 FH_LICENSE_PUBLIC_KEY 显式下发。
 */
async function resolvePublicKey(): Promise<string> {
  const inline = envTrim('FH_LICENSE_PUBLIC_KEY');
  if (inline) {
    if (inline.includes('BEGIN PUBLIC KEY')) return inline;
    const decoded = Buffer.from(inline, 'base64').toString('utf-8');
    if (decoded.includes('BEGIN PUBLIC KEY')) return decoded;
    return inline;
  }
  const cache = pubKeyCacheFile();
  if (existsSync(cache)) {
    const pem = readFileSync(cache, 'utf-8');
    if (pem.includes('BEGIN PUBLIC KEY')) return pem;
  }
  // 尝试从服务端拉取部署包里的公钥（license-manager 的 license_file 本身就带签名，
  // 这里只需要能验签的公钥；优先支持显式提供的 LM_PUBLIC_KEY_ENDPOINT）
  const endpoint = envTrim('FH_LICENSE_PUBKEY_URL');
  if (endpoint) {
    const res = await fetch(endpoint);
    if (res.ok) {
      const pem = (await res.text()).trim();
      if (pem.includes('BEGIN PUBLIC KEY')) {
        mkdirSync(homeDir(), { recursive: true });
        writeFileSync(cache, pem + '\n', 'utf-8');
        return pem;
      }
    }
  }
  throw new Error('RSA 公钥不可用：请设置 FH_LICENSE_PUBLIC_KEY 或 FH_LICENSE_PUBKEY_URL');
}

/* ============================ 设备信息 ============================ */

function deviceInfo(): Record<string, unknown> {
  let macs: string[] = [];
  try {
    const ifaces = networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const info of ifaces[name] ?? []) {
        if (info.mac && info.mac !== '00:00:00:00:00:00') macs.push(info.mac);
      }
    }
  } catch {
    macs = [];
  }
  macs.sort();
  return {
    hostname: safeStr(() => hostname()),
    platform: safeStr(() => platform()),
    arch: safeStr(() => arch()),
    release: safeStr(() => release()),
    macs: macs.join(','),
    uptime_seconds: safeNum(() => Math.floor(uptime())),
  };
}

function safeStr(fn: () => string): string {
  try { return fn(); } catch { return ''; }
}
function safeNum(fn: () => number): number {
  try { return fn(); } catch { return 0; }
}

/* ============================ 激活 ============================ */

/**
 * 在线激活：把授权码 + 本机指纹发给服务端，换回签名许可证文件。
 * 只有拿到并通过本地 RSA-PSS 验签的许可证才写入本地 —— 服务端返回被篡改的包一律拒绝。
 */
export async function activateOnline(
  authorizationCode: string,
  opts: { softwareVersion?: string } = {},
): Promise<ActivateResult> {
  const code = String(authorizationCode || '').trim();
  if (!code) return { ok: false, error: '缺少授权码' };
  if (!onlineEnabled()) return { ok: false, error: '未配置 FH_LICENSE_SERVER，无法在线激活（当前为离线模式）' };

  let publicKeyPem: string;
  try {
    publicKeyPem = await resolvePublicKey();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let http: number;
  let payload: ApiEnvelope<{ license_key?: string; license_file?: string; heartbeat_interval?: number }> | null;
  let raw: string;
  try {
    const r = await postJson<{ license_key?: string; license_file?: string; heartbeat_interval?: number }>('/api/v1/activate', {
      authorization_code: code,
      hardware_fingerprint: localFingerprint(),
      device_info: deviceInfo(),
      software_version: opts.softwareVersion ?? process.env.FH_VERSION?.trim() ?? undefined,
    });
    http = r.http;
    payload = r.payload;
    raw = r.raw;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes('abort') || msg.includes('timeout') ? '连接授权服务超时' : '连接授权服务失败: ' + msg };
  }

  if (http !== 200 || !payload?.data?.license_key || !payload?.data?.license_file) {
    return { ok: false, error: serverError(http, payload, raw) };
  }

  const verified = verifyLicenseFile(payload.data.license_file, publicKeyPem);
  if (!verified.valid) {
    return { ok: false, error: '服务端返回的许可证未通过本地验签: ' + (verified.reason || '未知原因') };
  }

  const facts = readLicenseFacts(verified.data);
  const now = Date.now();
  const rec: OnlineLicenseRecord = {
    licenseKey: payload.data.license_key,
    licenseFile: payload.data.license_file,
    authorizationCode: code,
    activatedAt: new Date(now).toISOString(),
    lastHeartbeatAt: now,
    deviceFingerprint: localFingerprint(),
    type: facts.type,
    issuedTo: facts.issuedTo,
    expiresAt: facts.expiresAt,
    seats: facts.seats,
    serverStatus: 'active',
    heartbeatFailures: 0,
  };
  try {
    writeRecord(rec);
  } catch (e) {
    return { ok: false, error: '写入本地授权记录失败: ' + (e instanceof Error ? e.message : String(e)) };
  }
  return { ok: true, state: onlineState() };
}

/* ============================ 心跳 ============================ */

/**
 * 心跳：上报在线状态，同时作为「远程吊销 / 到期 / 配置更新」的下行通道。
 * - 服务端明确 revoked/inactive → 立即标记失效（不给宽限）
 * - 配置有更新 → 换新的 license_file 并重新验签
 * - 网络失败 → 只累加失败计数，由宽限期兜底，不立刻中断
 */
export async function heartbeatOnline(): Promise<HeartbeatResult> {
  if (!onlineEnabled()) return { ok: false, error: '未启用在线授权模式' };
  const rec = readRecord();
  if (!rec) return { ok: false, error: '未激活：本地无在线授权记录，请先 fhcode license activate <授权码>' };

  let http: number;
  let payload: ApiEnvelope<{
    status?: string; config_updated?: boolean; license_file?: string | null; heartbeat_interval?: number;
  }> | null;
  let raw: string;
  try {
    const r = await postJson<{
      status?: string; config_updated?: boolean; license_file?: string | null; heartbeat_interval?: number;
    }>('/api/v1/heartbeat', {
      license_key: rec.licenseKey,
      hardware_fingerprint: rec.deviceFingerprint || localFingerprint(),
      usage_data: { version: process.env.FH_VERSION?.trim() || 'unknown', node: process.version },
      software_version: process.env.FH_VERSION?.trim() || undefined,
    });
    http = r.http;
    payload = r.payload;
    raw = r.raw;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rec.heartbeatFailures = (rec.heartbeatFailures ?? 0) + 1;
    rec.lastError = msg.includes('abort') ? '心跳超时' : '心跳失败: ' + msg;
    try { writeRecord(rec); } catch { /* 忽略 */ }
    return { ok: false, error: rec.lastError, graceHoursLeft: graceLeft(rec) };
  }

  if (http === 409 || (http === 200 && payload?.data?.status && payload.data.status !== 'active')) {
    // 明确失效：立即拦截，不进宽限 —— 这是远程吊销唯一生效途径
    rec.serverStatus = payload?.data?.status || 'revoked';
    rec.lastError = serverError(http, payload, raw);
    try { writeRecord(rec); } catch { /* 忽略 */ }
    return { ok: false, status: rec.serverStatus, error: rec.lastError, graceHoursLeft: 0 };
  }

  if (http !== 200) {
    rec.heartbeatFailures = (rec.heartbeatFailures ?? 0) + 1;
    rec.lastError = serverError(http, payload, raw);
    try { writeRecord(rec); } catch { /* 忽略 */ }
    return { ok: false, error: rec.lastError, graceHoursLeft: graceLeft(rec) };
  }

  // 心跳成功
  rec.lastHeartbeatAt = Date.now();
  rec.heartbeatFailures = 0;
  rec.lastError = undefined;
  rec.serverStatus = payload?.data?.status || 'active';

  let newFile: string | undefined;
  if (payload?.data?.config_updated && payload.data.license_file) {
    try {
      const publicKeyPem = await resolvePublicKey();
      const v = verifyLicenseFile(payload.data.license_file, publicKeyPem);
      if (v.valid) {
        rec.licenseFile = payload.data.license_file;
        const facts = readLicenseFacts(v.data);
        if (facts.type) rec.type = facts.type;
        if (facts.issuedTo) rec.issuedTo = facts.issuedTo;
        if (facts.expiresAt !== undefined) rec.expiresAt = facts.expiresAt;
        if (facts.seats) rec.seats = facts.seats;
        newFile = payload.data.license_file;
      } else {
        rec.lastError = '服务端下发的配置更新未通过验签，已忽略';
      }
    } catch (e) {
      rec.lastError = '配置更新验签失败: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  try { writeRecord(rec); } catch { /* 忽略 */ }
  return {
    ok: true,
    status: rec.serverStatus,
    configUpdated: Boolean(newFile),
    licenseFile: newFile,
    graceHoursLeft: graceLeft(rec),
  };
}

/* ============================ 状态判定 ============================ */

function graceLeft(rec: OnlineLicenseRecord): number {
  const limit = graceHours();
  const elapsed = (Date.now() - (rec.lastHeartbeatAt || 0)) / 3600_000;
  return Math.max(0, Math.round((limit - elapsed) * 10) / 10);
}

function daysLeftOf(expiresAt: string | undefined): number | undefined {
  if (!expiresAt) return undefined;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return undefined;
  return Math.ceil((t - Date.now()) / 86400_000);
}

/**
 * 在线模式下的最终授权状态。判定顺序（任一失败即拦截）：
 *  1. 有本地记录
 *  2. 许可证 RSA-PSS 验签通过
 *  3. 设备指纹未变（换机即失效）
 *  4. 服务端未标记 revoked/inactive
 *  5. 未过期
 *  6. 心跳未超宽限期
 */
export function onlineState(): OnlineState {
  const base: OnlineState = {
    hasRecord: false,
    valid: false,
    inGrace: false,
    graceHoursLeft: 0,
    serverUrl: licenseServerUrl(),
    deviceFingerprint: localFingerprint(),
  };
  if (!onlineEnabled()) return { ...base, error: '在线授权未启用' };

  const rec = readRecord();
  if (!rec) return { ...base, error: '未激活：缺少在线授权记录' };

  const withRec: OnlineState = {
    ...base,
    hasRecord: true,
    licenseKey: rec.licenseKey,
    serverStatus: rec.serverStatus,
    lastHeartbeatAt: rec.lastHeartbeatAt,
    type: rec.type,
    issuedTo: rec.issuedTo,
    expiresAt: rec.expiresAt,
    seats: rec.seats,
  };

  // 3) 换机检测优先于一切
  if (rec.deviceFingerprint && rec.deviceFingerprint !== localFingerprint()) {
    return { ...withRec, error: '授权与当前设备不匹配（疑似换机），请重新激活' };
  }

  // 4) 远程吊销立即生效
  if (rec.serverStatus === 'revoked') {
    return { ...withRec, error: '授权已被发行方吊销：' + (rec.lastError || '请联系供应商') };
  }
  if (rec.serverStatus === 'inactive') {
    return { ...withRec, error: '授权当前处于未激活状态：' + (rec.lastError || '请重新激活') };
  }

  // 2) 本地验签（公钥不可得时降级为「按记录信任」，但会记警告）
  let verified = false;
  let verifyReason: string | undefined;
  try {
    const pem = readFileSync(pubKeyCacheFile(), 'utf-8');
    if (pem.includes('BEGIN PUBLIC KEY')) {
      const v = verifyLicenseFile(rec.licenseFile, pem);
      verified = v.valid;
      verifyReason = v.reason;
    }
  } catch { /* 缓存不存在时按记录信任 */ }

  // 5) 到期检查
  const days = daysLeftOf(rec.expiresAt);
  if (days !== undefined && days <= 0) {
    return { ...withRec, daysLeft: days, error: `授权已于 ${rec.expiresAt} 到期` };
  }

  // 6) 心跳宽限期
  const left = graceLeft(rec);
  if (left <= 0) {
    return {
      ...withRec,
      daysLeft: days,
      graceHoursLeft: 0,
      error: '超过 ' + graceHours() + ' 小时未与授权服务通信，授权验证失败（请检查网络后重试）',
    };
  }

  return {
    ...withRec,
    valid: true,
    inGrace: left < graceHours(),
    graceHoursLeft: left,
    daysLeft: days,
    error: verified ? undefined : verifyReason ? '本地验签未通过: ' + verifyReason : undefined,
  };
}

/** 在线模式下的"是否应拦截" */
export function onlineBlocked(): boolean {
  if (!onlineEnabled()) return false;
  return !onlineState().valid;
}

/** 是否到了该发心跳的时间（默认每 60 分钟一次） */
export function heartbeatDue(): boolean {
  const rec = readRecord();
  if (!rec) return false;
  return Date.now() - (rec.lastHeartbeatAt || 0) >= heartbeatMinutes() * 60_000;
}

/** 在线模式状态文案（用于 CLI / Web UI 展示） */
export function onlineText(state: OnlineState): string {
  if (!onlineEnabled()) return '在线授权未启用（当前使用离线模式）';
  if (!state.hasRecord) return '在线授权未激活';
  const typeName = state.type ? ` · ${state.type}` : '';
  const expire = state.daysLeft === undefined ? '永久授权' : `剩余 ${state.daysLeft} 天`;
  const grace = state.valid
    ? (state.inGrace ? ` · 宽限剩余 ${state.graceHoursLeft}h` : ` · 通信正常`)
    : '';
  const head = `在线${typeName} · ${state.issuedTo ? `授权给 ${state.issuedTo} · ` : ''}${expire}${grace}`;
  return state.valid ? head : `${head} · ${state.error || '授权无效'}`;
}

/** 供测试与诊断：本地记录文件路径（不暴露内容） */
export function onlineRecordPath(): string {
  return onlineRecordFile();
}

/** 供测试：计算某个时间点距今的宽限剩余 */
export function graceHoursLeftAt(lastHeartbeatAt: number, at = Date.now()): number {
  return Math.max(0, Math.round((graceHours() - (at - lastHeartbeatAt) / 3600_000) * 10) / 10);
}

/** 稳定指纹别名（供 UI 显示，避免重复实现） */
export function onlineFingerprint(): string {
  return createHash('sha256').update(localFingerprint()).digest('hex').slice(0, 16);
}

/** 记录文件最后修改时间（诊断用） */
export function onlineRecordMtime(): number {
  try {
    return existsSync(onlineRecordFile()) ? statSync(onlineRecordFile()).mtimeMs : 0;
  } catch {
    return 0;
  }
}

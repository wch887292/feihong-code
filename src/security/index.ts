/**
 * fhcode 三层安全防护（防黑客攻击）
 *
 * 第一层 · 传输层（部署层）：
 *   - nginx HTTPS 强制跳转 + TLS1.2/1.3 + 强密码套件（见部署配置）
 *   - HSTS / CSP / X-Frame-Options 等安全响应头（由 server 中间件设置）
 *
 * 第二层 · 应用层（本模块）：
 *   - API 请求签名：HMAC-SHA256(body + timestamp + nonce)，时间窗 ±300s 防重放
 *   - 暴力破解防护：IP + 账号维度失败计数，超阈值锁定 15 分钟
 *   - License 激活门禁 + 设备指纹绑定（src/license）
 *
 * 第三层 · 数据层（本模块）：
 *   - 敏感数据落盘加密：AES-256-GCM，密钥来自 FH_DATA_KEY 或自动派生
 *   - 加密文件带随机 IV + AuthTag，防篡改
 */

import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/* ==================== 第二层：请求签名（API 防重放） ==================== */

export interface RequestSignature {
  timestamp: string; // 毫秒时间戳
  nonce: string;     // 随机串，防重放
  signature: string; // hex
}

const SIGNATURE_WINDOW_MS = 5 * 60 * 1000; // ±5 分钟

/** 服务端计算签名（用于验证） */
export function signRequest(secret: string, bodyRaw: string, timestamp: string, nonce: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}|${nonce}|${bodyRaw}`)
    .digest('hex');
}

/** 生成签名（客户端调用） */
export function createRequestSignature(secret: string, bodyRaw: string): RequestSignature {
  const timestamp = String(Date.now());
  const nonce = randomBytes(12).toString('hex');
  return { timestamp, nonce, signature: signRequest(secret, bodyRaw, timestamp, nonce) };
}

/**
 * 验证请求签名（Express 中间件工厂）
 * - 校验时间窗（防重放）
 * - 校验 nonce 是否已使用（防重放）
 * - 恒定时间比较签名（防时序攻击）
 */
export function verifyRequestSignature(secret: string, opts: { maxBodyBytes?: number } = {}) {
  const usedNonces = new Set<string>();
  const maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024;
  return function (req: any, res: any, next: any): void {
    // 仅对 /api/ 下的写请求启用签名校验（登录接口除外，走用户名密码）
    if (!req.path.startsWith('/api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      next();
      return;
    }
    if (req.path.startsWith('/api/auth/login') || req.path.startsWith('/api/wechat/') || req.path.startsWith('/api/yuanbao/')) {
      next();
      return;
    }
    const ts = req.get('x-fh-ts');
    const nonce = req.get('x-fh-nonce');
    const sig = req.get('x-fh-sig');
    if (!ts || !nonce || !sig) {
      res.status(401).json({ ok: false, error: '缺少请求签名头（x-fh-ts / x-fh-nonce / x-fh-sig）' });
      return;
    }
    // 时间窗
    const tsNum = parseInt(ts, 10);
    if (!tsNum || Math.abs(Date.now() - tsNum) > SIGNATURE_WINDOW_MS) {
      res.status(401).json({ ok: false, error: '请求时间戳超出允许窗口（±5 分钟），请校准设备时钟' });
      return;
    }
    // nonce 防重放
    if (usedNonces.has(nonce)) {
      res.status(401).json({ ok: false, error: '请求重放检测：nonce 已使用' });
      return;
    }
    usedNonces.add(nonce);
    if (usedNonces.size > 10000) usedNonces.clear(); // 防止 Set 无限膨胀
    // 签名校验：基于原始 body
    const bodyRaw = req.rawBody ?? JSON.stringify(req.body ?? {});
    if (Buffer.byteLength(bodyRaw, 'utf-8') > maxBodyBytes) {
      res.status(413).json({ ok: false, error: '请求体过大' });
      return;
    }
    const expect = signRequest(secret, bodyRaw, ts, nonce);
    const a = Buffer.from(expect, 'utf-8');
    const b = Buffer.from(sig, 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ ok: false, error: '请求签名校验失败（签名不匹配）' });
      return;
    }
    next();
  };
}

/* ==================== 第二层：暴力破解防护（登录/激活失败锁定） ==================== */

export interface RateLimitOptions {
  windowMs: number;   // 统计窗口
  maxAttempts: number; // 窗口内允许最大失败次数
  lockMs: number;      // 锁定时长
}

const DEFAULT_RATE_LIMIT: RateLimitOptions = { windowMs: 10 * 60 * 1000, maxAttempts: 5, lockMs: 15 * 60 * 1000 };

export class BruteForceGuard {
  private attempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
  constructor(private opts: RateLimitOptions = DEFAULT_RATE_LIMIT) {}

  /** 记录一次失败；返回 true 表示本次应拦截（达到阈值） */
  recordFailure(key: string): { blocked: boolean; lockedUntil: number } {
    const now = Date.now();
    const cur = this.attempts.get(key);
    if (cur && now < cur.lockedUntil) return { blocked: true, lockedUntil: cur.lockedUntil };
    if (!cur || now - cur.firstAt > this.opts.windowMs) {
      this.attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
      return { blocked: false, lockedUntil: 0 };
    }
    cur.count += 1;
    if (cur.count >= this.opts.maxAttempts) {
      cur.lockedUntil = now + this.opts.lockMs;
      cur.count = 0;
      return { blocked: true, lockedUntil: cur.lockedUntil };
    }
    return { blocked: false, lockedUntil: 0 };
  }

  /** 检查当前是否被锁定（不计数） */
  isLocked(key: string): boolean {
    const cur = this.attempts.get(key);
    return !!cur && Date.now() < cur.lockedUntil;
  }

  /** 成功后清除计数 */
  clear(key: string): void {
    this.attempts.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.attempts) {
      if (now - v.firstAt > this.opts.windowMs && now > v.lockedUntil) this.attempts.delete(k);
    }
  }
}

/* ==================== 第三层：敏感数据 AES-256-GCM 落盘加密 ==================== */

let warnedWeakDataKey = false;

function dataKey(): Buffer {
  // 优先 FH_DATA_KEY（32 字节 hex）；否则用 FH_LICENSE_SECRET 派生；再否则从内置种子派生（生产必须配置 FH_DATA_KEY）
  const env = process.env.FH_DATA_KEY?.trim();
  if (env) return Buffer.from(env, 'hex');
  const secret = process.env.FH_LICENSE_SECRET?.trim();
  if (!secret) {
    if (!warnedWeakDataKey) {
      warnedWeakDataKey = true;
      console.warn('[fhcode-security] 警告：未配置 FH_DATA_KEY / FH_LICENSE_SECRET，落盘加密使用内置派生种子，安全性受限。生产环境请配置 FH_DATA_KEY（32 字节 hex）。');
    }
    return createHmac('sha256', 'fhcode-data-key-v1').update('fhcode-local-derive-seed').digest();
  }
  return createHmac('sha256', 'fhcode-data-key-v1').update(secret).digest();
}

/** 加密并写入文件（覆盖写） */
export function encryptWriteFile(filePath: string, plaintext: string): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]); // 12 + 16 + data
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, payload, 'utf-8');
}

/** 读取并解密文件；文件不存在返回 null；解密失败抛错（防篡改） */
export function decryptReadFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const buf = readFileSync(filePath);
  if (buf.length < 28) throw new Error('加密文件损坏（长度不足）');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', dataKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf-8');
}

/** 便捷：加密写 JSON */
export function encryptWriteJson(filePath: string, data: unknown): void {
  encryptWriteFile(filePath, JSON.stringify(data));
}

/** 便捷：解密读 JSON */
export function decryptReadJson<T>(filePath: string): T | null {
  const text = decryptReadFile(filePath);
  if (text === null) return null;
  return JSON.parse(text) as T;
}

/* ==================== 第一层补充：安全响应头中间件 ==================== */

export function securityHeaders(_req: any, res: any, next: any): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: http:;");
  next();
}

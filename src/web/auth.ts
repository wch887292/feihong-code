/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M5 Web 控制台鉴权：Bearer Token 中间件（FH_WEB_TOKEN）。
 * - 主令牌（FH_WEB_TOKEN）适用于 CLI/自动化场景，无需登录。
 * - 手机号登录后生成独立会话令牌，支持多人/多设备本地会话隔离。
 * 无有效令牌一律 401（fail-closed），与 CLI 企业模式的安全基线一致。
 */
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

/** 计时安全的字符串比较，避免令牌逐字节泄露的计时攻击面 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 登录会话 */
export interface Session {
  phone: string;
  token: string;
  createdAt: string;
}

/** 会话默认有效期：30 天 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 会话落盘位置：$FH_HOME/web-sessions.json，缺省 ~/.feihong-code/web-sessions.json */
function defaultSessionFile(): string {
  const home = process.env.FH_HOME?.trim() || join(homedir(), '.feihong-code');
  return join(home, 'web-sessions.json');
}

/**
 * 会话存储（内存 + 落盘）。
 *
 * 为什么要落盘：此前会话仅存在进程内 Map，服务一旦重启（升级、崩溃恢复、
 * 改完前端重启）所有已登录令牌立即失效，前端轮询拿到 401 后会清 token 并
 * 弹回登录页——表现为「用着突然自己跳回登录界面」。落盘后重启可续用会话。
 *
 * 安全：文件以 0600 权限写入，仅当前用户可读；超过 TTL 的会话在加载与写入时清理。
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly file: string;
  private readonly ttlMs: number;

  constructor(opts?: { file?: string; ttlMs?: number }) {
    this.file = opts?.file ?? defaultSessionFile();
    this.ttlMs = opts?.ttlMs ?? SESSION_TTL_MS;
    this.load();
  }

  private isExpired(s: Session): boolean {
    const t = Date.parse(s.createdAt);
    if (!Number.isFinite(t)) return true;
    return Date.now() - t > this.ttlMs;
  }

  /** 从磁盘恢复会话；文件缺失或损坏时静默降级为空存储（fail-safe，不阻断启动） */
  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return;
      for (const item of raw) {
        const s = item as Session;
        if (!s || typeof s.token !== 'string' || typeof s.phone !== 'string') continue;
        if (this.isExpired(s)) continue;
        this.sessions.set(s.token, s);
      }
    } catch {
      /* 损坏的会话文件不应影响服务启动 */
    }
  }

  /** 写回磁盘，顺带剔除过期会话 */
  private persist(): void {
    try {
      for (const [token, s] of this.sessions) {
        if (this.isExpired(s)) this.sessions.delete(token);
      }
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify([...this.sessions.values()], null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      /* 落盘失败不影响本次登录，退化为进程内会话 */
    }
  }

  create(phone: string): string {
    const token = randomBytes(32).toString('hex');
    const session: Session = { phone, token, createdAt: new Date().toISOString() };
    this.sessions.set(token, session);
    this.persist();
    return token;
  }

  has(token: string): boolean {
    const s = this.sessions.get(token);
    if (!s) return false;
    if (this.isExpired(s)) {
      this.sessions.delete(token);
      this.persist();
      return false;
    }
    return true;
  }

  get(token: string): Session | undefined {
    return this.has(token) ? this.sessions.get(token) : undefined;
  }

  revoke(token: string): boolean {
    const ok = this.sessions.delete(token);
    if (ok) this.persist();
    return ok;
  }
}

/** 返回 Express 中间件：校验 Authorization: Bearer <token> */
export function requireToken(masterToken: string, sessions?: SessionStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    const token = m[1];
    if (safeEqual(token, masterToken)) {
      next();
      return;
    }
    if (sessions?.has(token)) {
      const session = sessions.get(token);
      if (session) {
        // 通过索引签名附加用户信息，供 /api/auth/me 等后续接口读取
        (req as Request & { user?: Session }).user = session;
      }
      next();
      return;
    }
    res.status(401).json({ ok: false, error: 'unauthorized' });
  };
}

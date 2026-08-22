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

/**
 * 内存会话存储（进程内）。
 * Web 控制台当前为本地单用户/小团队使用，会话不落盘；
 * 若后续需要跨进程共享，可迁移到 Redis/数据库。
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(phone: string): string {
    const token = randomBytes(32).toString('hex');
    const session: Session = { phone, token, createdAt: new Date().toISOString() };
    this.sessions.set(token, session);
    return token;
  }

  has(token: string): boolean {
    return this.sessions.has(token);
  }

  get(token: string): Session | undefined {
    return this.sessions.get(token);
  }

  revoke(token: string): boolean {
    return this.sessions.delete(token);
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

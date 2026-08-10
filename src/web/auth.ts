/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M5 Web 控制台鉴权：Bearer Token 中间件（FH_WEB_TOKEN）。
 * 无有效令牌一律 401（fail-closed），与 CLI 企业模式的安全基线一致。
 */
import type { Request, Response, NextFunction } from 'express';

/** 返回 Express 中间件：校验 Authorization: Bearer <token> */
export function requireToken(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m || m[1] !== token) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    next();
  };
}

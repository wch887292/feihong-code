/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M5 Web 控制台：自包含 Express 服务骨架。
 * S1：服务骨架 + 鉴权 + /api/health（占位；S2 扩展观测 API，S3 填充仪表盘）。
 */
import express, { type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { requireToken } from './auth';
import { VERSION, PRODUCT, SIGNATURE } from '../cli/version';
import { isEnterpriseEnabled } from '../enterprise';

export interface ServeOptions {
  port?: number;
  token?: string;
}

export interface ServeHandle {
  port: number;
  token: string;
  url: string;
  close(): void;
}

/**
 * 启动 Web 控制台。
 * - 端口：opts.port > FH_WEB_PORT > 8080
 * - 令牌：opts.token > FH_WEB_TOKEN > 自动生成（仅本次会话有效，fail-closed）
 */
export function startWebServer(opts: ServeOptions = {}): ServeHandle {
  const port = opts.port ?? Number(process.env.FH_WEB_PORT ?? 8080);
  let token = opts.token ?? process.env.FH_WEB_TOKEN ?? '';
  if (!token) {
    token = randomBytes(24).toString('hex');
    console.log(`[飞虹 Code] Web 控制台令牌已自动生成（FH_WEB_TOKEN）: ${token}`);
  }

  const app = express();
  app.use(express.json());

  // 静态仪表盘（S3 填充；S1 占位页）
  const publicDir = join(__dirname, 'public');
  app.use(express.static(publicDir));

  // 鉴权：全部 /api 需 Bearer token（静态资源除外）
  app.use('/api', requireToken(token));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      product: PRODUCT,
      version: VERSION,
      signature: SIGNATURE,
      enterprise: isEnterpriseEnabled(),
      time: new Date().toISOString(),
    });
  });

  const server = app.listen(port, () => {
    console.log(`[飞虹 Code] Web 控制台已启动: http://localhost:${port}`);
  });

  return {
    port,
    token,
    url: `http://localhost:${port}`,
    close: () => server.close(),
  };
}

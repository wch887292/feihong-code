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
import { t, getLang } from '../shared/i18n';
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
    console.log(t('serve.tokenAuto', { token }));
  }

  const app = express();
  // M8 修复：限制请求体大小，防止超大 payload 触发内存耗尽（DoS 面）
  app.use(express.json({ limit: '1mb' }));

  // 静态仪表盘（S3 填充；S1 占位页）
  const publicDir = join(__dirname, 'public');
  app.use(express.static(publicDir));

  // 公开健康检查（仅暴露版本/状态等观测信息，无敏感数据，便于前端仪表盘直接拉取）
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      product: PRODUCT,
      version: VERSION,
      signature: SIGNATURE,
      enterprise: isEnterpriseEnabled(),
      lang: getLang(),
      time: new Date().toISOString(),
    });
  });

  // 鉴权：其余 /api 需 Bearer token（静态资源除外）
  app.use('/api', requireToken(token));

  const server = app.listen(port, () => {
    console.log(t('serve.started', { port }));
  });

  return {
    port,
    token,
    url: `http://localhost:${port}`,
    close: () => server.close(),
  };
}

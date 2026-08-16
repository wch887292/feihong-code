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
import { TaskQueue, type TaskRecord } from './task-queue';
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
 * P4-1：新增 /api/tasks 任务队列（提交/列表/查询），服务端静默执行。
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

  // P4-1 云执行：任务队列（进程内；服务端静默执行，不输出到 HTTP 日志流）
  // P5-2 调度入口：FH_TASK_WEBHOOK_URL 初始化状态回调；/api/webhook 可动态注册
  // P6-4 跨进程持久化：FH_TASK_PERSIST_DIR 启用（缺省 ~/.feihong-code/tasks），重启恢复队列
  const persistDir =
    process.env.FH_TASK_PERSIST_DIR?.trim() ||
    join(process.env.FH_HOME?.trim() || join(require('os').homedir(), '.feihong-code'), 'tasks');
  const queue = new TaskQueue({
    concurrency: Number(process.env.FH_TASK_CONCURRENCY ?? 2),
    webhookUrl: process.env.FH_TASK_WEBHOOK_URL,
    persistDir,
  });

  // 鉴权：其余 /api 需 Bearer token（静态资源除外）
  app.use('/api', requireToken(token));

  app.post('/api/tasks', (req: Request, res: Response) => {
    const body = req.body as { goal?: unknown } | undefined;
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal) {
      res.status(400).json({ ok: false, error: '缺少 goal 字段' });
      return;
    }
    const record = queue.submit(goal);
    res.status(201).json({ ok: true, task: publicTask(record) });
  });

  // P5-2：注册/更新任务状态 webhook（可被 CI/外部系统动态设置）
  app.post('/api/webhook', (req: Request, res: Response) => {
    const body = req.body as { url?: unknown } | undefined;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      res.status(400).json({ ok: false, error: '缺少 url 字段' });
      return;
    }
    queue.setWebhookUrl(url);
    res.json({ ok: true, webhookUrl: url });
  });

  // P5-2：查询当前 webhook（供外部系统确认配置）
  app.get('/api/webhook', (_req: Request, res: Response) => {
    res.json({ ok: true, webhookUrl: queue.getWebhookUrl() || null });
  });

  app.get('/api/tasks', (_req: Request, res: Response) => {
    res.json({ ok: true, tasks: queue.list().map(publicTask) });
  });

  app.get('/api/tasks/:id', (req: Request, res: Response) => {
    const record = queue.get(req.params.id);
    if (!record) {
      res.status(404).json({ ok: false, error: '任务不存在' });
      return;
    }
    res.json({ ok: true, task: publicTask(record) });
  });

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

/** 对外暴露的任务视图（不含内部字段） */
function publicTask(r: TaskRecord): TaskRecord {
  return r;
}

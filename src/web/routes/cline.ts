/**
 * 飞虹 Code - Cline 进程级嫁接路由（B3-c 拆分自 web/server.ts）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 包含区块（原 1006-1059）：fhcode 调度 → Cline CLI 免费模型执行
 */
import express, { type Request, type Response } from 'express';
import { isClineInstalled, runClineCli, detectRateLimit } from '../../tools/cline/cline-exec.tool';

type ExpressApp = ReturnType<typeof express>;

export interface ClineRoutesDeps {
  homeDir: string;
}

export function registerClineRoutes(app: ExpressApp, deps: ClineRoutesDeps): void {
  const { homeDir } = deps;

  app.get('/api/cline/status', (_req: Request, res: Response) => {
    try {
      const available = isClineInstalled();
      let version = '';
      try {
        const cp = require('child_process');
        version = cp.execSync('cline --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0] || '';
      } catch { /* 忽略 */ }
      res.json({ ok: true, available, version });
    } catch (e: any) {
      res.json({ ok: true, available: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/cline/run', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const task = String(body?.task ?? '').trim();
      if (!task) { res.status(400).json({ ok: false, error: '缺少任务内容' }); return; }
      const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
      const timeoutMs = Number(body?.timeoutMs) > 0 ? Number(body.timeoutMs) : 180000;
      const args: string[] = ['--json', '-t', '90'];
      if (model) args.push('-m', model);
      args.push(' ' + task + ' '); // 首尾空格：Windows spawn 自动加引号，Cline 才能识别为 prompt
      const t0 = Date.now();
      const r = await runClineCli(args, { cwd: homeDir, timeoutMs });
      const combined = `${r.stdout}${r.stderr}`;
      const rateLimited = detectRateLimit(combined);
      const elapsedMs = Date.now() - t0;
      // 解析 NDJSON 中的最终文本
      let text = '';
      for (const line of combined.split('\n')) {
        if (!line.trim() || !line.startsWith('{')) continue;
        try {
          const ev = JSON.parse(line);
          const e = ev?.event;
          if (e && (e.type === 'done' || e.type === 'message') && typeof e.text === 'string') text = e.text;
          if (ev?.type === 'message' && typeof ev?.message?.content === 'string') text = ev.message.content;
        } catch { /* 忽略非JSON行 */ }
      }
      res.json({
        ok: r.code === 0,
        rateLimited,
        elapsedMs,
        code: r.code,
        text: text || combined.slice(0, 2000),
        raw: combined.slice(0, 8000),
        error: rateLimited ? 'CLINE_RATE_LIMIT: 免费额度受限，请退回主模型' : (r.code !== 0 ? combined.slice(0, 1200) : ''),
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}

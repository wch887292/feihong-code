/**
 * 飞虹 Code - Codex 进程级嫁接路由（B3-c 拆分自 web/server.ts）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * fhcode 调度 → Codex CLI 执行（需 OpenAI 账号登录）
 *  - /api/codex/status  检测 Codex 安装/版本/登录状态
 *  - /api/codex/run     派发任务给 Codex exec 执行
 */
import express, { type Request, type Response } from 'express';
import {
  isCodexInstalled,
  getCodexVersion,
  getCodexLoginStatus,
  runCodexCli,
  detectAuthError,
} from '../../tools/codex/codex-exec.tool';

type ExpressApp = ReturnType<typeof express>;

export interface CodexRoutesDeps {
  homeDir: string;
}

export function registerCodexRoutes(app: ExpressApp, deps: CodexRoutesDeps): void {
  const { homeDir } = deps;

  app.get('/api/codex/status', (_req: Request, res: Response) => {
    try {
      const available = isCodexInstalled();
      const version = available ? getCodexVersion() : '';
      const login = available ? getCodexLoginStatus() : { loggedIn: false, detail: 'Codex CLI 未安装' };
      res.json({
        ok: true,
        available,
        version,
        loggedIn: login.loggedIn,
        loginDetail: login.detail,
      });
    } catch (e: any) {
      res.json({ ok: true, available: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/codex/run', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const task = String(body?.task ?? '').trim();
      if (!task) { res.status(400).json({ ok: false, error: '缺少任务内容' }); return; }
      const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
      const reasoningEffort =
        typeof body?.reasoningEffort === 'string' && body.reasoningEffort.trim()
          ? body.reasoningEffort.trim()
          : undefined;
      const sandbox =
        typeof body?.sandbox === 'string' && body.sandbox.trim() ? body.sandbox.trim() : undefined;
      const timeoutMs = Number(body?.timeoutMs) > 0 ? Number(body.timeoutMs) : 180000;

      const args: string[] = ['exec', '--json'];
      if (model) args.push('--model', model);
      if (reasoningEffort) args.push('--reasoning-effort', reasoningEffort);
      if (sandbox) args.push('--sandbox', sandbox);
      args.push(task);

      const t0 = Date.now();
      const r = await runCodexCli(args, { cwd: homeDir, timeoutMs });
      const combined = `${r.stdout}${r.stderr}`;
      const elapsedMs = Date.now() - t0;
      const authError = detectAuthError(combined);

      // 尝试解析 JSON 输出中的最终文本
      let text = '';
      for (const line of combined.split('\n')) {
        if (!line.trim() || !line.startsWith('{')) continue;
        try {
          const ev = JSON.parse(line);
          if (typeof ev?.result === 'string') text = ev.result;
          if (typeof ev?.output === 'string') text = ev.output;
          if (typeof ev?.text === 'string') text = ev.text;
          if (ev?.items && Array.isArray(ev.items)) {
            const last = ev.items[ev.items.length - 1];
            if (last && typeof last?.text === 'string') text = last.text;
          }
        } catch { /* 忽略非JSON行 */ }
      }

      res.json({
        ok: r.code === 0,
        authError,
        elapsedMs,
        code: r.code,
        text: text || combined.slice(0, 2000),
        raw: combined.slice(0, 8000),
        error: authError
          ? 'CODEX_NEED_AUTH: Codex 未登录，请在终端运行 `codex login` 完成登录后重试'
          : r.code !== 0
            ? combined.slice(0, 1200)
            : '',
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * v8.8.0 记忆画像可视化路由：
 *   GET    /api/memory/profile   业务画像总览（累计任务/高频领域/关键决策/产物/偏好/最近任务）
 *   GET    /api/memory/stats     三层记忆统计（工作/任务/项目）
 *   GET    /api/memory/entries   项目记忆原始条目（支持 limit 截断）
 *
 * 背景：④ 工作记忆此前只有 CLI 出口（fhcode memory profile），控制台看不到——
 * 用户无法直观看到"这个项目我让AI 干了多少活、它记住了什么决策"。
 */
import express, { type Request, type Response } from 'express';
import { createLayeredMemory } from '../../agent/layered-memory';
import { aggregateProfile } from '../../memory/profile';

type ExpressApp = ReturnType<typeof express>;

export interface MemoryRouteDeps {
  homeDir: string;
}

export function registerMemoryRoutes(app: ExpressApp, _deps: MemoryRouteDeps): void {
  app.get('/api/memory/profile', (_req: Request, res: Response) => {
    try {
      const mem = createLayeredMemory();
      const entries = mem.getProjectMemory();
      res.json({ ok: true, profile: aggregateProfile(entries) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/memory/stats', (_req: Request, res: Response) => {
    try {
      const mem = createLayeredMemory();
      res.json({ ok: true, stats: mem.getStats() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/memory/entries', (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
      const mem = createLayeredMemory();
      const all = mem.getProjectMemory();
      // 项目记忆按时间倒序（最新在前）
      const sorted = [...all].sort((a, b) =>
        String(b.timestamp || '').localeCompare(String(a.timestamp || '')),
      );
      res.json({ ok: true, total: all.length, entries: sorted.slice(0, limit) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

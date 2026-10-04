/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ③ 自动化任务路由（云端 7x24 真实执行）：
 *   GET    /api/routines            列出全部任务（含状态/下次执行时间）
 *   POST   /api/routines            创建（name/goal/cron/tier 或 command/workspaceDir）
 *   POST   /api/routines/:id/run    手动触发一次（真实执行，经三级规则引擎门控）
 *   POST   /api/routines/:id/enable 启用/停用（{enabled}）
 *   DELETE /api/routines/:id        删除
 *   GET    /api/routines/approvals  审批收件箱待决项
 *
 * 调度器与审批收件箱为进程单例（service.ensureScheduler），serve 启动时 start()。
 */
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { ensureScheduler, getInbox } from '../../runtime/routines/service';
import { normalizeTier } from '../../models/tier';
import type { RoutineDef } from '../../runtime/routines/store';

type ExpressApp = ReturnType<typeof express>;

export interface RoutineRouteDeps {
  homeDir: string;
}

export function registerRoutineRoutes(app: ExpressApp, _deps: RoutineRouteDeps): void {
  const buildDefBody = (body: Record<string, any>): Omit<RoutineDef, 'createdAt'> | null => {
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '未命名自动化';
    const cron = typeof body.cron === 'string' && body.cron.trim() ? body.cron.trim() : '';
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    const command = typeof body.command === 'string' ? body.command.trim() : '';
    if (!cron) return null;
    if (!goal && !command) return null;
    const tier = normalizeTier(body.tier);
    const action = command
      ? ({ type: 'command', command } as const)
      : ({ type: 'goal', goal, tier } as const);
    return {
      id: `rt_${Date.now()}_${randomUUID().slice(0, 4)}`,
      name,
      trigger: { kind: 'cron', expr: cron },
      action,
      enabled: body.enabled !== false,
      catchUp: true,
      maxRetries: 2,
      backoffBaseSec: 60,
    };
  };

  app.get('/api/routines', (_req: Request, res: Response) => {
    const s = ensureScheduler();
    const routines = s.listDefs().map((d) => ({ ...d, state: s.getState(d.id) }));
    res.json({ ok: true, routines });
  });

  app.post('/api/routines', (req: Request, res: Response) => {
    const def = buildDefBody(req.body ?? {});
    if (!def) {
      res.status(400).json({ ok: false, error: '缺少 cron 与任务内容（goal 或 command）' });
      return;
    }
    try {
      const s = ensureScheduler();
      s.addDef(def);
      res.status(201).json({ ok: true, routine: def });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/routines/:id/run', async (req: Request, res: Response) => {
    const s = ensureScheduler();
    const id = req.params.id;
    if (!s.listDefs().some((d) => d.id === id)) {
      res.status(404).json({ ok: false, error: '任务不存在' });
      return;
    }
    const r = await s.runOnce(id);
    if (!r) {
      res.status(409).json({ ok: false, error: '任务已停用或执行失败' });
      return;
    }
    res.json({ ok: true, result: r });
  });

  app.post('/api/routines/:id/enable', (req: Request, res: Response) => {
    const s = ensureScheduler();
    const body = (req.body ?? {}) as Record<string, any>;
    const enabled = body.enabled !== false;
    if (!s.setEnabled(req.params.id, enabled)) {
      res.status(404).json({ ok: false, error: '任务不存在' });
      return;
    }
    res.json({ ok: true, enabled });
  });

  (app.delete as (p: string, h: (req: Request, res: Response) => void) => void)(
    '/api/routines/:id',
    (req: Request, res: Response) => {
      const s = ensureScheduler();
      if (!s.removeDef(req.params.id)) {
        res.status(404).json({ ok: false, error: '任务不存在' });
        return;
      }
      res.json({ ok: true });
    },
  );

  app.get('/api/routines/approvals', (_req: Request, res: Response) => {
    const inbox = getInbox();
    if (!inbox) {
      res.json({ ok: true, approvals: [] });
      return;
    }
    res.json({ ok: true, approvals: inbox.list() });
  });
}

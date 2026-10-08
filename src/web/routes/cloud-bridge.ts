/**
 * 飞虹 Code - 云桥接（Cloud Bridge）+ 授权路由（B3-c 拆分自 web/server.ts）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 包含区块（原 1061-1285）：
 * - 云桥接（手机发指令 → 云端队列 → 电脑端执行 → 结果回传）：devices + commands 全生命周期
 * - 授权状态查询 / 激活（含暴力破解防护）
 *
 * 共享闭包经 CloudBridgeDeps 注入；本模块不得反向 import web/server。
 */
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { BruteForceGuard } from '../../security';
import {
  licenseState,
  licenseText,
  activateLicense,
  onlineEnabled,
  onlineState,
  onlineText,
  activateOnline,
  heartbeatOnline,
  heartbeatDue,
  licenseServerUrl,
} from '../../license';

type ExpressApp = ReturnType<typeof express>;

export interface CloudBridgeDeps {
  homeDir: string;
  loadJsonFile: <T>(file: string, fallback: T) => T;
  saveJsonFile: (file: string, data: unknown) => boolean;
  bruteForce: BruteForceGuard;
  /** v8.9.0：手机指令完成时同步注入 Web 任务队列，桌面端对话流可见 */
  queue?: import('../task-queue').TaskQueue;
}

export function registerCloudBridgeRoutes(app: ExpressApp, deps: CloudBridgeDeps): void {
  const { homeDir, loadJsonFile, saveJsonFile, bruteForce } = deps;

  /* ========== 云桥接（Cloud Bridge）：手机发指令 → 云端队列 → 电脑端执行 → 结果回传 ========== */
  // 数据模型：devices（电脑设备注册）+ commands（待执行指令队列）
  // 电脑端在内网无公网入口，由电脑端桥接代理主动长轮询拉取指令执行；
  // 手机端把指令 POST 到云端队列，再轮询结果。全部落盘 FH_HOME 下，重启不丢。
  interface BridgeDevice {
    deviceId: string;
    name: string;
    lastSeenAt: string;
    status: 'online' | 'offline';
    createdAt: string;
  }
  interface BridgeCommand {
    cmdId: string;
    deviceId: string;
    text: string;
    status: 'queued' | 'running' | 'done' | 'failed' | 'refused' | 'paused';
    result?: Record<string, any>;
    error?: string;
    createdAt: string;
    executedAt?: string;
  }
  const bridgeFile = join(homeDir, 'bridge-devices.json');
  const bridgeCmdsFile = join(homeDir, 'bridge-commands.json');
  function loadBridgeDevices(): BridgeDevice[] { return loadJsonFile<BridgeDevice[]>(bridgeFile, []); }
  function saveBridgeDevices(list: BridgeDevice[]): boolean { return saveJsonFile(bridgeFile, list); }
  function loadBridgeCommands(): BridgeCommand[] { return loadJsonFile<BridgeCommand[]>(bridgeCmdsFile, []); }
  function saveBridgeCommands(list: BridgeCommand[]): boolean { return saveJsonFile(bridgeCmdsFile, list); }

  // 设备注册 / 心跳：电脑端桥接代理每次轮询前调用，标记在线
  // F11 加固（2026-09-30 安全审计 P1）：字段截断 + 设备数量上限，防伪造注册刷爆设备表
  app.post('/api/bridge/register', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const deviceId = String(body?.deviceId ?? '').trim();
    const name = (String(body?.name ?? '').trim() || '未命名电脑').slice(0, 100);
    if (!deviceId) { res.status(400).json({ ok: false, error: '缺少 deviceId' }); return; }
    if (deviceId.length > 200) { res.status(400).json({ ok: false, error: 'deviceId 过长' }); return; }
    const list = loadBridgeDevices();
    const now = new Date().toISOString();
    const found = list.find((d) => d.deviceId === deviceId);
    if (!found && list.length >= 50) {
      res.status(429).json({ ok: false, error: '设备数已达上限（50），请先注销离线设备' });
      return;
    }
    if (found) { found.lastSeenAt = now; found.status = 'online'; found.name = name; }
    else { list.push({ deviceId, name, lastSeenAt: now, status: 'online', createdAt: now }); }
    saveBridgeDevices(list);
    res.json({ ok: true, deviceId, status: 'online' });
  });

  // 手机端：发送指令到指定电脑（入队）
  app.post('/api/bridge/command', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const deviceId = String(body?.deviceId ?? '').trim();
    const text = String(body?.text ?? '').trim();
    if (!deviceId) { res.status(400).json({ ok: false, error: '缺少 deviceId（目标电脑）' }); return; }
    if (!text) { res.status(400).json({ ok: false, error: '缺少 text（指令内容）' }); return; }
    const devices = loadBridgeDevices();
    if (!devices.some((d) => d.deviceId === deviceId)) {
      res.status(404).json({ ok: false, error: '目标电脑未注册，请先在该电脑启动 fhcode bridge' });
      return;
    }
    const cmd: BridgeCommand = {
      cmdId: randomUUID(),
      deviceId,
      text,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    const list = loadBridgeCommands();
    list.unshift(cmd);
    // 只保留每设备最近 200 条，防止无限增长
    saveBridgeCommands(list.slice(0, 200));
    res.json({ ok: true, cmdId: cmd.cmdId, status: 'queued' });
  });

  // 电脑端桥接代理：拉取待执行指令（长轮询，一次取一条，取后标记 running）
  app.get('/api/bridge/pending', (req: Request, res: Response) => {
    const deviceId = String(req.query.deviceId ?? '').trim();
    if (!deviceId) { res.status(400).json({ ok: false, error: '缺少 deviceId' }); return; }
    // 心跳：更新在线状态
    const devices = loadBridgeDevices();
    const dev = devices.find((d) => d.deviceId === deviceId);
    if (dev) { dev.lastSeenAt = new Date().toISOString(); dev.status = 'online'; saveBridgeDevices(devices); }
    const list = loadBridgeCommands();
    const idx = list.findIndex((c) => c.deviceId === deviceId && c.status === 'queued');
    if (idx < 0) { res.json({ ok: true, command: null }); return; }
    const cmd = list[idx];
    cmd.status = 'running';
    cmd.executedAt = new Date().toISOString();
    saveBridgeCommands(list);
    res.json({ ok: true, command: { cmdId: cmd.cmdId, text: cmd.text } });
  });

  // 电脑端桥接代理：回传执行结果
  app.post('/api/bridge/result', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const cmdId = String(body?.cmdId ?? '').trim();
    const deviceId = String(body?.deviceId ?? '').trim();
    const okFlag = body?.ok === true;
    const result = body?.result;
    const error = String(body?.error ?? '');
    if (!cmdId || !deviceId) { res.status(400).json({ ok: false, error: '缺少 cmdId 或 deviceId' }); return; }
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId && c.deviceId === deviceId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    cmd.status = okFlag ? 'done' : 'failed';
    if (okFlag) cmd.result = result ?? {};
    else cmd.error = error || '执行失败';
    saveBridgeCommands(list);
    // v8.9.0：同步注入 Web 任务队列（桌面端对话流实时显示手机任务）
    try {
      const resultText =
        typeof result?.text === 'string' && result.text ? result.text
        : (okFlag ? (JSON.stringify(result ?? {}).slice(0, 500) || '执行成功') : error || '执行失败');
      deps.queue?.importBridgeCommand({
        bridgeCmdId: cmdId,
        goal: cmd.text,
        resultText: resultText.slice(0, 2000),
        ok: okFlag,
        executedAt: cmd.executedAt,
      });
    } catch (e) {
      // 同步失败不阻断回传
      console.warn('[bridge] 同步桌面端任务失败:', e instanceof Error ? e.message : String(e));
    }
    res.json({ ok: true, status: cmd.status });
  });

  // 手机端：查询指令执行结果
  app.get('/api/bridge/command/:cmdId', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const cmd = loadBridgeCommands().find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    res.json({ ok: true, command: cmd });
  });

  // 手机端：列出已注册电脑设备
  app.get('/api/bridge/devices', (_req: Request, res: Response) => {
    res.json({ ok: true, devices: loadBridgeDevices() });
  });

  // 设备注销（销毁云电脑实例 / 移除离线设备时清理列表，避免手机端出现僵尸设备）
  app.delete('/api/bridge/devices/:deviceId', (req: Request, res: Response) => {
    const deviceId = String(req.params.deviceId ?? '').trim();
    if (!deviceId) { res.status(400).json({ ok: false, error: '缺少 deviceId' }); return; }
    const devices = loadBridgeDevices();
    const next = devices.filter((d) => d.deviceId !== deviceId);
    saveBridgeDevices(next);
    // 一并清理该设备的待执行指令，防止僵尸指令堆积
    const cmds = loadBridgeCommands();
    saveBridgeCommands(cmds.filter((c) => c.deviceId !== deviceId));
    res.json({ ok: true, removed: devices.length - next.length });
  });

  // 授权状态查询（Web/手机端展示）— 在线模式下自动区分离线/在线
  app.get('/api/license', (_req: Request, res: Response) => {
    if (onlineEnabled()) {
      const st = onlineState();
      // 查询即触发一次心跳（异步，不阻塞响应），保证后台能看到在线状态
      if (heartbeatDue()) void heartbeatOnline().catch(() => undefined);
      res.json({
        ok: st.valid,
        mode: 'online',
        license: st,
        text: onlineText(st),
        serverUrl: licenseServerUrl(),
      });
      return;
    }
    const state = licenseState();
    res.json({ ok: true, mode: 'offline', license: state, text: licenseText(state) });
  });

  // 激活（手机端/Web 输入激活码）— 在线模式走授权服务
  app.post('/api/license/activate', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const key = String(body.text ?? body.key ?? '').trim();
    if (!key) { res.status(400).json({ ok: false, error: '缺少激活码' }); return; }
    // 暴力破解防护：IP 维度
    const ip = (req as any).ip || (req.socket as any)?.remoteAddress || 'unknown';
    const guardKey = `license:${ip}`;
    if (bruteForce.isLocked(guardKey)) {
      res.status(429).json({ ok: false, error: '激活尝试过于频繁，请 15 分钟后再试' });
      return;
    }

    if (onlineEnabled()) {
      // 在线激活需要网络 IO，用异步处理避免阻塞事件循环
      void (async () => {
        const result = await activateOnline(key);
        if (!result.ok) {
          bruteForce.recordFailure(guardKey);
          res.status(400).json({ ok: false, mode: 'online', error: result.error || '在线激活失败' });
          return;
        }
        bruteForce.clear(guardKey);
        res.json({ ok: true, mode: 'online', license: result.state, text: onlineText(result.state!) });
      })();
      return;
    }

    const result = activateLicense(key);
    if (!result.ok) {
      bruteForce.recordFailure(guardKey);
      res.status(400).json({ ok: false, mode: 'offline', error: result.error || '激活失败' });
      return;
    }
    bruteForce.clear(guardKey);
    res.json({ ok: true, mode: 'offline', license: result.state, text: licenseText(result.state!) });
  });

  // 手动心跳（在线模式，Web/手机端可主动触发一次校验）
  app.post('/api/license/heartbeat', (_req: Request, res: Response) => {
    if (!onlineEnabled()) {
      res.json({ ok: true, mode: 'offline', skipped: true, text: '离线模式无需心跳' });
      return;
    }
    void (async () => {
      const r = await heartbeatOnline();
      const st = onlineState();
      res.status(r.ok ? 200 : 409).json({
        ok: r.ok,
        mode: 'online',
        status: r.status ?? null,
        configUpdated: Boolean(r.configUpdated),
        graceHoursLeft: r.graceHoursLeft ?? 0,
        license: st,
        text: onlineText(st),
        ...(r.error ? { error: r.error } : {}),
      });
    })();
  });

  // 电脑端：列出本设备的全部指令（含状态/结果，供管理面板查看）
  app.get('/api/bridge/commands', (req: Request, res: Response) => {
    const deviceId = String(req.query.deviceId ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    let list = loadBridgeCommands();
    if (deviceId) list = list.filter((c) => c.deviceId === deviceId);
    if (status) list = list.filter((c) => c.status === status);
    res.json({ ok: true, commands: list.slice(0, 200) });
  });

  // 电脑端：修改指令内容（仅未执行的指令可改；已 running/done/failed 的不允许改）
  app.post('/api/bridge/command/:cmdId/edit', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const body = (req.body ?? {}) as Record<string, any>;
    const newText = String(body?.text ?? '').trim();
    if (!newText) { res.status(400).json({ ok: false, error: '缺少新的指令内容 text' }); return; }
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    if (cmd.status === 'running' || cmd.status === 'done') {
      res.status(409).json({ ok: false, error: '指令已在执行或已完成，无法修改' });
      return;
    }
    cmd.text = newText;
    cmd.status = 'queued';
    cmd.error = undefined;
    cmd.result = undefined;
    saveBridgeCommands(list);
    res.json({ ok: true, command: cmd });
  });

  // 电脑端：批准执行（把 queued/paused 指令设为待执行；与「重发」等效）
  app.post('/api/bridge/command/:cmdId/approve', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    if (cmd.status === 'running') { res.status(409).json({ ok: false, error: '指令正在执行中' }); return; }
    cmd.status = 'queued';
    cmd.error = undefined;
    cmd.result = undefined;
    saveBridgeCommands(list);
    res.json({ ok: true, command: cmd });
  });

  // 电脑端：拒绝/撤销指令（标记 refused，电脑端不执行）
  app.post('/api/bridge/command/:cmdId/refuse', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    if (cmd.status === 'running') { res.status(409).json({ ok: false, error: '指令正在执行中，无法拒绝' }); return; }
    cmd.status = 'refused';
    saveBridgeCommands(list);
    res.json({ ok: true, command: cmd });
  });

  // 电脑端：删除指令
  app.delete('/api/bridge/command/:cmdId', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const list = loadBridgeCommands();
    const next = list.filter((c) => c.cmdId !== cmdId);
    if (next.length === list.length) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    saveBridgeCommands(next);
    res.json({ ok: true });
  });

  // 电脑端：标记暂停（电脑端审批后才执行——审批流控制）
  app.post('/api/bridge/command/:cmdId/pause', (req: Request, res: Response) => {
    const cmdId = req.params.cmdId;
    const list = loadBridgeCommands();
    const cmd = list.find((c) => c.cmdId === cmdId);
    if (!cmd) { res.status(404).json({ ok: false, error: '指令不存在' }); return; }
    if (cmd.status === 'running') { res.status(409).json({ ok: false, error: '指令正在执行中' }); return; }
    cmd.status = 'paused';
    saveBridgeCommands(list);
    res.json({ ok: true, command: cmd });
  });
}

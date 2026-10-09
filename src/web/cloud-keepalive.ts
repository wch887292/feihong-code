/**
 * 云中转保活（v8.8.6 直连架构）
 *
 * 架构变更（2026-10-09）：
 * - 云端 api.klai.top/fhrelay 现在直接指向服务器本机的 fhcode v8.8.5 实例（PM2 fhcode-v885）
 * - 家里电脑不再需要 ssh 隧道 + fh-relay-client，改为 bridge start 出站直连云端注册设备
 * - 本保活职责：确保「家里电脑」设备在云端设备表中心跳新鲜；掉线则重拉本地 bridge
 *
 * 常驻方式：Windows 计划任务 FHKeepalive（每 5 分钟触发 + 登录自启）拉起本脚本；
 * 脚本自身每 60 秒巡检。bridge 的 stdin 管道由本常驻进程持有（EOF 会导致 bridge 退出）。
 */
import { spawn } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

const CLOUD_URL = process.env.FH_KEEPALIVE_CLOUD_URL || 'https://api.klai.top/fhrelay';
const CLOUD_TOKEN = process.env.FH_KEEPALIVE_TOKEN || '30587308defe825b6c59526355d6f7c3ba5e9323f787e074c9d962646c68f77a';
const HOME_DEVICE_NAME = '家里电脑';
const LOCK_PORT = 18777;
const STALE_MS = 5 * 60 * 1000;
const ROOT = path.resolve(__dirname, '..', '..');
const LOG_FILE = path.join(process.env.TEMP || 'C:/Users/Administrator/AppData/Local/Temp', 'fhrelay_keepalive.log');

function log(msg: string): void {
  try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + msg + '\n'); } catch { /* 忽略日志失败 */ }
}

function acquireLock(port: number, cb: (ok: boolean) => void): void {
  const srv = net.createServer();
  srv.once('error', () => cb(false));
  srv.listen(port, () => { srv.unref(); cb(true); });
}

interface DeviceInfo { deviceId: string; name?: string; lastSeenAt?: string; status?: string; }

function fetchJson(url: string, headers: Record<string, string>, cb: (data: unknown, err?: Error) => void): void {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  const req = mod.request(u, { method: 'GET', headers }, (res) => {
    let d = '';
    res.on('data', (c) => { d += c; });
    res.on('end', () => { try { cb(JSON.parse(d)); } catch (e) { cb(null, e as Error); } });
  });
  req.on('error', (e) => cb(null, e));
  req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
  req.end();
}

let bridgeChild: ReturnType<typeof spawn> | null = null;

function spawnBridge(): void {
  if (bridgeChild) { try { bridgeChild.kill(); } catch { /* 忽略 */ } bridgeChild = null; }
  bridgeChild = spawn(process.execPath,
    [path.join(ROOT, 'dist', 'cli', 'index.js'), 'bridge', 'start'],
    { cwd: ROOT, detached: false, stdio: ['pipe', 'ignore', 'ignore'],
      env: Object.assign({}, process.env, {
        FH_BRIDGE_URL: CLOUD_URL,
        FH_BRIDGE_TOKEN: CLOUD_TOKEN,
        FH_BRIDGE_NAME: HOME_DEVICE_NAME
      }) });
  log('bridge 已拉起 pid=' + bridgeChild.pid);
  bridgeChild.on('exit', (c) => { log('bridge 退出 code=' + c); bridgeChild = null; });
}

function ensureHomeDevice(): void {
  fetchJson(CLOUD_URL + '/api/bridge/devices', { Authorization: 'Bearer ' + CLOUD_TOKEN }, (data, err) => {
    if (err || !data) { log('云端查询失败（网络或云端故障），下轮重试'); return; }
    const devices = (data as { devices?: DeviceInfo[] })?.devices || [];
    const mine = devices.find((d) => (d.name || '').indexOf(HOME_DEVICE_NAME) >= 0);
    if (mine && mine.lastSeenAt && (Date.now() - new Date(mine.lastSeenAt).getTime()) < STALE_MS) {
      log('巡检正常：「' + HOME_DEVICE_NAME + '」心跳新鲜'); return;
    }
    log(mine ? '「' + HOME_DEVICE_NAME + '」心跳过期，重拉 bridge' : '云端设备表缺「' + HOME_DEVICE_NAME + '」，拉起 bridge');
    spawnBridge();
  });
}

/** serve 内置集成已弃用：直连架构下保活由 Windows 计划任务 FHKeepalive 独立常驻 */
export function startCloudKeepalive(): void { /* no-op，保留导出兼容 server.ts */ }

function main(): void {
  acquireLock(LOCK_PORT, (ok) => {
    if (!ok) { log('已有保活实例（锁 18777 被占），退出'); return; }
    log('=== 保活启动（直连架构 v2）===');
    spawnBridge();
    setInterval(() => ensureHomeDevice(), 60 * 1000);
  });
}

main();

/**
 * 云中转保活（v8.8.6 直连架构 + v8.8.7 双注册本地闭环）
 *
 * 架构变更（2026-10-09）：
 * - 云端 api.klai.top/fhrelay 指向服务器本机的 fhcode v8.8.5 实例（PM2 fhcode-v885）
 * - 家里电脑不再需要 ssh 隧道 + fh-relay-client，改为 bridge start 出站直连云端注册设备
 * - 本保活职责：确保「家里电脑」设备在云端设备表中心跳新鲜；掉线则重拉本地 bridge
 *
 * 双注册（v8.8.7，方案B：本地控制台↔家里电脑 不走服务器）：
 * - 本机额外拉起一个 fhcode serve（默认 127.0.0.1:18085），作为「本地控制台」端点；
 *   本地浏览器打开 http://127.0.0.1:18085 即走本机闭环，任务在本机 agent 执行，不经过云端。
 * - bridge 双注册：① 连云端 relay（设备「家里电脑」，保留手机远程）② 连本机 serve
 *   （设备「家里电脑-本地」，供本地控制台使用）。两套设备表各自独立（不同 FH_HOME 的 bridge-devices.json）。
 *
 * 容错：serve 与 bridge 互相独立管理，任一拉起失败不影响其它链路；手机远程（云端 bridge）优先保障。
 *
 * 常驻方式：Windows 计划任务 FHKeepalive（每 5 分钟触发 + 登录自启）拉起本脚本；
 * 脚本自身每 60 秒巡检。bridge 的 stdin 管道由本常驻进程持有（EOF 会导致 bridge 退出）。
 */
import { spawn } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

const CLOUD_URL = process.env.FH_KEEPALIVE_CLOUD_URL || 'https://api.klai.top/fhrelay';
// v8.8.7：本机 serve 端点（本地控制台直连，绕过服务器）。可用环境变量覆盖。
const LOCAL_SERVE_URL = (process.env.FH_KEEPALIVE_LOCAL_URL || 'http://127.0.0.1:18085').replace(/\/+$/, '');
const LOCAL_SERVE_PORT = Number(process.env.FH_KEEPALIVE_LOCAL_PORT || (LOCAL_SERVE_URL.match(/:(\d+)$/)?.[1] || 18085));
const HOME_DEVICE_NAME = '家里电脑';
const LOCAL_DEVICE_NAME = process.env.FH_KEEPALIVE_LOCAL_NAME || '家里电脑-本地';
const LOCK_PORT = 18777;
const STALE_MS = 5 * 60 * 1000;
const ROOT = path.resolve(__dirname, '..', '..');
const LOG_FILE = path.join(process.env.TEMP || 'C:/Users/Administrator/AppData/Local/Temp', 'fhrelay_keepalive.log');
// 本机 FH_HOME：serve 与 bridge 复用本机 ~/.feihong-code（含 web-token.json 与 provider 配置）
const HOME = process.env.FH_HOME?.trim() || os.homedir();

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

// 敏感令牌不从源码读取：优先环境变量，其次 ~/.feihong-code/web-token.json（服务端持久化文件），
// 两者均无则置空并在日志告警（bridge 无法注册，等待管理员配置后重启）。
function resolveCloudToken(): string {
  const fromEnv = process.env.FH_KEEPALIVE_TOKEN || process.env.FH_BRIDGE_TOKEN || '';
  if (fromEnv) return fromEnv;
  try {
    const home = HOME;
    const tokenFile = path.join(home, '.feihong-code', 'web-token.json');
    if (fs.existsSync(tokenFile)) {
      const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8')) as { token?: string };
      if (saved.token) return saved.token;
    }
  } catch { /* 读取失败则走空 token */ }
  log('[安全] 未找到 FH_KEEPALIVE_TOKEN 或 web-token.json，bridge 无法注册云端设备，请配置令牌后重启');
  return '';
}
const CLOUD_TOKEN = resolveCloudToken();

function killChild(c: ReturnType<typeof spawn> | null): void {
  if (c) { try { c.kill(); } catch { /* 忽略 */ } }
}

/** 本机 serve（本地控制台端点）：失败不影响 bridge 链路 */
let serveChild: ReturnType<typeof spawn> | null = null;
/** 云端 bridge（手机远程，优先保障） */
let cloudBridgeChild: ReturnType<typeof spawn> | null = null;
/** 本机 bridge（注册到本机 serve，供本地控制台使用） */
let localBridgeChild: ReturnType<typeof spawn> | null = null;

function spawnServe(): void {
  killChild(serveChild); serveChild = null;
  const env = Object.assign({}, process.env, {
    FH_WEB_PORT: String(LOCAL_SERVE_PORT),
    FH_HOME: HOME,
    FH_SIGN_SECRET: CLOUD_TOKEN
  });
  serveChild = spawn(process.execPath,
    [path.join(ROOT, 'dist', 'cli', 'index.js'), 'serve', '--port', String(LOCAL_SERVE_PORT)],
    { cwd: ROOT, detached: false, stdio: ['ignore', 'ignore', 'ignore'], env });
  log('本地 serve 已拉起 pid=' + serveChild.pid + ' port=' + LOCAL_SERVE_PORT);
  serveChild.on('exit', (c) => { log('本地 serve 退出 code=' + c); serveChild = null; });
}

function spawnBridge(url: string, name: string): ReturnType<typeof spawn> {
  const child = spawn(process.execPath,
    [path.join(ROOT, 'dist', 'cli', 'index.js'), 'bridge', 'start'],
    { cwd: ROOT, detached: false, stdio: ['pipe', 'ignore', 'ignore'],
      env: Object.assign({}, process.env, {
        FH_BRIDGE_URL: url,
        FH_BRIDGE_TOKEN: CLOUD_TOKEN,
        FH_BRIDGE_NAME: name
      }) });
  log('bridge 已拉起「' + name + '」-> ' + url + ' pid=' + child.pid);
  child.on('exit', (c) => { log('bridge「' + name + '」退出 code=' + c); });
  return child;
}

function isAlive(c: ReturnType<typeof spawn> | null): boolean {
  return !!c && c.exitCode === null && c.signalCode === null;
}

function ensureLocalServe(): void {
  fetchJson(LOCAL_SERVE_URL + '/api/health', {}, (_data, err) => {
    if (err) { log('本地 serve 未响应（' + (err.message || '?') + '），重拉'); spawnServe(); return; }
    log('巡检正常：本地 serve 健康');
  });
}

function ensureDevice(url: string, name: string): void {
  fetchJson(url + '/api/bridge/devices', { Authorization: 'Bearer ' + CLOUD_TOKEN }, (data, err) => {
    if (err || !data) { log('「' + name + '」设备查询失败（网络或端点故障），下轮重试'); return; }
    const devices = (data as { devices?: DeviceInfo[] })?.devices || [];
    const mine = devices.find((d) => (d.name || '').indexOf(name) >= 0);
    if (mine && mine.lastSeenAt && (Date.now() - new Date(mine.lastSeenAt).getTime()) < STALE_MS) {
      log('巡检正常：「' + name + '」心跳新鲜'); return;
    }
    log(mine ? '「' + name + '」心跳过期，重拉 bridge' : '设备表缺「' + name + '」，拉起 bridge');
    if (name === LOCAL_DEVICE_NAME) {
      if (!isAlive(localBridgeChild)) { killChild(localBridgeChild); localBridgeChild = spawnBridge(LOCAL_SERVE_URL, LOCAL_DEVICE_NAME); }
    } else {
      if (!isAlive(cloudBridgeChild)) { killChild(cloudBridgeChild); cloudBridgeChild = spawnBridge(CLOUD_URL, HOME_DEVICE_NAME); }
    }
  });
}

/** serve 内置集成已弃用：直连架构下保活由 Windows 计划任务 FHKeepalive 独立常驻 */
export function startCloudKeepalive(): void { /* no-op，保留导出兼容 server.ts */ }

function main(): void {
  acquireLock(LOCK_PORT, (ok) => {
    if (!ok) { log('已有保活实例（锁 18777 被占），退出'); return; }
    log('=== 保活启动（双注册 + 本地 serve v8.8.7）===');
    spawnServe();
    cloudBridgeChild = spawnBridge(CLOUD_URL, HOME_DEVICE_NAME);
    localBridgeChild = spawnBridge(LOCAL_SERVE_URL, LOCAL_DEVICE_NAME);
    setInterval(() => {
      ensureLocalServe();
      ensureDevice(CLOUD_URL, HOME_DEVICE_NAME);
      ensureDevice(LOCAL_SERVE_URL, LOCAL_DEVICE_NAME);
    }, 60 * 1000);
  });
}

main();

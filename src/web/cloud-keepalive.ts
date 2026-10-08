/**
 * 飞虹云中转隧道保活（常驻版）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
 *
 * 链路：手机 → api.klai.top/fhrelay → 云端 18082 →(WS)→ ssh 本地转发 18081 → relay 客户端 → 本机 fhcode(8082)
 * 每 60 秒探测云端通道；断线自动重建 ssh 转发 + relay 客户端；bridge 未在线自动重拉。
 *
 * 关键点：
 *  1. RELAY_NO_SSH=1 只是不让 relay 自建 ssh，ssh 18081 本地转发仍必须存在；
 *  2. fhcode bridge start 依赖 stdin 存活（stdin EOF 即退出），
 *     必须由本常驻父进程以 stdio:['pipe',...] 持有其 stdin，不能 stdio:'ignore'；
 *  3. 独立运行：node dist/web/cloud-keepalive.js（开机自启 vbs 拉起，脱离任何会话沙箱）；
 *  4. 服务内置：serve 进程设 FH_CLOUD_KEEPALIVE=1 后随 listen 自动启动。
 */
import { execSync, spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SSH_EXE = 'C:/Windows/System32/OpenSSH/ssh.exe';
const SSH_KEY = path.join(os.homedir(), '.ssh', 'id_ed25519');
const CLOUD_URL = 'https://api.klai.top/fhrelay/api/bridge/devices';
const TOKEN = '30587308defe825b6c59526355d6f7c3ba5e9323f787e074c9d962646c68f77a';
const BRIDGE_DEVICE = 'pc-mtx94tmu-fwqja0';
const LOCK_PORT = 18777;
const TICK_MS = 60_000;
const LOG = path.join(os.tmpdir(), 'fhrelay_keepalive.log');

function log(msg: string): void {
  try { fs.appendFileSync(LOG, `[${new Date().toLocaleString('zh-CN')}] ${msg}\n`); } catch { /* ignore */ }
}

let relayChild: ChildProcess | null = null;
let bridgeChild: ChildProcess | null = null;

function killPort(port: number): number {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set<string>();
    out.split('\n').forEach((l) => {
      const m = l.trim().split(/\s+/);
      if (m.length >= 5 && /LISTENING|ESTABLISHED/i.test(l)) pids.add(m[4]);
    });
    pids.forEach((pid) => { try { process.kill(Number(pid), 'SIGTERM'); } catch { /* ignore */ } });
    return pids.size;
  } catch { return 0; }
}

function spawnSsh(): void {
  const ch = spawn(SSH_EXE, ['-N', '-L', '18081:127.0.0.1:18081',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-i', SSH_KEY, 'root@111.229.190.132'], {
    detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
  });
  ch.unref();
  log(`ssh 转发已拉起 pid=${ch.pid}`);
}

function spawnRelay(): void {
  relayChild = spawn(process.execPath, ['cloud-agent/fh-relay-client.js'], {
    cwd: ROOT, detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
    env: Object.assign({}, process.env, { RELAY_NO_SSH: '1' }),
  });
  relayChild.unref();
  relayChild.on('exit', () => { relayChild = null; });
  log(`relay 已拉起 pid=${relayChild.pid}`);
}

function spawnBridge(): void {
  bridgeChild = spawn(process.execPath, ['dist/cli/index.js', 'bridge', 'start'], {
    cwd: ROOT, detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
    env: Object.assign({}, process.env, {
      FH_BRIDGE_URL: 'http://127.0.0.1:8082',
      FH_BRIDGE_TOKEN: TOKEN,
    }),
  });
  bridgeChild.unref();
  bridgeChild.on('exit', () => { bridgeChild = null; });
  log(`bridge 已拉起 pid=${bridgeChild.pid}`);
}

function probe(url: string, timeoutSec: number): string {
  try {
    return execSync(`curl -s -m ${timeoutSec} -H "Authorization: Bearer ${TOKEN}" "${url}"`, { encoding: 'utf8' }) || '';
  } catch { return ''; }
}

async function tick(): Promise<void> {
  const body = probe(CLOUD_URL, 10);
  const tunnelDown = !body || body.includes('家里电脑未连接') || body.includes('隧道未建立');

  if (tunnelDown) {
    log('通道断开，重建隧道（ssh 转发 + relay）...');
    if (relayChild) { try { relayChild.kill(); } catch { /* ignore */ } relayChild = null; }
    killPort(18081);
    await new Promise((r) => setTimeout(r, 2000));
    spawnSsh();
    await new Promise((r) => setTimeout(r, 4000));
    spawnRelay();
    await new Promise((r) => setTimeout(r, 6000));
  }

  // bridge 双保险：云端 devices 里设备在线才视为正常
  const body2 = tunnelDown ? probe(CLOUD_URL, 10) : body;
  const bridgeOnline = body2.includes(BRIDGE_DEVICE);
  if (!bridgeOnline) {
    log('bridge 未在线，重拉...');
    if (bridgeChild) { try { bridgeChild.kill(); } catch { /* ignore */ } bridgeChild = null; }
    spawnBridge();
  }

  log(`巡检: ${tunnelDown ? '隧道已重建' : '链路正常'} bridge=${bridgeOnline ? '在线' : '重拉'}`);
}

/** 启动保活循环（带单实例锁，重复启动自动退出） */
export function startCloudKeepalive(): void {
  const lock = net.createServer();
  lock.on('error', () => { log('另一实例已运行（锁端口占用），本实例退出'); });
  lock.listen(LOCK_PORT, '127.0.0.1', () => {
    log('=== fh-keepalive 启动（每 60 秒巡检） ===');
    const loop = async (): Promise<void> => {
      for (;;) {
        try { await tick(); } catch (e) { log('巡检异常: ' + (e as Error).message); }
        await new Promise((r) => setTimeout(r, TICK_MS));
      }
    };
    void loop();
  });
}

// 直接运行（node dist/web/cloud-keepalive.js）时无条件启动
if (require.main === module) {
  startCloudKeepalive();
}

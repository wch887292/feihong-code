#!/usr/bin/env node
/**
 * 飞虹云中转隧道保活（node 常驻版，替代 隧道保活.cmd）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
 *
 * 链路：手机 → api.klai.top/fhrelay → 云端 18082 →(WS)→ ssh 本地转发 18081 → relay 客户端 → 本机 fhcode(8082)
 * 每 60 秒探测云端通道；断线自动重建：ssh 转发 + relay 客户端；bridge 未在线自动重拉。
 *
 * 关键点：
 *  1. RELAY_NO_SSH=1 只是不让 relay 自建 ssh，ssh 18081 转发仍必须存在；
 *  2. fhcode bridge start 依赖 stdin 存活（EOF 即退出），必须由本常驻父进程 stdio:['pipe',...] 持有其 stdin；
 *  3. 本脚本必须以"无沙箱隔离"方式启动（开机自启 vbs 天然满足），沙箱内启动的分离进程会被沙箱回收。
 * 用法：node cloud-agent/fh-keepalive.js
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SSH_EXE = process.env.FH_SSH_EXE || 'C:/Windows/System32/OpenSSH/ssh.exe';
const SSH_KEY = process.env.FH_SSH_KEY || path.join(process.env.USERPROFILE || '', '.ssh', 'id_ed25519');
const CLOUD_URL = process.env.FH_CLOUD_URL || 'https://api.klai.top/fhrelay/api/bridge/devices';
const BRIDGE_DEVICE = process.env.FH_BRIDGE_DEVICE || ''; // 设备 ID 由启动脚本注入，仓库不含真实值
const SERVER_IP = process.env.FH_SERVER_IP || ''; // SSH 转发目标服务器，由启动脚本注入，仓库不含真实 IP
const LOCK_PORT = 18777;
const LOG = path.join(os.tmpdir(), 'fhrelay_keepalive.log');

// 敏感令牌不从源码读取：优先环境变量，其次 ~/.feihong-code/web-token.json（服务端持久化文件）
function resolveToken() {
  if (process.env.FH_BRIDGE_TOKEN || process.env.FH_KEEPALIVE_TOKEN) {
    return process.env.FH_BRIDGE_TOKEN || process.env.FH_KEEPALIVE_TOKEN;
  }
  try {
    const home = process.env.FH_HOME || os.homedir();
    const tokenFile = path.join(home, '.feihong-code', 'web-token.json');
    if (fs.existsSync(tokenFile)) {
      const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      if (saved && saved.token) return saved.token;
    }
  } catch (e) {}
  return '';
}
const TOKEN = resolveToken();

function log(msg) {
  try { fs.appendFileSync(LOG, `[${new Date().toLocaleString('zh-CN')}] ${msg}\n`); } catch (e) {}
}

/* ---- 单实例锁：端口被占则带日志退出 ---- */
const lockServer = net.createServer();
lockServer.on('error', (e) => { log(`另一实例已运行（锁端口占用），本实例退出: ${e.code}`); process.exit(0); });

let relayChild = null;
let bridgeChild = null;

function portListening(port) {
  try { return /LISTENING/i.test(execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })); }
  catch (e) { return false; }
}

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set();
    out.split('\n').forEach(l => {
      const m = l.trim().split(/\s+/);
      if (m.length >= 5 && /LISTENING|ESTABLISHED/i.test(l)) pids.add(m[4]);
    });
    pids.forEach(pid => { try { process.kill(Number(pid), 'SIGTERM'); } catch (e) {} });
    return pids.size;
  } catch (e) { return 0; }
}

function spawnSsh() {
  if (!SERVER_IP) { log('[安全] 未配置 FH_SERVER_IP，跳过 ssh 转发'); return; }
  const ch = spawn(SSH_EXE, ['-N', '-L', '18081:127.0.0.1:18081',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-i', SSH_KEY, `root@${SERVER_IP}`], {
    detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
  });
  ch.unref();
  log(`ssh 转发已拉起 pid=${ch.pid}`);
}

function spawnRelay() {
  relayChild = spawn(process.execPath, ['cloud-agent/fh-relay-client.js'], {
    cwd: ROOT, detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
    env: Object.assign({}, process.env, { RELAY_NO_SSH: '1' }),
  });
  relayChild.unref();
  relayChild.on('exit', () => { relayChild = null; });
  log(`relay 已拉起 pid=${relayChild.pid}`);
}

function spawnBridge() {
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

function probe(url, timeoutSec) {
  try {
    return execSync(`curl -s -m ${timeoutSec} -H "Authorization: Bearer ${TOKEN}" "${url}"`, { encoding: 'utf8' }) || '';
  } catch (e) { return ''; }
}

async function tick() {
  const body = probe(CLOUD_URL, 10);
  const tunnelDown = !body || body.includes('家里电脑未连接') || body.includes('隧道未建立');

  if (tunnelDown) {
    log('通道断开，重建隧道（ssh 转发 + relay）...');
    if (relayChild) { try { relayChild.kill(); } catch (e) {} relayChild = null; }
    killPort(18081);
    await new Promise(r => setTimeout(r, 2000));
    spawnSsh();
    await new Promise(r => setTimeout(r, 4000));
    spawnRelay();
    await new Promise(r => setTimeout(r, 6000));
  }

  // bridge 双保险：云端 devices 里设备在线才视为正常
  const body2 = tunnelDown ? probe(CLOUD_URL, 10) : body;
  const bridgeOnline = body2.includes(BRIDGE_DEVICE);
  if (!bridgeOnline) {
    log('bridge 未在线，重拉...');
    if (bridgeChild) { try { bridgeChild.kill(); } catch (e) {} bridgeChild = null; }
    spawnBridge();
  }

  log(`巡检: ${tunnelDown ? '隧道已重建' : '链路正常'} bridge=${bridgeOnline ? '在线' : '重拉'}`);
}

lockServer.listen(LOCK_PORT, '127.0.0.1', () => {
  log('=== fh-keepalive 启动（每 60 秒巡检） ===');
  (async function loop() {
    for (;;) {
      try { await tick(); } catch (e) { log('巡检异常: ' + e.message); }
      await new Promise(r => setTimeout(r, 60000));
    }
  })();
});

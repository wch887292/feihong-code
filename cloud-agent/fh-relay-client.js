/**
 * 飞虹Code 云中转隧道客户端（家里电脑侧常驻）
 * ------------------------------------------------------------
 * 公司：晋江市飞虹智科技企业管理有限公司
 * 中心：飞扬企源研发中心
 * 负责人：吴赐虹
 * ------------------------------------------------------------
 * 作用：手机 → https://api.klai.top/fhrelay（云端18082）
 *       → WS隧道(18081，经SSH本地转发) → 本脚本 → 家里电脑 fhcode(8082)
 *
 * 特性：
 *  1. 自动拉起 SSH 本地转发（18081 → 云端 18081），掉线自动重建
 *  2. WS 断线自动重连（指数退避，上限 30s）
 *  3. 请求转发到 http://127.0.0.1:8082（可用 FH_PC_TARGET 覆盖）
 *  4. 日志同时打印并追加到 fh-relay-client.log
 *
 * 启动：node fh-relay-client.js
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

let WebSocket;
try { WebSocket = require('ws'); } catch (e) {
  console.error('[fatal] 缺少 ws 包，请先在 cloud-agent 目录执行: npm install ws');
  process.exit(1);
}

// ============ 配置 ============
const SERVER_IP = process.env.RELAY_SERVER_IP || '111.229.190.132';
const SSH_KEY = process.env.RELAY_SSH_KEY || path.join(process.env.USERPROFILE || '', '.ssh', 'id_ed25519');
const CTRL_LOCAL_PORT = Number(process.env.RELAY_CTRL_LOCAL_PORT || 18081);
const TOKEN = process.env.RELAY_TOKEN || 'fhqy-relay-7Qm2xK9vLp4Rd8Wh3Ns6Tb1Yc5Ae0Zf';
const TUNNEL_NAME = process.env.RELAY_TUNNEL || 'home-pc';
const TARGET = process.env.FH_PC_TARGET || 'http://127.0.0.1:8082';
const LOG_FILE = path.join(__dirname, 'fh-relay-client.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ============ SSH 本地转发（18081 通道） ============
let sshChild = null;
const NO_SSH = !!process.env.RELAY_NO_SSH; // 已有外部 SSH 转发时跳过自带转发
function ensureSshTunnel() {
  if (NO_SSH) return;
  if (sshChild && sshChild.exitCode === null) return; // 还活着
  log(`[ssh] 启动 SSH 本地转发 127.0.0.1:${CTRL_LOCAL_PORT} → ${SERVER_IP}:18081`);
  // 若已通过 ssh-agent 提供密钥（SSH_AUTH_SOCK 或 RELAY_USE_AGENT），则省略 -i，避免直接读私钥文件
  const useAgent = !!(process.env.SSH_AUTH_SOCK || process.env.RELAY_USE_AGENT);
  const sshBase = ['-N', '-L', `${CTRL_LOCAL_PORT}:127.0.0.1:18081`];
  const sshOpts = [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=10',
  ];
  const sshArgs = useAgent
    ? [...sshBase, ...sshOpts, `root@${SERVER_IP}`]
    : [...sshBase, '-i', SSH_KEY, ...sshOpts, `root@${SERVER_IP}`];
  if (useAgent) log('[ssh] 使用 ssh-agent 提供密钥（不读私钥文件）');
  sshChild = spawn('ssh', sshArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  sshChild.stderr.on('data', (d) => {
    const s = String(d).trim();
    if (s && !/Warning: Permanently added/.test(s)) log(`[ssh] ${s}`);
  });
  sshChild.on('exit', (code) => {
    log(`[ssh] 退出 code=${code}，3 秒后重建`);
    setTimeout(() => { ensureSshTunnel(); reconnectWs(0); }, 3000);
  });
}

// ============ WS 隧道客户端 ============
let ws = null;
let wsRetry = 0;
let reconnectTimer = null;

function reconnectWs(delayMs) {
  if (reconnectTimer) return;
  const d = delayMs != null ? delayMs : Math.min(30000, 1000 * Math.pow(2, wsRetry++));
  log(`[ws] ${d}ms 后重连`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWs(); }, d);
}

function connectWs() {
  // 端口探测：SSH 转发没就绪就稍等
  const url = `ws://127.0.0.1:${CTRL_LOCAL_PORT}`;
  let opened = false;
  try {
    ws = new WebSocket(url, { handshakeTimeout: 8000 });
  } catch (e) {
    log(`[ws] 创建失败: ${e.message}`);
    return reconnectWs();
  }

  ws.on('open', () => {
    opened = true;
    wsRetry = 0;
    log(`[ws] 已连接 ${url}，注册隧道 ${TUNNEL_NAME}`);
    ws.send(JSON.stringify({ t: 'register', token: TOKEN, name: TUNNEL_NAME }));
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (msg.t === 'register') {
      if (msg.ok) log(`[ws] 隧道注册成功 ✅ (手机现在可通过 https://api.klai.top/fhrelay 访问)`);
      else { log(`[ws] 注册被拒: ${msg.err || 'unknown'}，10s 后重试`); return reconnectWs(10000); }
    } else if (msg.t === 'req') {
      handleReq(msg);
    }
  });

  ws.on('close', () => { if (opened) log('[ws] 连接关闭'); ws = null; reconnectWs(); });
  ws.on('error', (e) => {
    if (!opened) log(`[ws] 连不上（SSH 转发未就绪或云端未监听）: ${e.message}`);
    else log(`[ws] 错误: ${e.message}`);
  });
}

// ============ 请求转发 → 家里电脑 fhcode 8082 ============
function handleReq(msg) {
  const chunks = [];
  const body = msg.bodyB64 ? Buffer.from(msg.bodyB64, 'base64') : null;
  const u = new URL(TARGET);
  const headers = Object.assign({}, msg.headers || {});
  headers.host = `${u.hostname}:${u.port}`; // 重写 host，避免 vhost 路由错乱
  delete headers['content-length'];
  if (body && body.length) headers['content-length'] = String(body.length);

  const options = {
    hostname: u.hostname,
    port: u.port || 80,
    path: msg.path || '/',
    method: msg.method || 'GET',
    headers,
    timeout: 25000,
  };

  const upstream = http.request(options, (res) => {
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const buf = Buffer.concat(chunks);
      sendRes(msg.id, res.statusCode, res.headers, buf);
    });
  });
  upstream.on('timeout', () => { upstream.destroy(new Error('upstream timeout')); });
  upstream.on('error', (e) => {
    log(`[fwd] 上游错误 ${msg.method} ${msg.path}: ${e.message}`);
    sendRes(msg.id, 502, { 'content-type': 'application/json' },
      Buffer.from(JSON.stringify({ ok: false, err: `home-pc upstream error: ${e.message}` })));
  });
  if (body && body.length) upstream.write(body);
  upstream.end();
}

function sendRes(id, status, headers, buf) {
  if (!ws || ws.readyState !== 1) { log('[fwd] ws 已断，响应丢弃'); return; }
  // 复制 headers 防止上游对象被修改；去掉逐跳头
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (/^connection$|^keep-alive$|^transfer-encoding$|^upgrade$/i.test(k)) continue;
    h[k] = v;
  }
  try { ws.send(JSON.stringify({ t: 'res', id, status, headers: h, bodyB64: buf.toString('base64') })); }
  catch (e) { log(`[fwd] 回包失败: ${e.message}`); }
}

// ============ 主流程 ============
process.on('uncaughtException', (e) => log(`[uncaught] ${e.stack || e.message}`));
process.on('unhandledRejection', (e) => log(`[rejection] ${e}`));

log('=== 飞虹云中转隧道客户端启动 ===');
ensureSshTunnel();
setTimeout(() => connectWs(), 2000); // 给 SSH 转发 2 秒建立时间
setInterval(() => { ensureSshTunnel(); }, 15000); // 兜底巡检

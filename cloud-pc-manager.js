#!/usr/bin/env node
/**
 * fhcode 云电脑实例编排器（按需创建 / 销毁 / 切换）
 * ------------------------------------------------------------
 * 作为「云电脑管理器」设备注册到 fhcode bridge，手机端可直接对它说：
 *   - 创建云电脑 [名称]      → 新建一个云电脑实例（自动择优 Mode A 视觉桌面 / Mode B 无头沙箱）
 *   - 列出云电脑            → 列出所有实例与在线状态、连接地址
 *   - 销毁云电脑 <序号|设备ID> → 销毁指定实例
 *   - 连接云电脑 <序号>      → 返回该实例的 noVNC 连接地址（视觉桌面模式）
 *
 * 同时提供本地 HTTP API（Bearer 鉴权），供移动端/脚本直接调用：
 *   GET  http://127.0.0.1:<HTTP_PORT>/api/cloudpc/list
 *   POST http://127.0.0.1:<HTTP_PORT>/api/cloudpc/create   { name? }
 *   POST http://127.0.0.1:<HTTP_PORT>/api/cloudpc/destroy  { id|deviceId }
 *   POST http://127.0.0.1:<HTTP_PORT>/api/cloudpc/url       { id|deviceId }
 *
 * 实例类型：
 *   Mode A（视觉桌面 / KasmVNC-CVD）：若镜像 FH_PC_IMAGE 存在，docker run 一个带桌面的容器，
 *            容器内启动 Xvfb+VNC+noVNC+本实例 cloud-agent，手机可在 noVNC 里看到并操作真实桌面。
 *   Mode B（无头隔离沙箱，永远可用）：fork 一个 cloud-agent.js 进程，分配独立工作目录与 deviceId，
 *            手机可对其下发文件/命令/系统状态等指令（无图形界面，截图会明确报错）。
 *
 * 零第三方依赖，仅用 Node 内置模块。Node >= 18。
 */
'use strict';

const { spawn, execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ===================== 配置 =====================
const C = {
  BRIDGE_URL: (process.env.FH_BRIDGE_URL || 'http://127.0.0.1:18080').replace(/\/+$/, ''),
  TOKEN: process.env.FH_BRIDGE_TOKEN || '',
  MANAGER_ID: process.env.FH_PC_MANAGER_ID || 'pc-cloud-manager',
  MANAGER_NAME: process.env.FH_PC_MANAGER_NAME || '☁️ 云电脑管理器',
  WORKDIR_BASE: path.resolve(process.env.FH_PC_WORKDIR_BASE || path.join(os.homedir(), 'fhcode-cloud-pcs')),
  IMAGE: process.env.FH_PC_IMAGE || 'fhcode-cloudpc:latest',
  NOVNC_HOST: process.env.FH_PC_NOVNC_PUBLIC_HOST || 'api.klai.top',
  NOVNC_BASE_PORT: Number(process.env.FH_PC_NOVNC_BASE_PORT) || 6080,
  MAX: Number(process.env.FH_PC_MAX) || 3,
  IDLE_TTL_MIN: Number(process.env.FH_PC_IDLE_TTL_MIN) || 120,
  HTTP_PORT: Number(process.env.FH_PC_HTTP_PORT) || 18100,
  AGENT_JS: path.resolve(process.env.FH_PC_AGENT_JS || path.join(__dirname, 'cloud-agent', 'cloud-agent.js')),
  STATE_FILE: path.resolve(process.env.FH_PC_STATE_FILE || path.join(os.homedir(), '.fhcode-cloudpc-state.json')),
  FORCE_HEADLESS: process.env.FH_PC_DOCKER === '0',
};

const POLL_INTERVAL_MS = 3000;
const MAX_RESULT_LEN = 6000;

function log(msg) {
  console.log(`[cloud-pc-manager ${new Date().toISOString()}] ${msg}`);
}

// ===================== Docker 探测 =====================
function dockerAvailable() {
  try {
    const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 8000 });
    return r.status === 0;
  } catch {
    return false;
  }
}
function dockerImageExists(img) {
  try {
    const r = spawnSync('docker', ['image', 'inspect', img], { timeout: 8000 });
    return r.status === 0;
  } catch {
    return false;
  }
}
const DOCKER_OK = !C.FORCE_HEADLESS && dockerAvailable();
const DESKTOP_IMAGE_OK = DOCKER_OK && dockerImageExists(C.IMAGE);

// ===================== 状态持久化 =====================
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(C.STATE_FILE, 'utf8'));
    s.instances = s.instances || [];
    s.nextSeq = s.nextSeq || 1;
    return s;
  } catch {
    return { instances: [], nextSeq: 1 };
  }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(C.STATE_FILE), { recursive: true });
  fs.writeFileSync(C.STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}
let STATE = loadState();

// ===================== HTTP 客户端（零依赖 + HMAC 签名，与 cloud-agent 一致） =====================
function signRequest(secret, bodyRaw, ts, nonce) {
  return crypto.createHmac('sha256', secret).update(`${ts}|${nonce}|${bodyRaw}`).digest('hex');
}
function bridgeRequest(method, urlPath, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(C.BRIDGE_URL + urlPath);
    const httpMod = url.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json' };
    if (C.TOKEN) headers.Authorization = 'Bearer ' + C.TOKEN;
    let payload = null;
    if (bodyObj !== undefined) {
      payload = JSON.stringify(bodyObj);
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const bodyRaw = bodyObj !== undefined ? payload : '{}';
      if (C.TOKEN) {
        const ts = String(Date.now());
        const nonce = crypto.randomBytes(12).toString('hex');
        headers['x-fh-ts'] = ts;
        headers['x-fh-nonce'] = nonce;
        headers['x-fh-sig'] = signRequest(C.TOKEN, bodyRaw, ts, nonce);
      }
    }
    const req = httpMod.request(url, { method, headers, timeout: timeoutMs || 15000 }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data || {});
        else reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ===================== 实例生命周期 =====================
async function createInstance(name) {
  if (STATE.instances.filter((i) => i.status !== 'destroyed').length >= C.MAX) {
    return { ok: false, error: `已达最大实例数 ${C.MAX}，请先销毁部分实例` };
  }
  const seq = STATE.nextSeq++;
  const deviceId = `pc-cloud-${seq}`;
  const displayName = name ? String(name).slice(0, 20) : `云电脑 ${seq}`;
  const workdir = path.join(C.WORKDIR_BASE, deviceId);
  fs.mkdirSync(workdir, { recursive: true });

  const inst = {
    seq, deviceId, name: displayName, mode: null,
    workdir, containerId: null, pid: null,
    novncPort: null, novncUrl: null,
    createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
    status: 'creating',
  };

  if (DESKTOP_IMAGE_OK) {
    // ---- Mode A：视觉桌面容器 ----
    const novncPort = C.NOVNC_BASE_PORT + seq; // 每个实例占用一个宿主机端口
    try {
      const r = spawnSync('docker', [
        'run', '-d', '--name', `fhcode-cloudpc-${seq}`, '--rm',
        '-e', `FH_BRIDGE_URL=${C.BRIDGE_URL}`, '-e', `FH_BRIDGE_TOKEN=${C.TOKEN}`,
        '-e', `FH_CLOUD_DEVICE_ID=${deviceId}`, '-e', `FH_CLOUD_NAME=${displayName}`,
        '-e', `FH_CLOUD_WORKDIR=${workdir}`, '-e', 'DISPLAY=:1', '-e', 'VNC_PORT=5901', '-e', 'NOVNC_PORT=6080',
        '-p', `${novncPort}:6080`, C.IMAGE,
      ], { timeout: 60000 });
      if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').toString().slice(0, 200));
      inst.containerId = (r.stdout || '').toString().trim().slice(0, 12);
      inst.mode = 'desktop';
      inst.novncPort = novncPort;
      inst.novncUrl = `http://${C.NOVNC_HOST}:${novncPort}/vnc.html?autoconnect=true&resize=scale`;
    } catch (e) {
      return { ok: false, error: '视觉桌面容器启动失败: ' + e.message };
    }
  } else {
    // ---- Mode B：无头隔离 agent 进程 ----
    const child = spawn(process.execPath, [C.AGENT_JS], {
      env: {
        ...process.env,
        FH_BRIDGE_URL: C.BRIDGE_URL, FH_BRIDGE_TOKEN: C.TOKEN,
        FH_CLOUD_DEVICE_ID: deviceId, FH_CLOUD_NAME: displayName, FH_CLOUD_WORKDIR: workdir,
      },
      cwd: workdir,
      stdio: 'ignore',
      detached: true,
    });
    inst.pid = child.pid;
    inst.mode = 'headless';
    child.unref();
  }

  inst.status = 'running';
  STATE.instances.push(inst);
  saveState(STATE);
  const extra = inst.mode === 'desktop'
    ? `\n🌐 视觉桌面连接地址：${inst.novncUrl}\n   在浏览器/手机打开即可看到并操作该云电脑。`
    : `\n（无头沙箱模式：可对其下发文件/命令/系统状态等指令；视觉桌面镜像就绪后自动升级为带桌面的云电脑）`;
  return {
    ok: true,
    result: {
      action: 'cloudpc-created',
      deviceId, mode: inst.mode, name: displayName, novncUrl: inst.novncUrl || '',
      text: `✅ 已创建${inst.mode === 'desktop' ? '视觉桌面' : '无头'}云电脑「${displayName}」\n设备ID：${deviceId}\n在手机端设备列表中选择它即可下发指令。${extra}`,
    },
  };
}

function getInstance(ref) {
  return STATE.instances.find((i) =>
    (i.seq === Number(ref) || String(i.deviceId) === String(ref) || `#${i.seq}` === String(ref))
  );
}

async function destroyInstance(ref) {
  const inst = getInstance(ref);
  if (!inst) return { ok: false, error: `未找到实例：${ref}` };
  try {
    if (inst.mode === 'desktop' && inst.containerId) {
      spawnSync('docker', ['rm', '-f', `fhcode-cloudpc-${inst.seq}`], { timeout: 20000 });
    } else if (inst.mode === 'headless' && inst.pid) {
      try { process.kill(-inst.pid, 'SIGKILL'); } catch { try { process.kill(inst.pid, 'SIGKILL'); } catch {} }
    }
  } catch (e) {
    return { ok: false, error: '销毁失败: ' + e.message };
  }
  // 注销 bridge 设备，避免手机端残留僵尸设备
  try {
    await bridgeRequest('DELETE', '/api/bridge/devices/' + encodeURIComponent(inst.deviceId));
  } catch (e) {
    log('注销设备失败(可忽略): ' + e.message);
  }
  inst.status = 'destroyed';
  inst.destroyedAt = new Date().toISOString();
  saveState(STATE);
  return { ok: true, result: { action: 'cloudpc-destroyed', deviceId: inst.deviceId, text: `🗑️ 已销毁云电脑「${inst.name}」(${inst.deviceId})` } };
}

async function urlOf(ref) {
  const inst = getInstance(ref);
  if (!inst) return { ok: false, error: `未找到实例：${ref}` };
  if (inst.mode !== 'desktop' || !inst.novncUrl) return { ok: false, error: '该实例为无头模式，无视觉桌面连接地址' };
  return { ok: true, result: { action: 'cloudpc-url', deviceId: inst.deviceId, text: `🌐 ${inst.name} 连接地址：${inst.novncUrl}` } };
}

async function listInstances() {
  let onlineMap = {};
  try {
    const d = await bridgeRequest('GET', '/api/bridge/devices');
    (d.devices || []).forEach((x) => { onlineMap[x.deviceId] = x.status; });
  } catch {}
  const lines = STATE.instances
    .filter((i) => i.status !== 'destroyed')
    .map((i) => {
      const online = onlineMap[i.deviceId] === 'online' ? '🟢在线' : '⚪离线';
      const conn = i.mode === 'desktop' ? `\n     连接: ${i.novncUrl}` : '';
      return `  #${i.seq} ${i.name} | ${i.deviceId} | ${i.mode === 'desktop' ? '视觉桌面' : '无头沙箱'} | ${online}${conn}`;
    });
  const head = `当前云电脑实例（共 ${STATE.instances.filter((i) => i.status !== 'destroyed').length} 个，上限 ${C.MAX}）：`;
  const body = lines.length ? lines.join('\n') : '  （暂无，发「创建云电脑」即可新建）';
  const tip = `\n\n能力：${DESKTOP_IMAGE_OK ? '✅ 视觉桌面镜像已就绪（创建即带真实桌面）' : '⚠️ 视觉桌面镜像未构建，当前为无头沙箱模式（构建 fhcode-cloudpc:latest 后自动启用）'}`;
  return { ok: true, result: { action: 'cloudpc-list', text: head + '\n' + body + tip } };
}

// ===================== 自然语言指令解析（管理器自身） =====================
async function handleManagerCommand(text) {
  const t = String(text || '').trim();
  if (/^创建|新建|开(一个|台)?云电脑|create/i.test(t)) {
    const m = t.match(/云电脑\s*(.+)$/i) || t.match(/create\s+(.+)$/i);
    const name = m ? m[1].replace(/[，。\.].*$/, '').trim() : '';
    return await createInstance(name);
  }
  if (/列出|列表|查看.*云电脑|list/i.test(t)) return await listInstances();
  if (/连接|打开.*云电脑|url|connect/i.test(t)) {
    const m = t.match(/云电脑\s*#?(\d+)/i) || t.match(/(?:连接|url|connect)\s*#?(\d+)/i);
    if (m) return await urlOf(m[1]);
    return { ok: false, error: '请指定要连接的云电脑序号，例如「连接云电脑 1」' };
  }
  if (/销毁|删除|关(闭)?云电脑|destroy|delete|remove/i.test(t)) {
    const m = t.match(/云电脑\s*#?([\w-]+)/i) || t.match(/(?:销毁|删除|destroy|delete|remove)\s*#?([\w-]+)/i);
    if (m) return await destroyInstance(m[1]);
    return { ok: false, error: '请指定要销毁的云电脑序号或设备ID，例如「销毁云电脑 1」' };
  }
  // 兜底：列出
  return await listInstances();
}

// ===================== 空闲过期清理 =====================
async function sweepIdle() {
  const now = Date.now();
  for (const inst of STATE.instances) {
    if (inst.status !== 'running') continue;
    const idleMin = (now - new Date(inst.lastActiveAt).getTime()) / 60000;
    if (idleMin > C.IDLE_TTL_MIN) {
      log(`实例 #${inst.seq} 空闲 ${idleMin.toFixed(0)} 分钟，超过 TTL，自动销毁`);
      await destroyInstance(inst.seq);
    }
  }
}

// ===================== 本地 HTTP API =====================
function startHttpApi() {
  const server = http.createServer((req, res) => {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== C.TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: '未授权' })); return;
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let p = {};
      try { p = body ? JSON.parse(body) : {}; } catch {}
      let out;
      try {
        if (req.method === 'GET' && req.url === '/api/cloudpc/list') out = await listInstances();
        else if (req.method === 'POST' && req.url === '/api/cloudpc/create') out = await createInstance(p.name);
        else if (req.method === 'POST' && req.url === '/api/cloudpc/destroy') out = await destroyInstance(p.id || p.deviceId);
        else if (req.method === 'POST' && req.url === '/api/cloudpc/url') out = await urlOf(p.id || p.deviceId);
        else { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: '未知接口' })); return; }
      } catch (e) { out = { ok: false, error: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(C.HTTP_PORT, '127.0.0.1', () => log(`本地 HTTP API 已启动: 127.0.0.1:${C.HTTP_PORT}`));
}

// ===================== 管理器自身 bridge 长轮询 =====================
async function main() {
  fs.mkdirSync(C.WORKDIR_BASE, { recursive: true });
  log(`云电脑管理器启动 | 模式: ${DESKTOP_IMAGE_OK ? '视觉桌面(A)+无头(B)' : '无头(B)'} | 镜像: ${C.IMAGE} | 上限: ${C.MAX}`);
  log(`工作目录基址: ${C.WORKDIR_BASE} | 管理器设备: ${C.MANAGER_ID}`);

  // 注册管理器自身
  try {
    const r = await bridgeRequest('POST', '/api/bridge/register', { deviceId: C.MANAGER_ID, name: C.MANAGER_NAME });
    log('管理器注册: ' + (r.ok ? 'ok' : JSON.stringify(r)));
  } catch (e) {
    log('❌ 管理器注册失败: ' + e.message + '（请检查 FH_BRIDGE_URL / FH_BRIDGE_TOKEN）');
    process.exitCode = 1; return;
  }

  startHttpApi();

  // 空闲清理定时器
  setInterval(() => { sweepIdle().catch(() => {}); }, 60 * 1000);

  let running = true;
  const stop = () => { running = false; log('收到停止信号，清理实例…'); STATE.instances.filter((i) => i.status === 'running').forEach((i) => destroyInstance(i.seq).catch(() => {})); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  log('开始长轮询管理器指令（手机端可对「云电脑管理器」说：创建云电脑 / 列出云电脑 / 连接云电脑 1 / 销毁云电脑 1）…');
  while (running) {
    try {
      const data = await bridgeRequest('GET', '/api/bridge/pending?deviceId=' + encodeURIComponent(C.MANAGER_ID));
      const cmd = data && data.command;
      if (cmd && cmd.cmdId) {
        log('收到管理器指令: ' + cmd.text);
        let outcome;
        try { outcome = await handleManagerCommand(cmd.text); }
        catch (e) { outcome = { ok: false, error: e.message }; }
        log(`处理完成: ${outcome.ok ? '成功' : '失败'}（${outcome.result?.action || outcome.error || ''}）`);
        try {
          await bridgeRequest('POST', '/api/bridge/result', {
            cmdId: cmd.cmdId, deviceId: C.MANAGER_ID,
            ok: outcome.ok, result: outcome.result, error: outcome.error,
          });
        } catch (e) { log('回传结果失败: ' + e.message); }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } catch (e) {
      log('轮询出错（' + e.message + '），5 秒后重试');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { createInstance, destroyInstance, listInstances, urlOf, handleManagerCommand, loadState };

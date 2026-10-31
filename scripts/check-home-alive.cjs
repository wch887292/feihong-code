#!/usr/bin/env node
/**
 * fhcode 家电脑保活自检脚本（v8.13.9）
 *
 * 用途：一次性体检「计划任务 → 守护进程 → 8082 → 双 bridge → 云端心跳」整条链路，
 * 定位「手机显示离线」类问题的真实断点，避免每次都靠肉眼看日志。
 *
 * 检查项：
 *   1. Windows 计划任务 FHDirect8082 / FHKeepalive / FHWatchdog 是否存在且执行命令未被损坏
 *   2. 本地 8082 是否健康监听
 *   3. cloud-keepalive 守护进程是否存活（18777 锁）
 *   4. 本地设备表「家里电脑-本地」是否在线（register 死锁检测）
 *   5. 云端中继设备表心跳是否新鲜（≤120s = 在线）
 *   6. 本地 deviceSecret 是否已落盘（决定注册能否自愈）
 *
 * 用法：node scripts/check-home-alive.cjs
 * 退出码：0=全绿，1=存在故障项
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const net = require('net');
const { execFileSync } = require('child_process');

const HOME_ONLINE_MS = 120000;
const FH_HOME = (process.env.FH_HOME || '').trim() || path.join(os.homedir(), '.feihong-code');
const TOKEN_FILE = path.join(FH_HOME, 'web-token.json');
const DEVICES_FILE = path.join(FH_HOME, 'bridge-devices.json');
const SECRET_FILE = path.join(FH_HOME, 'bridge-device-secret');
const DEVICE_ID_FILE = path.join(FH_HOME, 'bridge-device-id');
const KEEPALIVE_LOG = path.join(os.tmpdir(), 'fhrelay_keepalive.log');

const results = [];
function ok(name, detail) { results.push({ pass: true, name, detail }); }
function bad(name, detail) { results.push({ pass: false, name, detail }); }

function readBridgeToken() {
  try {
    const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return saved && saved.bridgeToken ? saved.bridgeToken : '';
  } catch { return ''; }
}

/**
 * schtasks 输出为系统 OEM 代码页（中文 Windows = GBK/CP936），
 * Node 用 utf8 解码会变乱码导致正则匹配失败 → 必须按 buffer 读取后用 gbk 解码。
 * 历史坑：曾因此误判「计划任务执行命令异常（空）」，实际任务完全正常。
 */
function runSchtasks(schtasks, taskName) {
  try {
    const buf = execFileSync(schtasks, ['/query', '/tn', taskName, '/v', '/fo', 'list'], { timeout: 8000 });
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  } catch (e) {
    // 任务不存在时 schtasks 返回非 0，stdout 仍可能含错误信息
    const b = e && e.stdout;
    if (b && b.length) {
      try { return new TextDecoder('gbk').decode(b); } catch { return b.toString('utf8'); }
    }
    return null;
  }
}

/** TCP 端口探测（不依赖 shell，避免路径转义坑） */
function probePort(port, host) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: host || '127.0.0.1' });
    const done = (r) => { try { sock.destroy(); } catch { /* ignore */ } resolve(r); };
    sock.setTimeout(2500);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

function httpGet(host, port, pathname, headers) {
  return new Promise((resolve) => {
    const mod = port === 443 ? https : http;
    const req = mod.request({ host, port, path: pathname, method: 'GET', headers: headers || {}, timeout: 8000 }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
}

async function checkTasks() {
  const schtasks = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'schtasks.exe')
    : 'schtasks';
  const expect = [
    { name: 'FHDirect8082', why: '登录拉起 8082 本地服务' },
    { name: 'FHKeepalive', why: '登录拉起双 bridge + 巡检守护' },
    { name: 'FHWatchdog', why: '每 5 分钟巡检自愈（进程被杀后兜底）' },
  ];
  for (const t of expect) {
    const out = runSchtasks(schtasks, t.name);
    if (out === null) { bad(`计划任务 ${t.name}`, '任务不存在（' + t.why + '）'); continue; }
    // 提取「要运行的任务」行（中文系统），或英文系统
    const m = out.match(/要运行的任务:\s*(.+)/) || out.match(/Task To Run:\s*(.+)/);
    const cmd = m ? m[1].trim() : '';
    // 损坏特征：命令以 "by user disabled" 开头（历史事故：schtasks 创建被打断写坏了命令）
    if (/^by\s+user\s+disabled/i.test(cmd)) {
      bad(`计划任务 ${t.name}`, '执行命令已损坏：' + cmd.slice(0, 90));
    } else if (!cmd || !/\.js/i.test(cmd)) {
      bad(`计划任务 ${t.name}`, '执行命令异常：' + (cmd || '(空)').slice(0, 90));
    } else if (/已禁用|Disabled/i.test(out) && !/已启用|Enabled/i.test(out)) {
      bad(`计划任务 ${t.name}`, '任务被禁用');
    } else {
      ok(`计划任务 ${t.name}`, cmd.replace(/\\/g, '/').slice(0, 100));
    }
  }
}

async function checkLocal() {
  const p8082 = await probePort(8082);
  if (!p8082) { bad('本地 8082 端口', '无监听（服务未启动或已崩溃）'); }
  else {
    const r = await httpGet('127.0.0.1', 8082, '/api/health');
    if (r.status === 200) ok('本地 8082 健康', 'HTTP 200');
    else bad('本地 8082 健康', 'HTTP ' + r.status);
  }

  const pLock = await probePort(18777);
  if (!pLock) bad('保活守护 18777', '锁端口未占用（cloud-keepalive 未运行）');
  else ok('保活守护 18777', '运行中');
}

function checkLocalDevice() {
  if (!fs.existsSync(DEVICES_FILE)) {
    bad('本地设备表', '文件不存在：' + DEVICES_FILE);
    return;
  }
  let list = [];
  try { list = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')) || []; } catch (e) {
    bad('本地设备表', '解析失败：' + e.message); return;
  }
  const local = list.find((d) => String(d.name || '').indexOf('家里电脑-本地') >= 0);
  if (!local) { bad('本地「家里电脑-本地」', '设备表缺失（bridge 注册失败或被清理）'); return; }
  const ts = Date.parse(local.lastSeenAt || '');
  const age = Number.isFinite(ts) ? Math.round((Date.now() - ts) / 1000) : null;
  if (age !== null && age <= HOME_ONLINE_MS / 1000) ok('本地「家里电脑-本地」', '在线，心跳 ' + age + 's 前');
  else bad('本地「家里电脑-本地」', '心跳 ' + (age === null ? '无效' : age + 's 前') + '（超 120s 判离线；若持续 401 说明 register 死锁）');
}

async function checkCloudDevices() {
  const tok = readBridgeToken();
  if (!tok) { bad('云端设备表', 'web-token.json 无 bridgeToken'); return; }
  const r = await httpGet('api.klai.top', 443, '/fhrelay/api/bridge/devices', { Authorization: 'Bearer ' + tok });
  if (r.status !== 200) { bad('云端设备表', 'HTTP ' + r.status); return; }
  let j = {};
  try { j = JSON.parse(r.body); } catch (e) { bad('云端设备表', 'JSON 解析失败'); return; }
  const devs = j.devices || [];
  const now = Date.now();
  let homeOnline = false;
  for (const d of devs) {
    const name = String(d.name || '');
    if (name.indexOf('云端') >= 0) continue;
    const ts = Date.parse(d.lastSeenAt || '');
    const age = Number.isFinite(ts) ? Math.round((now - ts) / 1000) : null;
    const online = age !== null && (now - ts) <= HOME_ONLINE_MS;
    if (online) homeOnline = true;
    console.log('    · ' + name + ' | ' + (online ? '在线' : '离线') + ' | 距今 ' + (age === null ? '?' : age + 's'));
  }
  if (homeOnline) ok('云端「家里电脑」', '在线');
  else bad('云端「家里电脑」', '离线（检查 FHKeepalive 是否在跑 + 网络是否通）');
}

function checkSecret() {
  if (fs.existsSync(SECRET_FILE)) {
    const len = fs.readFileSync(SECRET_FILE, 'utf8').trim().length;
    if (len >= 16) ok('本地 deviceSecret', '已落盘（' + len + ' 字符）');
    else bad('本地 deviceSecret', '内容异常（' + len + ' 字符）');
  } else {
    bad('本地 deviceSecret', '未落盘（首次注册未能下发密钥，register 可能死锁）');
  }
}

function checkKeepaliveLog() {
  if (!fs.existsSync(KEEPALIVE_LOG)) { console.log('    · 保活日志不存在（首次运行属正常）'); return; }
  const txt = fs.readFileSync(KEEPALIVE_LOG, 'utf8');
  // 只看最近 10 分钟的日志（历史 401 是已修复的旧症，不该持续报警）
  const cutoff = Date.now() - 10 * 60 * 1000;
  const recentLines = txt.split(/\r?\n/).filter((l) => {
    const m = l.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (!m) return false;
    const ts = Date.parse(m[1]);
    return Number.isFinite(ts) && ts >= cutoff;
  });
  const m401 = recentLines.filter((l) => l.indexOf('HTTP 401') >= 0);
  if (m401.length >= 3) {
    bad('保活日志 401', '近 10 分钟出现 ' + m401.length + ' 次 HTTP 401（本地 bridge 注册被拒）');
    console.log('    · 片段：' + m401[m401.length - 1].replace(/\s+/g, ' ').slice(0, 220));
  } else if (m401.length > 0) {
    ok('保活日志', '近 10 分钟 ' + m401.length + ' 次 401（观察中）');
  } else {
    ok('保活日志', '近 10 分钟无 401');
  }
}

(async () => {
  console.log('========================================');
  console.log(' fhcode 家电脑保活自检');
  console.log(' ' + new Date().toLocaleString('zh-CN'));
  console.log('========================================\n');

  await checkTasks();
  await checkLocal();
  checkLocalDevice();
  checkSecret();
  await checkCloudDevices();
  checkKeepaliveLog();

  console.log('\n---------------- 结果明细 ----------------');
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log((r.pass ? '✅' : '❌') + ' ' + r.name + ' — ' + r.detail);
  }
  console.log('\n========================================');
  console.log(failed === 0 ? '✅ 全部通过（' + results.length + ' 项）' : '❌ ' + failed + ' 项异常（共 ' + results.length + ' 项）');
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
})();

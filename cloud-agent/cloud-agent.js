#!/usr/bin/env node
/**
 * fhcode 云端无头执行体（路线 A：云电脑）
 * ------------------------------------------------------------
 * 复用 fhcode bridge 协议，伪装成一台「云电脑设备」：
 *   1) register    → POST /api/bridge/register {deviceId, name}
 *   2) 长轮询      → GET  /api/bridge/pending?deviceId=xxx  （取一条 queued → running）
 *   3) 无头执行    → 自然语言指令解析为真实云端动作（文件/脚本/命令/网页/系统状态）
 *   4) 回传结果    → POST /api/bridge/result {cmdId, deviceId, ok, result, error}
 *
 * 环境变量：
 *   FH_BRIDGE_URL      云端 fhcode serve 地址（默认 http://127.0.0.1:18080）
 *   FH_BRIDGE_TOKEN    Bearer 鉴权令牌（与 FH_WEB_TOKEN 一致）
 *   FH_CLOUD_DEVICE_ID 设备 ID（默认 pc-cloud-agent-01）
 *   FH_CLOUD_NAME      设备显示名（默认 ☁️ 云端执行体）
 *   FH_CLOUD_WORKDIR   沙箱工作目录（默认 ~/fhcode-cloud-work）
 *   FH_CLOUD_TIMEOUT   单条指令执行超时秒（默认 30）
 *
 * 无第三方依赖，仅用 Node 内置模块。Node >= 18。
 */
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ===================== 配置 =====================
const CLOUD_URL = (process.env.FH_BRIDGE_URL || 'http://127.0.0.1:18080').replace(/\/+$/, '');
const CLOUD_TOKEN = process.env.FH_BRIDGE_TOKEN || '';
const DEVICE_ID = process.env.FH_CLOUD_DEVICE_ID || 'pc-cloud-agent-01';
const DEVICE_NAME = process.env.FH_CLOUD_NAME || '☁️ 云端执行体';
const WORKDIR = path.resolve(process.env.FH_CLOUD_WORKDIR || path.join(os.homedir(), 'fhcode-cloud-work'));
const CMD_TIMEOUT_MS = (Number(process.env.FH_CLOUD_TIMEOUT) || 30) * 1000;
const POLL_INTERVAL_MS = 3000;
const MAX_RESULT_LEN = 8000;

// 危险命令黑名单（命中即拒绝执行，防止云端 Agent 被恶意指令利用）
const BLOCKED_CMDS = [
  /(^|\s)(rm|rmdir)\s+-[a-z]*[rf][a-z]*\s*(\/\s*|\/\*)/i,   // rm -rf /
  /(^|\s)mkfs/i, /(^|\s)dd\s+if=/i, /(^|\s)shutdown/i,
  /(^|\s)reboot/i, /(^|\s)halt/i, /(^|\s)poweroff/i,
  /(^|\s)init\s+[06]/i, /(^|\s)killall\s/i, /(^|\s)pkill\s/i,
  /(^|\s)chmod\s+-R\s+777\s+\//i, /(^|\s)chown\s+-R/i,
  /(^|\s):\(\)/i, /(^|\s)wget\s+.*\|\s*sh/i, /(^|\s)curl\s+.*\|\s*(ba)?sh/i,
  /(^|\s)systemctl\s+(stop|disable)\s+(docker|nginx|mysql|php|redis)/i,
  /(^|\s)pm2\s+(stop|delete|kill)\s+(?!cloud-agent)/i,
];

function log(msg) {
  console.log(`[cloud-agent ${new Date().toISOString()}] ${msg}`);
}

// ===================== HTTP 客户端（零依赖 + 请求签名） =====================
const crypto = require('crypto');

function signRequest(secret, bodyRaw, ts, nonce) {
  return crypto.createHmac('sha256', secret).update(`${ts}|${nonce}|${bodyRaw}`).digest('hex');
}

function httpRequest(method, urlPath, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(CLOUD_URL + urlPath);
    const httpMod = url.protocol === 'https:' ? require('https') : require('http');
    const headers = { 'Content-Type': 'application/json' };
    if (CLOUD_TOKEN) headers.Authorization = 'Bearer ' + CLOUD_TOKEN;
    let payload = null;
    if (bodyObj !== undefined) {
      payload = JSON.stringify(bodyObj);
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    // 写请求必须带防重放签名（与服务端 verifyRequestSignature 一致）：HMAC(ts|nonce|bodyRaw)
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const bodyRaw = bodyObj !== undefined ? payload : '{}';
      const secret = CLOUD_TOKEN; // 签名密钥与 FH_WEB_TOKEN / FH_SIGN_SECRET 一致
      if (secret) {
        const ts = String(Date.now());
        const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
        headers['x-fh-ts'] = ts;
        headers['x-fh-nonce'] = nonce;
        headers['x-fh-sig'] = signRequest(secret, bodyRaw, ts, nonce);
      }
    }
    const req = httpMod.request(url, { method, headers, timeout: timeoutMs || 15000 }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; if (raw.length > 2 * 1024 * 1024) req.destroy(new Error('响应过大')); });
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

// ===================== 沙箱路径防护 =====================
function safeResolve(relPath) {
  // 所有文件操作必须落在 WORKDIR 内，防止越权访问服务器其它目录
  const abs = path.resolve(WORKDIR, relPath);
  if (abs !== WORKDIR && !abs.startsWith(WORKDIR + path.sep)) {
    throw new Error('路径越界：只允许操作云端工作目录 ' + WORKDIR);
  }
  return abs;
}

// ===================== 命令执行（超时 + 黑名单） =====================
function runCmd(cmdline, opts) {
  return new Promise((resolve, reject) => {
    if (!cmdline || !cmdline.trim()) return reject(new Error('空命令'));
    if (BLOCKED_CMDS.some((re) => re.test(cmdline))) return reject(new Error('指令包含危险操作，已拒绝执行'));
    const timeoutMs = opts?.timeout || CMD_TIMEOUT_MS;
    const isWin = process.platform === 'win32';
    const args = isWin ? ['/d', '/s', '/c', cmdline] : ['-c', cmdline];
    execFile(isWin ? 'cmd' : 'bash', args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      cwd: opts?.cwd || WORKDIR,
      env: { ...process.env, HOME: os.homedir() },
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message || '').toString().trim().slice(0, 1000);
        return reject(new Error(msg || '命令执行失败'));
      }
      resolve(stdout.toString().trim());
    });
  });
}

// ===================== 自然语言 → 云端动作 =====================
async function execute(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: '空指令' };

  // 1) 创建/写入文件： 创建文件 a.txt 内容 你好 | 写文件 data/a.json 内容 {...} | 新建目录 foo
  let m = /^(?:创建|新建|写|写入|生成)(文件|脚本|目录)\s*[:：]?\s*(.+?)(?:\s+(?:内容|内容为|写入内容)\s*[:：]?\s*(.+))?$/i.exec(t);
  if (m) {
    const kind = m[1].toLowerCase();
    const target = m[2].trim();
    const content = (m[3] ?? '').replace(/^['"`]|['"`]$/g, '');
    if (kind === '目录') {
      const dir = safeResolve(target);
      fs.mkdirSync(dir, { recursive: true });
      return { ok: true, result: { action: 'mkdir', path: dir, text: '已创建目录: ' + dir } };
    }
    const file = safeResolve(target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return { ok: true, result: { action: 'write', path: file, bytes: Buffer.byteLength(content), text: `已写入 ${file}（${Buffer.byteLength(content)} 字节）` } };
  }

  // 2) 读取文件： 读取文件 a.txt | 查看文件 data/a.json
  m = /^(?:读取|查看|打开|显示|cat)(文件|脚本)\s*[:：]?\s*(.+)$/i.exec(t);
  if (m) {
    const file = safeResolve(m[2].trim());
    if (!fs.existsSync(file)) return { ok: false, error: '文件不存在: ' + file };
    const content = fs.readFileSync(file, 'utf8');
    const snippet = content.length > MAX_RESULT_LEN ? content.slice(0, MAX_RESULT_LEN) + '\n…(截断)' : content;
    return { ok: true, result: { action: 'read', path: file, text: snippet } };
  }

  // 3) 列出目录： 列出目录 | 查看目录 data | ls
  m = /^(?:列出|查看|浏览)(目录|文件夹)\s*[:：]?\s*(.*)$/i.exec(t);
  if (m || /^(ls|dir)\b/i.test(t)) {
    const rel = m ? ((m[2] || '').trim() || '.') : ((t.replace(/^(ls|dir)\b/i, '').trim()) || '.');
    const dir = safeResolve(rel);
    if (!fs.existsSync(dir)) return { ok: false, error: '目录不存在: ' + dir };
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map((e) =>
      (e.isDirectory() ? '📁 ' : '📄 ') + e.name + (e.isDirectory() ? '/' : '')
    );
    return { ok: true, result: { action: 'ls', path: dir, text: (entries.length ? entries.join('\n') : '（空目录）') } };
  }

  // 4) 执行命令/脚本： 执行命令 ls -la | 运行 python3 test.py | 执行脚本 run.sh
  m = /^(?:执行|运行)(命令|脚本|shell|bash|sh|python|python3|node|npm|pip|git)\s*[:：]?\s*(.+)$/i.exec(t);
  if (m) {
    const runner = m[1].toLowerCase();
    let cmdline = m[2].trim();
    if (runner === 'python' || runner === 'python3') cmdline = 'python3 ' + cmdline;
    else if (runner === 'node') cmdline = 'node ' + cmdline;
    else if (runner === 'npm') cmdline = 'npm ' + cmdline;
    else if (runner === 'pip') cmdline = 'pip3 ' + cmdline;
    else if (runner === 'git') cmdline = 'git ' + cmdline;
    const out = await runCmd(cmdline, { cwd: safeResolve('.') });
    return { ok: true, result: { action: 'exec', command: cmdline, text: out.slice(0, MAX_RESULT_LEN) } };
  }

  // 5) 抓取网页： 抓取网页 https://example.com | 下载网页 xxx（Node 原生 fetch，零依赖）
  m = /^(?:抓取|下载|访问|fetch)(网页|页面|url)\s*[:：]?\s*(https?:\/\/\S+)$/i.exec(t);
  if (m) {
    const url = m[2];
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'fhcode-cloud-agent/1.0' },
      });
      const txt = (await res.text()).slice(0, MAX_RESULT_LEN);
      return { ok: true, result: { action: 'fetch', url, status: res.status, text: txt || '（空响应）' } };
    } catch (e) {
      return { ok: false, error: '抓取失败: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  // 6) 系统状态： 系统状态 | 内存 | 磁盘 | 服务器状态（Node 原生，跨平台）
  if (/(系统状态|服务器状态|运行状态|内存|磁盘|磁盘空间|uptime|主机)/.test(t) && !/文件/.test(t)) {
    const gb = (n) => (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    const lines = [
      '--- 主机 ---', `${os.hostname()} | ${os.platform()} ${os.release()} | ${os.arch()}`,
      '--- 运行时间 ---', (os.uptime() / 3600).toFixed(2) + ' 小时',
      '--- 内存 ---', `总 ${gb(os.totalmem())} / 空闲 ${gb(os.freemem())} / 已用 ${gb(os.totalmem() - os.freemem())}`,
      '--- CPU ---', os.cpus().length + ' 核 @ ' + os.cpus()[0].model.trim(),
      '--- 工作目录 ---', WORKDIR,
    ];
    return { ok: true, result: { action: 'sysinfo', text: lines.join('\n') } };
  }

  // 7) 搜索文件： 搜索文件 log | 查找文件 *.json（Node 原生实现，跨平台）
  m = /^(?:搜索|查找|找)(文件|关键词|内容)\s*[:：]?\s*(.+)$/i.exec(t);
  if (m) {
    const kw = m[2].trim();
    const hits = [];
    (function walk(d) {
      let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (hits.length >= 30) return;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); }
        else {
          try { const c = fs.readFileSync(p, 'utf8'); if (c.includes(kw)) hits.push(p); } catch { /* 忽略不可读文件 */ }
        }
      }
    })(WORKDIR);
    const rels = hits.map((h) => path.relative(WORKDIR, h) || h);
    return { ok: true, result: { action: 'grep', keyword: kw, text: (rels.length ? rels.join('\n') : '（未找到匹配文件）') } };
  }

  // 8) 兜底：把指令当作 shell 命令执行（仍过黑名单 + 超时）
  const out = await runCmd(t);
  return { ok: true, result: { action: 'shell', command: t, text: out.slice(0, MAX_RESULT_LEN) } };
}

// ===================== 主循环 =====================
async function main() {
  fs.mkdirSync(WORKDIR, { recursive: true });
  log(`云端执行体启动 | 云端: ${CLOUD_URL} | 设备: ${DEVICE_ID} (${DEVICE_NAME}) | 工作目录: ${WORKDIR}`);

  // 注册设备
  try {
    const r = await httpRequest('POST', '/api/bridge/register', { deviceId: DEVICE_ID, name: DEVICE_NAME });
    log('注册成功: ' + (r.ok ? 'ok' : JSON.stringify(r)));
  } catch (e) {
    log('❌ 注册失败: ' + e.message);
    process.exitCode = 1;
    return;
  }

  log('开始长轮询云端指令（Ctrl+C 停止）…');
  let running = true;
  const stop = () => { running = false; process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    try {
      const data = await httpRequest('GET', '/api/bridge/pending?deviceId=' + encodeURIComponent(DEVICE_ID));
      const cmd = data && data.command;
      if (cmd && cmd.cmdId) {
        log('收到指令: ' + cmd.text);
        let outcome;
        try {
          outcome = await execute(cmd.text);
          log(`执行完成: ${outcome.ok ? '成功' : '失败'}（${outcome.result?.action || outcome.error || ''}）`);
        } catch (e) {
          outcome = { ok: false, error: e instanceof Error ? e.message : String(e) };
          log('执行异常: ' + outcome.error);
        }
        try {
          await httpRequest('POST', '/api/bridge/result', {
            cmdId: cmd.cmdId, deviceId: DEVICE_ID,
            ok: outcome.ok, result: outcome.result, error: outcome.error,
          });
        } catch (e) {
          log('回传结果失败: ' + e.message);
        }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } catch (e) {
      log('轮询出错（' + e.message + '），5 秒后重试');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// 支持单次执行（便于测试）：node cloud-agent.js --once "指令"
if (process.argv[2] === '--once') {
  const text = process.argv.slice(3).join(' ').trim();
  if (!text) { console.error('用法: node cloud-agent.js --once "指令"'); process.exit(1); }
  execute(text).then((o) => {
    console.log(JSON.stringify(o, null, 2));
    process.exit(o.ok ? 0 : 1);
  }).catch((e) => { console.error(String(e)); process.exit(1); });
} else {
  main();
}

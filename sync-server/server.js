#!/usr/bin/env node
/**
 * 飞虹 Code 跨端同步 · 云端中继服务
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
 *
 * 单进程极轻量：Express + 内存索引 + JSON 文件持久化
 * 鉴权：Bearer token，从环境变量 FHCODE_SYNC_TOKEN 读取
 */
'use strict';

const express = require('express');
const store = require('./store');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.FHCODE_SYNC_PORT) || 8787;
const HOST = process.env.FHCODE_SYNC_HOST || '0.0.0.0';
const TOKEN = process.env.FHCODE_SYNC_TOKEN || '';
/** 云执行 token：只有服务器上的云执行器持有，用于认领 executor='cloud' 的任务（与手机/本机 token 隔离） */
const CLOUD_TOKEN = process.env.FHCODE_CLOUD_EXEC_TOKEN || '';

if (!TOKEN) {
  console.error('[FATAL] 环境变量 FHCODE_SYNC_TOKEN 未设置，拒绝启动（生产环境必须配置）');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '20mb' })); // 会话快照可能较大

// ===================== CORS 中间件（必须在 auth 之前）=====================
// App（Capacitor WebView，origin=https://localhost 等）跨域访问本服务，
// 浏览器先发 OPTIONS 预检——若被 auth 拦成 401 或响应无 CORS 头，
// WebView 侧统一报 "Failed to fetch"（2026-10-25 v77 实测事故）。
// 白名单回显 Origin（不用 *：请求带 Authorization 头，* 会被浏览器拒绝）。
// 注：安全边界是 Bearer token，CORS 仅为放行自家客户端。
const CORS_ORIGINS = new Set([
  'https://localhost',      // Capacitor 默认 androidScheme
  'http://localhost',
  'capacitor://localhost',
  'https://sync.klai.top',  // 自身 /m/ 静态页（同源也显式放行）
  'https://api.klai.top',
]);
function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && (CORS_ORIGINS.has(origin) || origin === 'null')) {
    res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? 'null' : origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    // 预检直接放行（不带业务鉴权，浏览器凭 CORS 头决定后续真实请求）
    return res.status(204).end();
  }
  next();
}
app.use(cors);

// ===================== 鉴权中间件 =====================
function bearerToken(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1] : '';
}

function auth(req, res, next) {
  const t = bearerToken(req);
  if (t && t === TOKEN) return next();
  // 云执行 token 也可通过全局鉴权；能否认领云端任务由路由级再隔离
  if (CLOUD_TOKEN && t === CLOUD_TOKEN) return next();
  return res.status(401).json({ ok: false, error: '未授权：缺少或错误的 Bearer token' });
}

// 所有 /api 路由统一鉴权
app.use('/api', auth);

// ===================== 健康检查（无需鉴权） =====================
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'fhcode-sync-server', version: '0.1.0', time: new Date().toISOString() });
});

// ===================== 会话快照 =====================
/** POST /api/sessions 保存会话快照（merge 模式） */
app.post('/api/sessions', (req, res) => {
  try {
    const body = req.body || {};
    const session = store.upsertSession({
      runId: body.runId,
      goal: body.goal,
      status: body.status,
      messages: body.messages,
    });
    res.json({ ok: true, runId: session.runId, updatedAt: session.updatedAt });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** GET /api/sessions 返回会话列表摘要 */
app.get('/api/sessions', (req, res) => {
  res.json({ ok: true, sessions: store.listSummaries() });
});

/** GET /api/sessions/cloud-pending 云执行器专用：列出有待执行云端任务的会话 runId（须在 :runId 路由之前注册） */
app.get('/api/sessions/cloud-pending', (req, res) => {
  if (!CLOUD_TOKEN) return res.status(500).json({ ok: false, error: 'cloud exec token 未配置' });
  if (bearerToken(req) !== CLOUD_TOKEN) return res.status(403).json({ ok: false, error: '禁止访问：需要云执行 token' });
  res.json({ ok: true, runIds: store.listCloudPending() });
});

/** GET /api/sessions/:runId 返回完整会话 */
app.get('/api/sessions/:runId', (req, res) => {
  const session = store.getSession(req.params.runId);
  if (!session) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, session });
});

// ===================== 远程 goal 下发 =====================
/** POST /api/sessions/:runId/goals 接收远程下发的新 goal，写入队列，状态 queued
 * body.executor：'local'（默认，本机认领）或 'cloud'（云端执行器认领）
 */
app.post('/api/sessions/:runId/goals', (req, res) => {
  try {
    const goalEntry = store.queueGoal(req.params.runId, (req.body || {}).goal, (req.body || {}).executor);
    res.json({ ok: true, goal: goalEntry });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/sessions/:runId/claim 拉取 queued 的 goal，置为 running
 * body.executor：'local'（默认，本机 sync token）或 'cloud'（必须持云执行 token）
 */
app.post('/api/sessions/:runId/claim', (req, res) => {
  try {
    const executor = (req.body || {}).executor === 'cloud' ? 'cloud' : 'local';
    if (executor === 'cloud') {
      if (!CLOUD_TOKEN) return res.status(500).json({ ok: false, error: 'cloud exec token 未配置' });
      if (bearerToken(req) !== CLOUD_TOKEN) return res.status(403).json({ ok: false, error: '禁止访问：云端认领需要云执行 token' });
    }
    const goal = store.claimNextQueued(req.params.runId, executor);
    if (!goal) return res.status(404).json({ ok: false, error: '无 queued 状态的 goal 可拉取' });
    res.json({ ok: true, goal });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/sessions/:runId/status 更新任务状态 */
app.post('/api/sessions/:runId/status', (req, res) => {
  try {
    const session = store.updateStatus(req.params.runId, (req.body || {}).status);
    res.json({ ok: true, runId: session.runId, status: session.status });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ===================== 静态文件服务（app-mobile） ======
const MOBILE_DIR = path.join(__dirname, '..', 'app-mobile');

function isPathSafe(requestPath, baseDir) {
  const resolved = path.resolve(baseDir, requestPath);
  return resolved.startsWith(path.resolve(baseDir));
}

app.use('/m', express.static(MOBILE_DIR, {
  setHeaders: (res, pathname) => {
    if (pathname.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    else if (pathname.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
    else if (pathname.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  }
}));

// 自定义路由处理 /m/ 和路径穿越防护
app.get('/m', (req, res) => {
  // 默认进入同步任务页（跨端续接主入口）
  res.redirect('/m/sync.html');
});

app.get('/m/*', (req, res) => {
  const requestedPath = req.params[0];
  if (!isPathSafe(requestedPath, MOBILE_DIR)) {
    return res.status(400).json({ ok: false, error: '非法路径' });
  }
  const filePath = path.join(MOBILE_DIR, requestedPath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: 'Not Found' });
  }
  res.sendFile(filePath);
});

// ===================== 启动 =====================
function start() {
  const loadResult = store.load();
  if (loadResult.error) {
    console.error('[WARN] 数据文件加载异常（已备份并重建）: ' + loadResult.error);
  }
  const server = app.listen(PORT, HOST, () => {
    console.log(`[sync-server] 监听 ${HOST}:${PORT} | 已加载会话 ${loadResult.loaded} 个`);
    console.log('[sync-server] Bearer token 鉴权已启用');
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start };

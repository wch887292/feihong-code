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

const PORT = Number(process.env.FHCODE_SYNC_PORT) || 8787;
const HOST = process.env.FHCODE_SYNC_HOST || '0.0.0.0';
const TOKEN = process.env.FHCODE_SYNC_TOKEN || '';

if (!TOKEN) {
  console.error('[FATAL] 环境变量 FHCODE_SYNC_TOKEN 未设置，拒绝启动（生产环境必须配置）');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '20mb' })); // 会话快照可能较大

// ===================== 鉴权中间件 =====================
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || m[1] !== TOKEN) {
    return res.status(401).json({ ok: false, error: '未授权：缺少或错误的 Bearer token' });
  }
  next();
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

/** GET /api/sessions/:runId 返回完整会话 */
app.get('/api/sessions/:runId', (req, res) => {
  const session = store.getSession(req.params.runId);
  if (!session) return res.status(404).json({ ok: false, error: '会话不存在' });
  res.json({ ok: true, session });
});

// ===================== 远程 goal 下发 =====================
/** POST /api/sessions/:runId/goals 接收远程下发的新 goal，写入队列，状态 queued */
app.post('/api/sessions/:runId/goals', (req, res) => {
  try {
    const goalEntry = store.queueGoal(req.params.runId, (req.body || {}).goal);
    res.json({ ok: true, goal: goalEntry });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** POST /api/sessions/:runId/claim 本地 CLI 拉取 queued 的 goal，置为 running */
app.post('/api/sessions/:runId/claim', (req, res) => {
  try {
    const goal = store.claimNextQueued(req.params.runId);
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

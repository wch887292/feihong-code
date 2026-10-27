#!/usr/bin/env node
/**
 * 飞虹 Code 跨端同步 · 云端中继服务
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
 *
 * 存储层：内存索引 + JSON 文件持久化（不引入数据库，面向 1.9G 内存服务器）
 * 所有读写通过 store 模块统一入口，避免竞态。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FHCODE_SYNC_DATA || path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

/** 会话状态机：queued -> running -> paused/done/failed（任意状态可互相跳转，由业务层保证合法性） */
const TASK_STATUSES = ['queued', 'running', 'paused', 'done', 'failed'];

let sessions = new Map(); // runId -> session object
let loadError = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** 启动时从 JSON 文件恢复内存索引 */
function load() {
  ensureDataDir();
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        sessions = new Map(arr.map((s) => [s.runId, s]));
        loadError = null;
        return { loaded: sessions.size };
      }
    }
  } catch (e) {
    loadError = e;
    // 损坏不致命：备份坏文件后从空索引启动
    try {
      fs.renameSync(SESSIONS_FILE, SESSIONS_FILE + '.bad-' + Date.now());
    } catch { /* 忽略备份失败 */ }
    sessions = new Map();
  }
  return { loaded: sessions.size, error: loadError ? String(loadError.message) : null };
}

/** 立即落盘（同步写，数据量小，简单可靠） */
function persist() {
  ensureDataDir();
  const tmp = SESSIONS_FILE + '.tmp';
  const arr = Array.from(sessions.values());
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
  fs.renameSync(tmp, SESSIONS_FILE);
}

/** 会话摘要（列表用，不含 messages 全文） */
function summarize(s) {
  const goals = Array.isArray(s.goals) ? s.goals : [];
  return {
    runId: s.runId,
    goal: s.goal || '',
    status: s.status || 'idle',
    updatedAt: s.updatedAt || s.createdAt || null,
    messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
    goalCount: goals.length,
    hasCloudGoal: goals.some((g) => g.executor === 'cloud'),
    progressCount: Array.isArray(s.progress) ? s.progress.length : 0,
  };
}

/** 保存会话快照：merge 模式，只更新传入的字段 */
function upsertSession(snapshot) {
  const runId = snapshot.runId;
  if (!runId || typeof runId !== 'string') {
    throw new Error('runId 必填且为字符串');
  }
  const now = new Date().toISOString();
  const existing = sessions.get(runId) || {
    runId,
    goal: '',
    goals: [],
    status: 'idle',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };

  if (snapshot.goal !== undefined) existing.goal = String(snapshot.goal);
  if (snapshot.messages !== undefined) {
    if (!Array.isArray(snapshot.messages)) throw new Error('messages 必须为数组');
    existing.messages = snapshot.messages;
  }
  if (snapshot.status !== undefined) {
    if (!TASK_STATUSES.includes(snapshot.status)) {
      throw new Error('非法 status: ' + snapshot.status + '（允许：' + TASK_STATUSES.join('/') + '）');
    }
    existing.status = snapshot.status;
  }
  existing.updatedAt = now;
  sessions.set(runId, existing);
  persist();
  return existing;
}

/** 会话列表摘要 */
function listSummaries() {
  return Array.from(sessions.values())
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(summarize);
}

/** 获取完整会话 */
function getSession(runId) {
  return sessions.get(runId) || null;
}

/** 下发新 goal：写入任务队列（goals 数组），状态置 queued
 * @param executor 'local'（本机 fhcode 认领，默认）或 'cloud'（云端执行器认领）
 */
function queueGoal(runId, goal, executor) {
  const s = sessions.get(runId);
  if (!s) throw new Error('会话不存在: ' + runId);
  if (!goal || typeof goal !== 'string') throw new Error('goal 必填且为字符串');
  const exec = executor === 'cloud' ? 'cloud' : 'local';
  const goalEntry = {
    id: 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    goal,
    executor: exec,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  if (!Array.isArray(s.goals)) s.goals = [];
  s.goals.push(goalEntry);
  // 下发 goal 即进入待执行队列：会话未在运行中时置 queued，便于轮询端扫描与多端列表展示
  if (s.status !== 'running') s.status = 'queued';
  s.updatedAt = new Date().toISOString();
  sessions.set(runId, s);
  persist();
  return goalEntry;
}

/** 扫描所有会话：返回包含「executor==='cloud' 且 status==='queued' 的 goal」的 runId 数组（云执行器专用） */
function listCloudPending() {
  const result = [];
  for (const [runId, s] of sessions.entries()) {
    if (!Array.isArray(s.goals)) continue;
    if (s.goals.some((g) => g.executor === 'cloud' && g.status === 'queued')) {
      result.push(runId);
    }
  }
  return result;
}

/** 拉取 queued 的 goal：置为 running 并返回
 * @param executor 'local'（默认，本机认领）或 'cloud'（云执行器认领），只拉取匹配执行端的 goal
 */
function claimNextQueued(runId, executor) {
  const s = sessions.get(runId);
  if (!s) throw new Error('会话不存在: ' + runId);
  if (!Array.isArray(s.goals)) s.goals = [];
  const want = executor === 'cloud' ? 'cloud' : 'local';
  const idx = s.goals.findIndex((g) => g.status === 'queued' && (g.executor || 'local') === want);
  if (idx === -1) return null;
  const goal = s.goals[idx];
  goal.status = 'running';
  goal.claimedAt = new Date().toISOString();
  s.updatedAt = new Date().toISOString();
  sessions.set(runId, s);
  persist();
  return goal;
}

/** 更新任务状态 */
function updateStatus(runId, status) {
  const s = sessions.get(runId);
  if (!s) throw new Error('会话不存在: ' + runId);
  if (!TASK_STATUSES.includes(status)) {
    throw new Error('非法 status: ' + status);
  }
  s.status = status;
  // 终态联动：会话置 done/failed 时，把仍 running 的 goal 一起翻到终态（消除详情页状态矛盾）
  if (status === 'done' || status === 'failed') {
    if (Array.isArray(s.goals)) {
      for (const g of s.goals) {
        if (g.status === 'running') {
          g.status = status;
          g.finishedAt = new Date().toISOString();
        }
      }
    }
  }
  s.updatedAt = new Date().toISOString();
  sessions.set(runId, s);
  persist();
  return s;
}

/* ===================== 执行过程事件流（progress） =====================
 * 背景（2026-10-26）：手机端此前只能看到「最终答案」，看不到 agent 的工具调用与思考摘要，
 * 导致「无法确定任务执行情况」。本通道让执行端（家电脑 8082 / 云端执行体）把每一步
 * 以事件形式增量追加到会话下，手机端轮询 GET /api/sessions/:runId 即可实时渲染。
 * 设计约束：
 *   - 追加式（append-only），不覆盖 messages，保留原有对话语义；
 *   - 单会话最多 PROGRESS_MAX 条、单条文本截断，避免 1.9G 内存服务器被撑爆；
 *   - 会话不存在时自动创建（执行端可能先于手机端建会话上报过程）。
 */
const PROGRESS_MAX = 300;
const PROGRESS_TEXT_MAX = 2000;

/** 追加一条执行过程事件（幂等：同 seq 覆盖，避免重试导致重复） */
function appendProgress(runId, event) {
  if (!runId || typeof runId !== 'string') throw new Error('runId 必填且为字符串');
  const now = new Date().toISOString();
  let s = sessions.get(runId);
  if (!s) {
    s = {
      runId,
      goal: '',
      goals: [],
      status: 'running',
      messages: [],
      progress: [],
      createdAt: now,
      updatedAt: now,
    };
  }
  if (!Array.isArray(s.progress)) s.progress = [];

  const kind = String(event?.kind || 'step').slice(0, 32);
  const text = String(event?.text == null ? '' : event.text).slice(0, PROGRESS_TEXT_MAX);
  const seq = Number.isFinite(Number(event?.seq)) ? Number(event.seq) : s.progress.length + 1;

  // 同 seq 视为重试覆盖（幂等）
  const existingIdx = s.progress.findIndex((p) => p.seq === seq);
  const item = {
    seq,
    kind,
    text,
    at: now,
    ...(event?.meta && typeof event.meta === 'object' ? { meta: event.meta } : {}),
  };
  if (existingIdx >= 0) s.progress[existingIdx] = item;
  else s.progress.push(item);

  // 环形裁剪：保留最新 PROGRESS_MAX 条
  if (s.progress.length > PROGRESS_MAX) s.progress = s.progress.slice(-PROGRESS_MAX);
  s.updatedAt = now;
  sessions.set(runId, s);
  persist();
  return item;
}

/** 读取执行过程事件流（按 seq 升序） */
function getProgress(runId) {
  const s = sessions.get(runId);
  if (!s) return [];
  return Array.isArray(s.progress) ? s.progress.slice().sort((a, b) => a.seq - b.seq) : [];
}

/** 批量追加（执行端一次性上报多条时用，减少 HTTP 往返与落盘次数） */
function appendProgressBatch(runId, events) {
  const list = Array.isArray(events) ? events : [];
  const out = [];
  for (const ev of list) {
    try { out.push(appendProgress(runId, ev)); } catch { /* 单条失败不影响整批 */ }
  }
  return out;
}

module.exports = {
  TASK_STATUSES,
  PROGRESS_MAX,
  load,
  upsertSession,
  listSummaries,
  getSession,
  queueGoal,
  claimNextQueued,
  listCloudPending,
  updateStatus,
  appendProgress,
  appendProgressBatch,
  getProgress,
  _reset() { sessions = new Map(); }, // 仅供测试
};

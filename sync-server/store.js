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

module.exports = {
  TASK_STATUSES,
  load,
  upsertSession,
  listSummaries,
  getSession,
  queueGoal,
  claimNextQueued,
  listCloudPending,
  updateStatus,
  _reset() { sessions = new Map(); }, // 仅供测试
};

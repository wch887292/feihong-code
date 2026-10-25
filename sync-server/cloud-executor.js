#!/usr/bin/env node
/**
 * 飞虹 Code 跨端同步 · 云执行器（云电脑）
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
 *
 * 常驻服务器，轮询 sync-server 的云端任务队列（executor='cloud'），
 * 认领后在限定工作区内 spawn 本机部署的 fhcode CLI 真执行，终态回传。
 *
 * 安全设计：
 * - 独立 token（FHCODE_CLOUD_EXEC_TOKEN），与手机/本机查看 token 隔离
 * - 工作区硬限定（FHCODE_CLOUD_WORKSPACE），fhcode 文件工具本身也锁工作区
 * - 单任务串行，内存与并发受限，保护 1.9G 小机器
 *
 * 环境变量：
 *   FHCODE_CLOUD_EXEC_TOKEN  云执行 token（必填，与 sync-server 一致）
 *   FHCODE_SYNC_URL          sync-server 地址（必填）
 *   FHCODE_SYNC_TOKEN        查看 token（传给子进程推送快照用，必填）
 *   FHCODE_CLOUD_CLI_PATH    云端 fhcode CLI 入口（默认 /www/wwwroot/fhcode-cloud/fhcode-src/dist/cli/index.js）
 *   FHCODE_CLOUD_WORKSPACE   执行工作区（默认 /www/wwwroot/fhcode-cloud/workspace）
 *   FHCODE_CLOUD_POLL_INTERVAL 轮询间隔 ms（默认 15000）
 */
'use strict';

const { spawn } = require('node:child_process');

const EXEC_TOKEN = process.env.FHCODE_CLOUD_EXEC_TOKEN || '';
const SYNC_URL = (process.env.FHCODE_SYNC_URL || '').replace(/\/+$/, '');
const SYNC_TOKEN = process.env.FHCODE_SYNC_TOKEN || '';
const CLI_PATH = process.env.FHCODE_CLOUD_CLI_PATH || '/www/wwwroot/fhcode-cloud/fhcode-src/dist/cli/index.js';
const WORKSPACE = process.env.FHCODE_CLOUD_WORKSPACE || '/www/wwwroot/fhcode-cloud/workspace';
const INTERVAL = Number(process.env.FHCODE_CLOUD_POLL_INTERVAL) || 15000;

if (!EXEC_TOKEN || !SYNC_URL || !SYNC_TOKEN) {
  console.error('[FATAL] 云执行器启动失败：必须设置 FHCODE_CLOUD_EXEC_TOKEN / FHCODE_SYNC_URL / FHCODE_SYNC_TOKEN');
  process.exit(1);
}

function log(msg) {
  console.log('[云执行器] ' + new Date().toISOString() + ' ' + msg);
}

async function api(method, path, body) {
  const res = await fetch(SYNC_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + EXEC_TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** 执行单个 goal：spawn fhcode CLI，退出码决定终态 */
function runGoal(runId, goalText) {
  return new Promise((resolve) => {
    log('开始执行云端任务 runId=' + runId + ' goal=' + goalText.slice(0, 60));
    const child = spawn('node', [CLI_PATH, goalText], {
      cwd: WORKSPACE,
      env: Object.assign({}, process.env, {
        FHCODE_SYNC_ENABLED: 'true',
        FHCODE_SYNC_URL: 'http://127.0.0.1:8787',
        FHCODE_SYNC_TOKEN: SYNC_TOKEN,
        // 云端无交互审批通道：显式放开沙箱（工作区已由 cwd + fhcode 文件策略双重限定）
        FH_SANDBOX_MODE: 'danger-full-access',
        FH_REQUIRE_APPROVAL: 'false',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outTail = '';
    child.stdout.on('data', (d) => { outTail = (outTail + d.toString()).slice(-500); });
    child.stderr.on('data', (d) => { outTail = (outTail + d.toString()).slice(-500); });
    child.on('error', (e) => {
      log('子进程启动失败: ' + e.message);
      resolve(false);
    });
    child.on('close', (code) => {
      log('云端任务结束 runId=' + runId + ' exit=' + code);
      if (code !== 0 && outTail) log('输出尾部: ' + outTail.replace(/\n/g, ' | ').slice(0, 300));
      resolve(code === 0);
    });
  });
}

async function tick() {
  let pending;
  try {
    const r = await api('GET', '/api/sessions/cloud-pending');
    if (r.status !== 200 || !r.json || !r.json.ok) {
      log('查询待执行队列失败 status=' + r.status);
      return;
    }
    pending = r.json.runIds || [];
  } catch (e) {
    log('查询待执行队列异常: ' + e.message);
    return;
  }
  if (pending.length === 0) return;

  // 单任务串行：一次 tick 只认领执行一个，其余等下一轮
  for (const runId of pending) {
    let claim;
    try {
      claim = await api('POST', '/api/sessions/' + encodeURIComponent(runId) + '/claim', { executor: 'cloud' });
    } catch (e) {
      log('认领异常 runId=' + runId + ': ' + e.message);
      continue;
    }
    if (claim.status !== 200 || !claim.json || !claim.json.ok) {
      // 404=已被其他执行器认领或无待执行 goal，正常跳过
      continue;
    }
    const goalText = (claim.json.goal && claim.json.goal.goal) || '';
    if (!goalText) continue;
    const ok = await runGoal(runId, goalText);
    try {
      await api('POST', '/api/sessions/' + encodeURIComponent(runId) + '/status', { status: ok ? 'done' : 'failed' });
    } catch (e) {
      log('终态回传失败 runId=' + runId + ': ' + e.message);
    }
    return; // 串行：本轮只做一个
  }
}

log('云执行器已启动 sync=' + SYNC_URL + ' workspace=' + WORKSPACE + ' 间隔=' + INTERVAL + 'ms');
const timer = setInterval(() => { tick().catch(() => {}); }, INTERVAL);
tick().catch(() => {});

process.on('SIGINT', () => { clearInterval(timer); log('云执行器已停止'); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(timer); log('云执行器已停止'); process.exit(0); });

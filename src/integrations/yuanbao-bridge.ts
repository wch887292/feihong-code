/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 元宝/豆包桥接（Yuanbao/Doubao Bridge）：
 *  - 入站：元宝开放平台 webhook 消息接收（JSON 格式 + HMAC-SHA256 签名校验）
 *  - 出站：元宝 API 消息发送（可配置 endpoint，支持智能体回复/消息推送）
 *  - 桥接：消息 → TaskQueue → 结果主动推送
 *
 * 环境变量配置：
 *  FH_YUANBAO_ENABLED=true
 *  FH_YUANBAO_API_KEY=元宝开放平台 API Key
 *  FH_YUANBAO_ENDPOINT=元宝 API Endpoint（默认 https://ark.cn-beijing.volces.com/api/v3）
 *  FH_YUANBAO_AGENT_ID=元宝智能体 ID（可选，用于智能体模式）
 *  FH_YUANBAO_WEBHOOK_SECRET=Webhook 签名密钥（HMAC-SHA256）
 *  FH_YUANBAO_WORKSPACE=元宝任务工作目录（默认 ~/.fhcode/yuanbao-workspace）
 *
 * 消息格式（入站 webhook JSON）：
 *  {
 *    "message_id": "xxx",
 *    "user_id": "xxx",
 *    "content": "用户消息文本",
 *    "type": "text",
 *    "timestamp": 1234567890,
 *    "metadata": {}
 *  }
 *
 * 出站消息格式（POST 到元宝 API）：
 *  {
 *    "user_id": "xxx",
 *    "content": "回复内容",
 *    "type": "text",
 *    "message_id": "回复消息ID"
 *  }
 *
 * 安全：
 *  - HMAC-SHA256 签名校验（X-Yuanbao-Signature 头，fail-closed）
 *  - message_id 幂等去重
 *  - 用户会话隔离
 *  - API Key 仅内存使用，不落盘
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../shared/logger';
import type { TaskQueue, TaskRecord } from '../web/task-queue';

/* ===================== 配置 ===================== */

export interface YuanbaoBridgeConfig {
  enabled: boolean;
  apiKey: string;
  endpoint: string;
  agentId?: string;
  webhookSecret: string;
  workspace: string;
}

export function loadYuanbaoConfig(): YuanbaoBridgeConfig {
  const enabled = process.env.FH_YUANBAO_ENABLED === 'true';
  const workspace = process.env.FH_YUANBAO_WORKSPACE || join(homedir(), '.fhcode', 'yuanbao-workspace');
  if (enabled && !existsSync(workspace)) mkdirSync(workspace, { recursive: true });

  return {
    enabled,
    apiKey: process.env.FH_YUANBAO_API_KEY || '',
    endpoint: process.env.FH_YUANBAO_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3',
    agentId: process.env.FH_YUANBAO_AGENT_ID,
    webhookSecret: process.env.FH_YUANBAO_WEBHOOK_SECRET || '',
    workspace,
  };
}

export function isYuanbaoEnabled(cfg: YuanbaoBridgeConfig): boolean {
  return cfg.enabled && !!cfg.apiKey && !!cfg.webhookSecret;
}

/* ===================== 签名校验 ===================== */

/**
 * 元宝 webhook HMAC-SHA256 签名校验。
 * 签名格式：X-Yuanbao-Signature: sha256=<hex>
 * 签名内容：timestamp + "." + rawBody
 */
export function verifyYuanbaoSignature(secret: string, rawBody: string, timestamp: string, signature: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const got = signature.replace(/^sha256=/i, '').toLowerCase();
  if (expected.length !== got.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(got, 'hex'));
  } catch {
    return false;
  }
}

/* ===================== 消息解析 ===================== */

export interface YuanbaoInboundMessage {
  /** 消息ID（幂等去重） */
  messageId: string;
  /** 用户ID */
  userId: string;
  /** 消息类型：text/image/event */
  type: string;
  /** 文本内容（type=text 时） */
  content?: string;
  /** 时间戳 */
  timestamp?: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 原始消息 */
  raw: Record<string, unknown>;
}

/** 解析元宝入站消息（兼容多种字段命名） */
export function parseYuanbaoMessage(body: Record<string, unknown>): YuanbaoInboundMessage {
  return {
    messageId: (body.message_id || body.msgId || body.id || '') as string,
    userId: (body.user_id || body.userId || body.from || body.sender || '') as string,
    type: (body.type || body.msg_type || 'text') as string,
    content: (body.content || body.text || body.message || '') as string | undefined,
    timestamp: body.timestamp ? Number(body.timestamp) : undefined,
    metadata: (body.metadata || {}) as Record<string, unknown>,
    raw: body,
  };
}

/* ===================== 会话管理 ===================== */

interface YuanbaoSession {
  userId: string;
  taskId?: string;
  lastActive: string;
  messageIds: string[]; // 最近处理的消息ID（幂等去重）
}

const yuanbaoSessions = new Map<string, YuanbaoSession>();
const YUANBAO_SESSION_FILE = join(homedir(), '.fhcode', 'yuanbao-sessions.json');

function loadYuanbaoSessions(): void {
  if (existsSync(YUANBAO_SESSION_FILE)) {
    try {
      const data = JSON.parse(readFileSync(YUANBAO_SESSION_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) yuanbaoSessions.set(k, v as YuanbaoSession);
    } catch (e) {
      logger.warn('yuanbao sessions load failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

function saveYuanbaoSessions(): void {
  try {
    const dir = join(homedir(), '.fhcode');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: Record<string, YuanbaoSession> = {};
    for (const [k, v] of yuanbaoSessions) data[k] = v;
    writeFileSync(YUANBAO_SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    logger.warn('yuanbao sessions save failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

function getYuanbaoSession(userId: string): YuanbaoSession {
  let s = yuanbaoSessions.get(userId);
  if (!s) {
    s = { userId, lastActive: new Date().toISOString(), messageIds: [] };
    yuanbaoSessions.set(userId, s);
  }
  return s;
}

function isYuanbaoDuplicate(session: YuanbaoSession, messageId: string): boolean {
  if (!messageId) return false;
  if (session.messageIds.includes(messageId)) return true;
  session.messageIds.push(messageId);
  if (session.messageIds.length > 100) session.messageIds = session.messageIds.slice(-100);
  return false;
}

/* ===================== 出站消息 ===================== */

/**
 * 发送元宝回复消息（POST 到元宝 API）。
 * 支持两种模式：
 *  1. 智能体模式（配置了 agentId）：调用智能体回复 API
 *  2. 通用模式：调用消息发送 API
 */
export async function sendYuanbaoReply(cfg: YuanbaoBridgeConfig, userId: string, content: string): Promise<void> {
  const url = cfg.agentId
    ? `${cfg.endpoint}/agents/${cfg.agentId}/messages`
    : `${cfg.endpoint}/messages`;

  const body = {
    user_id: userId,
    content,
    type: 'text',
    message_id: `fhcode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`元宝 API 返回 ${res.status}: ${errText.slice(0, 200)}`);
  }

  logger.info('yuanbao message sent', { userId, chars: content.length, agentId: cfg.agentId || 'none' });
}

/* ===================== 桥接核心 ===================== */

let taskQueueRef: TaskQueue | null = null;

/** 注入 TaskQueue 引用（web server 启动时调用） */
export function setYuanbaoTaskQueue(queue: TaskQueue): void {
  taskQueueRef = queue;
}

/**
 * 处理元宝 webhook 回调：
 *  1. HMAC-SHA256 签名校验（fail-closed）
 *  2. 消息解析
 *  3. 幂等去重（message_id）
 *  4. 转发到 TaskQueue
 *  5. 立即返回 200，结果异步推送
 */
export async function handleYuanbaoCallback(
  cfg: YuanbaoBridgeConfig,
  rawBody: string,
  headers: Record<string, string | undefined>,
): Promise<{ status: number; body: unknown; contentType: string }> {
  if (!isYuanbaoEnabled(cfg)) {
    return { status: 404, body: { error: 'yuanbao bridge not configured' }, contentType: 'application/json' };
  }

  try {
    // 签名校验
    const signature = headers['x-yuanbao-signature'] || headers['X-Yuanbao-Signature'] || '';
    const timestamp = headers['x-yuanbao-timestamp'] || headers['X-Yuanbao-Timestamp'] || '';
    if (!verifyYuanbaoSignature(cfg.webhookSecret, rawBody, timestamp, signature)) {
      logger.warn('yuanbao webhook signature verification failed');
      return { status: 403, body: { error: 'invalid signature' }, contentType: 'application/json' };
    }

    // 解析消息
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { error: 'invalid JSON' }, contentType: 'application/json' };
    }

    const msg = parseYuanbaoMessage(body);
    logger.info('yuanbao inbound message', { userId: msg.userId, type: msg.type, messageId: msg.messageId });

    // 非文本消息 → 提示
    if (msg.type !== 'text' || !msg.content) {
      await sendYuanbaoReply(cfg, msg.userId, '目前仅支持文本消息，请输入文字描述您的需求。');
      return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
    }

    // 幂等去重
    const session = getYuanbaoSession(msg.userId);
    if (isYuanbaoDuplicate(session, msg.messageId)) {
      logger.info('yuanbao duplicate message ignored', { messageId: msg.messageId });
      return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
    }
    session.lastActive = new Date().toISOString();
    saveYuanbaoSessions();

    // 转发到 TaskQueue
    if (!taskQueueRef) {
      logger.error('yuanbao bridge: taskQueue not initialized');
      await sendYuanbaoReply(cfg, msg.userId, '服务未就绪，请稍后重试。');
      return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
    }

    const goal = msg.content.trim();
    let record: TaskRecord;

    // 多轮续接
    if (session.taskId) {
      const existing = taskQueueRef.get(session.taskId);
      if (existing && (existing.status === 'done' || existing.status === 'failed')) {
        const continued = taskQueueRef.continueTask(session.taskId, goal);
        if (continued) {
          record = continued;
        } else {
          record = taskQueueRef.submit(goal, { workspaceDir: cfg.workspace });
          session.taskId = record.id;
        }
      } else if (existing && (existing.status === 'queued' || existing.status === 'running')) {
        await sendYuanbaoReply(cfg, msg.userId, '上一个任务仍在处理中，请稍候...');
        return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
      } else {
        record = taskQueueRef.submit(goal, { workspaceDir: cfg.workspace });
        session.taskId = record.id;
      }
    } else {
      record = taskQueueRef.submit(goal, { workspaceDir: cfg.workspace });
      session.taskId = record.id;
    }
    saveYuanbaoSessions();

    // 异步推送结果
    void pushYuanbaoResult(cfg, msg.userId, record.id);

    // 立即返回确认
    await sendYuanbaoReply(cfg, msg.userId, '⏳ 已收到，正在处理中... 完成后将主动推送结果。');
    return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
  } catch (e) {
    logger.error('yuanbao callback handler error', { error: e instanceof Error ? e.message : String(e) });
    return { status: 500, body: { error: 'internal error' }, contentType: 'application/json' };
  }
}

/** 异步轮询任务结果并推送到元宝 */
async function pushYuanbaoResult(cfg: YuanbaoBridgeConfig, userId: string, taskId: string): Promise<void> {
  if (!taskQueueRef) return;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const record = taskQueueRef.get(taskId);
    if (!record) return;

    if (record.status === 'done') {
      const answer = record.result?.finalAnswer || '任务完成，但未生成结果。';
      const maxLen = 4000;
      const truncated = answer.length > maxLen ? answer.slice(0, maxLen) + '\n\n...（结果过长，已截断，请在 Web 控制台查看完整内容）' : answer;
      try {
        await sendYuanbaoReply(cfg, userId, truncated);
      } catch (e) {
        logger.error('yuanbao result push failed', { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    if (record.status === 'failed') {
      try {
        await sendYuanbaoReply(cfg, userId, `❌ 任务失败: ${(record.error || '未知错误').slice(0, 400)}`);
      } catch (e) {
        logger.error('yuanbao failure push failed', { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
  }

  try {
    await sendYuanbaoReply(cfg, userId, '⏱️ 任务处理超时，请在 Web 控制台查看进度。');
  } catch { /* 忽略 */ }
}

/* ===================== 初始化 ===================== */

export function initYuanbaoBridge(): YuanbaoBridgeConfig {
  loadYuanbaoSessions();
  const cfg = loadYuanbaoConfig();
  if (isYuanbaoEnabled(cfg)) {
    logger.info('yuanbao bridge enabled', { endpoint: cfg.endpoint, agentId: cfg.agentId || 'none', workspace: cfg.workspace });
  } else {
    logger.info('yuanbao bridge disabled (set FH_YUANBAO_ENABLED=true and configure credentials)');
  }
  return cfg;
}

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 飞书桥接（Feishu/Lark Bridge）：
 *  - 入站：飞书事件订阅（im.message.receive_v1），URL 验证 + 消息接收 + 签名校验 + 解密
 *  - 出站：复用 FeishuIntegration 发送文本/卡片消息
 *  - 桥接：消息 → TaskQueue → 结果主动推送
 *
 * 环境变量配置：
 *  FH_FEISHU_ENABLED=true
 *  FH_FEISHU_APP_ID=飞书应用App ID
 *  FH_FEISHU_APP_SECRET=飞书应用App Secret
 *  FH_FEISHU_VERIFICATION_TOKEN=事件订阅验证Token
 *  FH_FEISHU_ENCRYPT_KEY=事件加密Key（可选，配置后消息需解密）
 *  FH_FEISHU_WORKSPACE=飞书任务工作目录（默认 ~/.fhcode/feishu-workspace）
 *
 * 飞书开放平台配置：
 *  - 事件订阅请求地址：https://your-domain:8080/api/feishu/callback
 *  - 订阅事件：接收消息 im.message.receive_v1
 *  - 权限：im:message（获取与发送消息）、im:message:send_as_bot（以应用身份发消息）
 *
 * 安全：
 *  - verification_token 校验（fail-closed）
 *  - encrypt_key AES-256-CBC 解密（配置后强制）
 *  - event_id 幂等去重
 *  - 用户会话隔离
 */
import { createHash, createDecipheriv } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../shared/logger';
import { FeishuIntegration, type FeishuConfig } from './collaboration';
import type { TaskQueue, TaskRecord } from '../web/task-queue';

/* ===================== 配置 ===================== */

export interface FeishuBridgeConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey?: string;
  workspace: string;
}

export function loadFeishuConfig(): FeishuBridgeConfig {
  const enabled = process.env.FH_FEISHU_ENABLED === 'true';
  const workspace = process.env.FH_FEISHU_WORKSPACE || join(homedir(), '.fhcode', 'feishu-workspace');
  if (enabled && !existsSync(workspace)) mkdirSync(workspace, { recursive: true });

  return {
    enabled,
    appId: process.env.FH_FEISHU_APP_ID || '',
    appSecret: process.env.FH_FEISHU_APP_SECRET || '',
    verificationToken: process.env.FH_FEISHU_VERIFICATION_TOKEN || '',
    encryptKey: process.env.FH_FEISHU_ENCRYPT_KEY,
    workspace,
  };
}

export function isFeishuEnabled(cfg: FeishuBridgeConfig): boolean {
  return cfg.enabled && !!cfg.appId && !!cfg.appSecret && !!cfg.verificationToken;
}

/* ===================== 飞书事件解密 ===================== */

/**
 * 飞书事件加密解密（AES-256-CBC）。
 * 规范：key = sha256(encrypt_key) 前 32 字节；IV = 密文 base64 解码后前 16 字节；
 * 密文 = IV + 加密内容；PKCS7 填充。
 */
export function decryptFeishuEvent(encryptKey: string, encryptedBase64: string): string {
  const key = createHash('sha256').update(encryptKey).digest();
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const iv = encrypted.subarray(0, 16);
  const data = encrypted.subarray(16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

/* ===================== 飞书消息解析 ===================== */

export interface FeishuInboundMessage {
  /** 事件ID（幂等去重） */
  eventId: string;
  /** 发送者 open_id */
  openId: string;
  /** 发送者 user_id（如有） */
  userId?: string;
  /** 消息ID */
  messageId: string;
  /** 消息类型：text/post/image/... */
  messageType: string;
  /** 文本内容（message_type=text 时） */
  text?: string;
  /** 会话类型：p2p/group */
  chatType: string;
  /** 会话ID */
  chatId: string;
  /** 原始事件 JSON */
  raw: Record<string, unknown>;
}

/** 解析飞书事件订阅 v2.0 消息 */
export function parseFeishuEvent(body: Record<string, unknown>): FeishuInboundMessage | null {
  // URL 验证事件
  if (body.type === 'url_verification') return null;

  // v2.0 事件格式
  const header = (body.header || {}) as Record<string, unknown>;
  const event = (body.event || {}) as Record<string, unknown>;
  const eventType = header.event_type as string;

  if (eventType !== 'im.message.receive_v1') {
    logger.info('feishu: ignoring non-message event', { eventType });
    return null;
  }

  const sender = (event.sender || {}) as Record<string, unknown>;
  const senderId = (sender.sender_id || {}) as Record<string, unknown>;
  const message = (event.message || {}) as Record<string, unknown>;

  const openId = (senderId.open_id || '') as string;
  const messageId = (message.message_id || '') as string;
  const messageType = (message.message_type || '') as string;
  const chatType = (message.chat_type || 'p2p') as string;
  const chatId = (message.chat_id || '') as string;

  // 解析文本内容（content 是 JSON 字符串）
  let text: string | undefined;
  if (messageType === 'text' && message.content) {
    try {
      const content = JSON.parse(message.content as string);
      text = content.text || '';
    } catch {
      text = message.content as string;
    }
  }

  return {
    eventId: (header.event_id || '') as string,
    openId,
    userId: (senderId.user_id as string) || undefined,
    messageId,
    messageType,
    text,
    chatType,
    chatId,
    raw: body,
  };
}

/* ===================== 会话管理 ===================== */

interface FeishuSession {
  openId: string;
  taskId?: string;
  lastActive: string;
  eventIds: string[]; // 最近处理的事件ID（幂等去重）
}

const feishuSessions = new Map<string, FeishuSession>();
const FEISHU_SESSION_FILE = join(homedir(), '.fhcode', 'feishu-sessions.json');

function loadFeishuSessions(): void {
  if (existsSync(FEISHU_SESSION_FILE)) {
    try {
      const data = JSON.parse(readFileSync(FEISHU_SESSION_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) feishuSessions.set(k, v as FeishuSession);
    } catch (e) {
      logger.warn('feishu sessions load failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

function saveFeishuSessions(): void {
  try {
    const dir = join(homedir(), '.fhcode');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: Record<string, FeishuSession> = {};
    for (const [k, v] of feishuSessions) data[k] = v;
    writeFileSync(FEISHU_SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    logger.warn('feishu sessions save failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

function getFeishuSession(openId: string): FeishuSession {
  let s = feishuSessions.get(openId);
  if (!s) {
    s = { openId, lastActive: new Date().toISOString(), eventIds: [] };
    feishuSessions.set(openId, s);
  }
  return s;
}

function isFeishuDuplicate(session: FeishuSession, eventId: string): boolean {
  if (!eventId) return false;
  if (session.eventIds.includes(eventId)) return true;
  session.eventIds.push(eventId);
  if (session.eventIds.length > 100) session.eventIds = session.eventIds.slice(-100);
  return false;
}

/* ===================== 桥接核心 ===================== */

let taskQueueRef: TaskQueue | null = null;
let feishuIntegration: FeishuIntegration | null = null;

/** 注入 TaskQueue 引用和 FeishuIntegration（web server 启动时调用） */
export function setFeishuBridgeDeps(queue: TaskQueue, integration: FeishuIntegration): void {
  taskQueueRef = queue;
  feishuIntegration = integration;
}

/**
 * 处理飞书事件订阅回调：
 *  1. URL 验证（type=url_verification）→ 返回 challenge
 *  2. 解密（如配置了 encrypt_key）
 *  3. verification_token 校验（fail-closed）
 *  4. 消息解析（im.message.receive_v1）
 *  5. 幂等去重（event_id）
 *  6. 转发到 TaskQueue
 *  7. 立即返回 200，结果异步推送
 */
export async function handleFeishuCallback(
  cfg: FeishuBridgeConfig,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown; contentType: string }> {
  if (!isFeishuEnabled(cfg)) {
    return { status: 404, body: { error: 'feishu bridge not configured' }, contentType: 'application/json' };
  }

  try {
    let eventBody = body;

    // 加密消息解密
    if (body.encrypt && cfg.encryptKey) {
      try {
        const decrypted = decryptFeishuEvent(cfg.encryptKey, body.encrypt as string);
        eventBody = JSON.parse(decrypted);
      } catch (e) {
        logger.error('feishu event decrypt failed', { error: e instanceof Error ? e.message : String(e) });
        return { status: 400, body: { error: 'decrypt failed' }, contentType: 'application/json' };
      }
    }

    // URL 验证
    if (eventBody.type === 'url_verification') {
      const token = (eventBody.token || '') as string;
      if (token !== cfg.verificationToken) {
        logger.warn('feishu url_verification token mismatch');
        return { status: 403, body: { error: 'invalid token' }, contentType: 'application/json' };
      }
      return { status: 200, body: { challenge: eventBody.challenge }, contentType: 'application/json' };
    }

    // verification_token 校验（v2.0 header.token）
    const header = (eventBody.header || {}) as Record<string, unknown>;
    const headerToken = (header.token || '') as string;
    if (headerToken && headerToken !== cfg.verificationToken) {
      logger.warn('feishu event token mismatch', { expected: cfg.verificationToken.slice(0, 4) + '...' });
      return { status: 403, body: { error: 'invalid verification token' }, contentType: 'application/json' };
    }

    // 解析消息
    const msg = parseFeishuEvent(eventBody);
    if (!msg) {
      // 非消息事件（如关注、群聊加入等），返回 200 确认
      return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
    }

    logger.info('feishu inbound message', { openId: msg.openId, type: msg.messageType, chatType: msg.chatType, eventId: msg.eventId });

    // 非文本消息 → 提示
    if (msg.messageType !== 'text' || !msg.text) {
      await sendFeishuReply(cfg, msg.openId, '目前仅支持文本消息，请输入文字描述您的需求。');
      return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
    }

    // 幂等去重
    const session = getFeishuSession(msg.openId);
    if (isFeishuDuplicate(session, msg.eventId)) {
      logger.info('feishu duplicate event ignored', { eventId: msg.eventId });
      return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
    }
    session.lastActive = new Date().toISOString();
    saveFeishuSessions();

    // 转发到 TaskQueue
    if (!taskQueueRef) {
      logger.error('feishu bridge: taskQueue not initialized');
      await sendFeishuReply(cfg, msg.openId, '服务未就绪，请稍后重试。');
      return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
    }

    const goal = msg.text.trim();
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
        await sendFeishuReply(cfg, msg.openId, '上一个任务仍在处理中，请稍候...');
        return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
      } else {
        record = taskQueueRef.submit(goal, { workspaceDir: cfg.workspace });
        session.taskId = record.id;
      }
    } else {
      record = taskQueueRef.submit(goal, { workspaceDir: cfg.workspace });
      session.taskId = record.id;
    }
    saveFeishuSessions();

    // 异步推送结果
    void pushFeishuResult(cfg, msg.openId, record.id);

    // 立即返回确认（飞书要求 3 秒内响应）
    await sendFeishuReply(cfg, msg.openId, '⏳ 已收到，正在处理中... 完成后将主动推送结果。');
    return { status: 200, body: { code: 0, msg: 'ok' }, contentType: 'application/json' };
  } catch (e) {
    logger.error('feishu callback handler error', { error: e instanceof Error ? e.message : String(e) });
    return { status: 500, body: { error: 'internal error' }, contentType: 'application/json' };
  }
}

/** 发送飞书文本消息（通过 FeishuIntegration 或直接 API） */
export async function sendFeishuReply(cfg: FeishuBridgeConfig, openId: string, content: string): Promise<void> {
  if (feishuIntegration) {
    await feishuIntegration.sendMessage({
      title: '飞虹 Code',
      content,
      receiver: openId,
    });
    return;
  }
  // 降级：直接调用 API
  const feishuCfg: FeishuConfig = { appId: cfg.appId, appSecret: cfg.appSecret, defaultReceiver: openId };
  const integration = new FeishuIntegration(feishuCfg);
  await integration.sendMessage({ title: '飞虹 Code', content, receiver: openId });
}

/** 异步轮询任务结果并推送到飞书 */
async function pushFeishuResult(cfg: FeishuBridgeConfig, openId: string, taskId: string): Promise<void> {
  if (!taskQueueRef) return;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const record = taskQueueRef.get(taskId);
    if (!record) return;

    if (record.status === 'done') {
      const answer = record.result?.finalAnswer || '任务完成，但未生成结果。';
      const maxLen = 3000; // 飞书消息长度限制较宽松
      const truncated = answer.length > maxLen ? answer.slice(0, maxLen) + '\n\n...（结果过长，已截断，请在 Web 控制台查看完整内容）' : answer;
      try {
        await sendFeishuReply(cfg, openId, truncated);
      } catch (e) {
        logger.error('feishu result push failed', { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    if (record.status === 'failed') {
      try {
        await sendFeishuReply(cfg, openId, `❌ 任务失败: ${(record.error || '未知错误').slice(0, 300)}`);
      } catch (e) {
        logger.error('feishu failure push failed', { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
  }

  try {
    await sendFeishuReply(cfg, openId, '⏱️ 任务处理超时，请在 Web 控制台查看进度。');
  } catch { /* 忽略 */ }
}

/* ===================== 初始化 ===================== */

export function initFeishuBridge(): FeishuBridgeConfig {
  loadFeishuSessions();
  const cfg = loadFeishuConfig();
  if (isFeishuEnabled(cfg)) {
    logger.info('feishu bridge enabled', { appId: cfg.appId, workspace: cfg.workspace });
  } else {
    logger.info('feishu bridge disabled (set FH_FEISHU_ENABLED=true and configure credentials)');
  }
  return cfg;
}

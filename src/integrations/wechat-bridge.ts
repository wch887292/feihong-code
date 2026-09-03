/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 微信桥接（WeChat Bridge）：
 *  - 企业微信应用：入站消息回调 + 出站主动回复（双向对话）
 *  - 微信公众号：入站消息回调 + 出站客服消息（双向对话）
 *  - 统一桥接层：消息解析 → 转发 TaskQueue → 结果主动推送
 *
 * 环境变量配置：
 *  企业微信应用：
 *    FH_WECHAT_MODE=wecom
 *    FH_WECOM_CORPID=企业ID
 *    FH_WECOM_CORPSECRET=应用Secret
 *    FH_WECOM_AGENTID=应用AgentId
 *    FH_WECOM_TOKEN=回调Token
 *    FH_WECOM_ENCODING_AES_KEY=消息加解密Key（43位）
 *
 *  微信公众号：
 *    FH_WECHAT_MODE=mp
 *    FH_MP_APPID=公众号AppID
 *    FH_MP_APPSECRET=公众号AppSecret
 *    FH_MP_TOKEN=回调Token
 *    FH_MP_ENCODING_AES_KEY=消息加解密Key（43位）
 *
 *  通用：
 *    FH_WECHAT_WORKSPACE=微信任务工作目录（默认 ~/.fhcode/wechat-workspace）
 *    FH_WECHAT_OFFLINE=true 时使用 mock 模型（无需 API key）
 *
 * 安全：
 *  - 入站消息强制签名校验（fail-closed）
 *  - 加密消息强制 AES 解密（明文模式不推荐但支持）
 *  - access_token 内存缓存 + 自动刷新
 *  - 用户会话隔离（每个微信用户独立任务队列）
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../shared/logger';
import { verifyWecomSignature } from '../web/channels';
import type { TaskQueue, TaskRecord } from '../web/task-queue';

/* ===================== 配置 ===================== */

export type WechatMode = 'wecom' | 'mp' | 'none';

export interface WechatConfig {
  mode: WechatMode;
  // 企业微信
  corpid?: string;
  corpsecret?: string;
  agentid?: string;
  // 公众号
  appid?: string;
  appsecret?: string;
  // 通用
  token: string;
  encodingAesKey?: string;
  workspace: string;
  offline: boolean;
}

export function loadWechatConfig(): WechatConfig {
  const mode = (process.env.FH_WECHAT_MODE || 'none').toLowerCase() as WechatMode;
  const workspace = process.env.FH_WECHAT_WORKSPACE || join(homedir(), '.fhcode', 'wechat-workspace');
  if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });

  return {
    mode,
    corpid: process.env.FH_WECOM_CORPID,
    corpsecret: process.env.FH_WECOM_CORPSECRET,
    agentid: process.env.FH_WECOM_AGENTID,
    appid: process.env.FH_MP_APPID,
    appsecret: process.env.FH_MP_APPSECRET,
    token: process.env.FH_WECOM_TOKEN || process.env.FH_MP_TOKEN || '',
    encodingAesKey: process.env.FH_WECOM_ENCODING_AES_KEY || process.env.FH_MP_ENCODING_AES_KEY,
    workspace,
    offline: process.env.FH_WECHAT_OFFLINE === 'true',
  };
}

export function isWechatEnabled(cfg: WechatConfig): boolean {
  if (cfg.mode === 'wecom') return !!(cfg.corpid && cfg.corpsecret && cfg.agentid && cfg.token);
  if (cfg.mode === 'mp') return !!(cfg.appid && cfg.appsecret && cfg.token);
  return false;
}

/* ===================== 消息加解密（企业微信/公众号通用） ===================== */

/**
 * 企业微信/公众号消息加解密（AES-256-CBC + PKCS7 + base64）。
 * 规范：encodingAESKey + "=" 后 base64 解码得到 32 字节 AES key；
 * IV 为 key 的前 16 字节；明文 = random(16) + msg_len(4字节网络序) + msg + receiveid。
 */
export class WechatCrypto {
  private readonly aesKey: Buffer;
  private readonly iv: Buffer;

  constructor(encodingAesKey: string) {
    if (encodingAesKey.length !== 43) {
      throw new Error(`encodingAESKey 长度应为 43，实际 ${encodingAesKey.length}`);
    }
    this.aesKey = Buffer.from(encodingAesKey + '=', 'base64');
    if (this.aesKey.length !== 32) throw new Error('AES key 解码后长度应为 32 字节');
    this.iv = this.aesKey.subarray(0, 16);
  }

  /** 加密消息，返回 base64 密文 */
  encrypt(plainText: string, receiveId: string): string {
    const random16 = randomBytes(16);
    const msgBuf = Buffer.from(plainText, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(msgBuf.length, 0);
    const receiveBuf = Buffer.from(receiveId, 'utf8');
    const full = Buffer.concat([random16, lenBuf, msgBuf, receiveBuf]);

    // PKCS7 填充
    const blockSize = 32;
    const padLen = blockSize - (full.length % blockSize);
    const padded = Buffer.concat([full, Buffer.alloc(padLen, padLen)]);

    const cipher = createCipheriv('aes-256-cbc', this.aesKey, this.iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return encrypted.toString('base64');
  }

  /** 解密 base64 密文，返回明文和 receiveId */
  decrypt(encryptedBase64: string): { plainText: string; receiveId: string } {
    const encrypted = Buffer.from(encryptedBase64, 'base64');
    const decipher = createDecipheriv('aes-256-cbc', this.aesKey, this.iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    // 去除 PKCS7 填充
    const padLen = decrypted[decrypted.length - 1];
    const content = decrypted.subarray(0, decrypted.length - padLen);

    // 解析：random(16) + msg_len(4) + msg + receiveId
    const msgLen = content.readUInt32BE(16);
    const plainText = content.subarray(20, 20 + msgLen).toString('utf8');
    const receiveId = content.subarray(20 + msgLen).toString('utf8');
    return { plainText, receiveId };
  }
}

/* ===================== XML 解析（零依赖） ===================== */

/** 极简 XML 解析：提取指定标签的文本内容（仅用于微信回调消息，不处理嵌套） */
export function parseXmlTag(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  if (!match) return undefined;
  let val = match[1].trim();
  // 去除 CDATA
  val = val.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  return val;
}

export interface WechatInboundMessage {
  /** 发送方（用户）ID */
  fromUser: string;
  /** 接收方（应用/公众号）ID */
  toUser: string;
  /** 消息类型：text/image/event/... */
  msgType: string;
  /** 文本内容（msgType=text 时） */
  content?: string;
  /** 事件类型（msgType=event 时） */
  event?: string;
  /** 消息ID（幂等去重） */
  msgId?: string;
  /** 原始 XML */
  raw: string;
}

/** 解析微信回调 XML（明文或加密后的明文） */
export function parseWechatMessage(xml: string): WechatInboundMessage {
  return {
    fromUser: parseXmlTag(xml, 'FromUserName') || '',
    toUser: parseXmlTag(xml, 'ToUserName') || '',
    msgType: parseXmlTag(xml, 'MsgType') || '',
    content: parseXmlTag(xml, 'Content'),
    event: parseXmlTag(xml, 'Event'),
    msgId: parseXmlTag(xml, 'MsgId'),
    raw: xml,
  };
}

/* ===================== access_token 管理 ===================== */

interface TokenCache {
  token: string;
  expiresAt: number; // ms 时间戳
}

const tokenCache = new Map<string, TokenCache>();

/** 获取企业微信 access_token（带缓存，提前 5 分钟刷新） */
export async function getWecomAccessToken(cfg: WechatConfig): Promise<string> {
  const cacheKey = `wecom:${cfg.corpid}:${cfg.agentid}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) return cached.token;

  if (!cfg.corpid || !cfg.corpsecret) throw new Error('企业微信 corpid/corpsecret 未配置');
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${cfg.corpid}&corpsecret=${cfg.corpsecret}`;
  const res = await fetch(url);
  const data = await res.json() as { errcode?: number; access_token?: string; expires_in?: number };
  if (data.errcode && data.errcode !== 0) throw new Error(`获取企业微信 access_token 失败: ${data.errcode}`);
  if (!data.access_token) throw new Error('企业微信 access_token 为空');

  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  });
  logger.info('wecom access token refreshed', { agentid: cfg.agentid });
  return data.access_token;
}

/** 获取公众号 access_token（带缓存） */
export async function getMpAccessToken(cfg: WechatConfig): Promise<string> {
  const cacheKey = `mp:${cfg.appid}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) return cached.token;

  if (!cfg.appid || !cfg.appsecret) throw new Error('公众号 appid/appsecret 未配置');
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg.appid}&secret=${cfg.appsecret}`;
  const res = await fetch(url);
  const data = await res.json() as { errcode?: number; access_token?: string; expires_in?: number };
  if (data.errcode && data.errcode !== 0) throw new Error(`获取公众号 access_token 失败: ${data.errcode}`);
  if (!data.access_token) throw new Error('公众号 access_token 为空');

  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  });
  logger.info('mp access token refreshed', { appid: cfg.appid });
  return data.access_token;
}

/* ===================== 出站消息发送 ===================== */

/** 企业微信：发送应用文本消息 */
export async function sendWecomText(cfg: WechatConfig, toUser: string, content: string): Promise<void> {
  const token = await getWecomAccessToken(cfg);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
  const body = {
    touser: toUser,
    msgtype: 'text',
    agentid: Number(cfg.agentid),
    text: { content },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { errcode?: number; errmsg?: string };
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`企业微信发消息失败: ${data.errcode} ${data.errmsg || ''}`);
  }
  logger.info('wecom message sent', { toUser, chars: content.length });
}

/** 公众号：发送客服文本消息 */
export async function sendMpText(cfg: WechatConfig, toUser: string, content: string): Promise<void> {
  const token = await getMpAccessToken(cfg);
  const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`;
  const body = {
    touser: toUser,
    msgtype: 'text',
    text: { content },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as { errcode?: number; errmsg?: string };
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`公众号发消息失败: ${data.errcode} ${data.errmsg || ''}`);
  }
  logger.info('mp message sent', { toUser, chars: content.length });
}

/** 统一发送文本消息（按模式路由） */
export async function sendWechatText(cfg: WechatConfig, toUser: string, content: string): Promise<void> {
  if (cfg.mode === 'wecom') return sendWecomText(cfg, toUser, content);
  if (cfg.mode === 'mp') return sendMpText(cfg, toUser, content);
  throw new Error(`不支持的微信模式: ${cfg.mode}`);
}

/* ===================== 会话管理（用户 ↔ 任务映射） ===================== */

interface WechatSession {
  userId: string;
  taskId?: string;
  lastActive: string;
  msgIds: string[]; // 最近处理的消息ID（幂等去重）
}

const sessions = new Map<string, WechatSession>();
const SESSION_FILE = join(homedir(), '.fhcode', 'wechat-sessions.json');

function loadSessions(): void {
  if (existsSync(SESSION_FILE)) {
    try {
      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      for (const [k, v] of Object.entries(data)) sessions.set(k, v as WechatSession);
    } catch (e) {
      logger.warn('wechat sessions load failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

function saveSessions(): void {
  try {
    const dir = join(homedir(), '.fhcode');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: Record<string, WechatSession> = {};
    for (const [k, v] of sessions) data[k] = v;
    writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    logger.warn('wechat sessions save failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

function getSession(userId: string): WechatSession {
  let s = sessions.get(userId);
  if (!s) {
    s = { userId, lastActive: new Date().toISOString(), msgIds: [] };
    sessions.set(userId, s);
  }
  return s;
}

/** 消息幂等去重：已处理的 msgId 返回 true */
function isDuplicate(session: WechatSession, msgId?: string): boolean {
  if (!msgId) return false;
  if (session.msgIds.includes(msgId)) return true;
  session.msgIds.push(msgId);
  if (session.msgIds.length > 100) session.msgIds = session.msgIds.slice(-100);
  return false;
}

/* ===================== 桥接核心 ===================== */

let taskQueueRef: TaskQueue | null = null;

/** 注入 TaskQueue 引用（web server 启动时调用） */
export function setWechatTaskQueue(queue: TaskQueue): void {
  taskQueueRef = queue;
}

/**
 * 处理微信入站消息：
 *  1. 签名校验（fail-closed）
 *  2. 解密（如配置了 encodingAESKey）
 *  3. XML 解析
 *  4. 幂等去重
 *  5. 转发到 TaskQueue（新任务或续接）
 *  6. 立即返回"处理中"提示，结果异步推送
 *
 * 返回被动回复的 XML 明文（微信服务器要求 5 秒内响应）。
 */
export async function handleWechatCallback(
  cfg: WechatConfig,
  query: { msg_signature?: string; signature?: string; timestamp?: string; nonce?: string; echostr?: string },
  body: string,
): Promise<{ status: number; body: string; contentType: string }> {
  // 未启用 → 404
  if (!isWechatEnabled(cfg)) {
    return { status: 404, body: 'wechat bridge not configured', contentType: 'text/plain' };
  }

  // URL 验证（GET 请求带 echostr）
  if (query.echostr) {
    const valid = cfg.mode === 'wecom'
      ? verifyWecomSignature(cfg.token, query.timestamp || '', query.nonce || '', query.echostr, query.msg_signature || '')
      : verifyMpSignature(cfg.token, query.timestamp || '', query.nonce || '', query.signature || '');
    if (!valid) {
      logger.warn('wechat url verify failed', { mode: cfg.mode });
      return { status: 403, body: 'invalid signature', contentType: 'text/plain' };
    }
    // 加密模式下 echostr 需要解密
    if (cfg.encodingAesKey && cfg.mode === 'wecom') {
      try {
        const crypto = new WechatCrypto(cfg.encodingAesKey);
        const { plainText } = crypto.decrypt(query.echostr);
        return { status: 200, body: plainText, contentType: 'text/plain' };
      } catch (e) {
        logger.warn('wecom echostr decrypt failed', { error: e instanceof Error ? e.message : String(e) });
        return { status: 403, body: 'decrypt failed', contentType: 'text/plain' };
      }
    }
    return { status: 200, body: query.echostr, contentType: 'text/plain' };
  }

  // POST 消息处理
  try {
    let plainXml = body;

    // 加密消息解密
    const encryptTag = parseXmlTag(body, 'Encrypt');
    if (encryptTag && cfg.encodingAesKey) {
      const crypto = new WechatCrypto(cfg.encodingAesKey);
      const decrypted = crypto.decrypt(encryptTag);
      plainXml = decrypted.plainText;
    }

    const msg = parseWechatMessage(plainXml);
    logger.info('wechat inbound message', { mode: cfg.mode, from: msg.fromUser, type: msg.msgType, msgId: msg.msgId });

    // 事件消息（关注/取消关注等）→ 简单响应
    if (msg.msgType === 'event') {
      if (msg.event === 'subscribe' || msg.event === 'enter_agent') {
        const reply = buildTextReply(msg, '欢迎使用飞虹 Code AI 助手！直接发送消息即可开始对话，支持代码编写、问题排查、文档生成等。');
        return { status: 200, body: reply, contentType: 'application/xml' };
      }
      return { status: 200, body: 'success', contentType: 'text/plain' };
    }

    // 非文本消息 → 提示
    if (msg.msgType !== 'text' || !msg.content) {
      const reply = buildTextReply(msg, '目前仅支持文本消息，请输入文字描述您的需求。');
      return { status: 200, body: reply, contentType: 'application/xml' };
    }

    // 幂等去重
    const session = getSession(msg.fromUser);
    if (isDuplicate(session, msg.msgId)) {
      logger.info('wechat duplicate message ignored', { msgId: msg.msgId });
      return { status: 200, body: 'success', contentType: 'text/plain' };
    }
    session.lastActive = new Date().toISOString();
    saveSessions();

    // 转发到 TaskQueue
    if (!taskQueueRef) {
      logger.error('wechat bridge: taskQueue not initialized');
      const reply = buildTextReply(msg, '服务未就绪，请稍后重试。');
      return { status: 200, body: reply, contentType: 'application/xml' };
    }

    const goal = msg.content.trim();
    let record: TaskRecord;

    // 多轮续接：如果该用户有未完成的任务，续接；否则新建
    if (session.taskId) {
      const existing = taskQueueRef.get(session.taskId);
      if (existing && (existing.status === 'done' || existing.status === 'failed')) {
        // 终态任务 → 续接
        const continued = taskQueueRef.continueTask(session.taskId, goal);
        if (continued) {
          record = continued;
        } else {
          record = taskQueueRef.submit(goal, { workspaceDir: cfg.workspace });
          session.taskId = record.id;
        }
      } else if (existing && (existing.status === 'queued' || existing.status === 'running')) {
        // 任务仍在运行 → 提示等待
        const reply = buildTextReply(msg, '上一个任务仍在处理中，请稍候...');
        return { status: 200, body: reply, contentType: 'application/xml' };
      } else {
        record = taskQueueRef.submit(goal, { workspaceDir: cfg.workspace });
        session.taskId = record.id;
      }
    } else {
      record = taskQueueRef.submit(goal, { workspaceDir: cfg.workspace });
      session.taskId = record.id;
    }
    saveSessions();

    // 异步等待结果并推送回复（fire-and-forget）
    void pushWechatResult(cfg, msg.fromUser, record.id);

    // 立即返回"处理中"提示（微信要求 5 秒内响应）
    const reply = buildTextReply(msg, '⏳ 已收到，正在处理中... 完成后将主动推送结果。');
    return { status: 200, body: reply, contentType: 'application/xml' };
  } catch (e) {
    logger.error('wechat callback handler error', { error: e instanceof Error ? e.message : String(e) });
    return { status: 500, body: 'internal error', contentType: 'text/plain' };
  }
}

/** 异步轮询任务结果并推送到微信 */
async function pushWechatResult(cfg: WechatConfig, userId: string, taskId: string): Promise<void> {
  if (!taskQueueRef) return;

  // 轮询最多 10 分钟（60 次 × 10 秒）
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const record = taskQueueRef.get(taskId);
    if (!record) return;

    if (record.status === 'done') {
      const answer = record.result?.finalAnswer || '任务完成，但未生成结果。';
      // 微信消息长度限制：企业微信 2048 字节，公众号 600 字节（客服消息）
      const maxLen = cfg.mode === 'wecom' ? 1800 : 500;
      const truncated = answer.length > maxLen ? answer.slice(0, maxLen) + '\n\n...（结果过长，已截断，请在 Web 控制台查看完整内容）' : answer;
      try {
        await sendWechatText(cfg, userId, truncated);
      } catch (e) {
        logger.error('wechat result push failed', { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    if (record.status === 'failed') {
      try {
        await sendWechatText(cfg, userId, `❌ 任务失败: ${(record.error || '未知错误').slice(0, 200)}`);
      } catch (e) {
        logger.error('wechat failure push failed', { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
  }

  // 超时
  try {
    await sendWechatText(cfg, userId, '⏱️ 任务处理超时，请在 Web 控制台查看进度。');
  } catch { /* 忽略 */ }
}

/* ===================== 工具函数 ===================== */

/** 公众号签名校验（SHA1 排序 token/timestamp/nonce） */
export function verifyMpSignature(token: string, timestamp: string, nonce: string, signature: string): boolean {
  if (!token || !signature) return false;
  const sorted = [token, timestamp, nonce].sort().join('');
  const expected = createHash('sha1').update(sorted).digest('hex');
  return expected === signature.toLowerCase();
}

/** 构建被动回复 XML（明文） */
export function buildTextReply(msg: WechatInboundMessage, content: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `<xml>
<ToUserName><![CDATA[${msg.fromUser}]]></ToUserName>
<FromUserName><![CDATA[${msg.toUser}]]></FromUserName>
<CreateTime>${now}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
}

/** 初始化微信桥接（加载会话、检查配置） */
export function initWechatBridge(): WechatConfig {
  loadSessions();
  const cfg = loadWechatConfig();
  if (isWechatEnabled(cfg)) {
    logger.info('wechat bridge enabled', { mode: cfg.mode, workspace: cfg.workspace });
  } else {
    logger.info('wechat bridge disabled (set FH_WECHAT_MODE=wecom|mp and configure credentials)');
  }
  return cfg;
}

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 企业微信入站适配器骨架（fail-open 模式）：
 *  - 抽象 webhook 回调 handler 与长连接 wss 占位两种通道
 *  - 收消息构造 InboundMessage 交 handler
 *  - 凭据与回调 URL 全部从 config 读，缺失时 fail-open 只打日志并返回 started 为 false
 *  - 零硬编码密钥，所有配置通过环境变量注入
 *
 * 环境变量配置：
 *  FH_INBOUND_WECOM_ENABLED=true          # 启用企微入站（默认 false）
 *  FH_WECOM_CORPID=企业 ID                 # 企业 ID
 *  FH_WECOM_CORPSECRET=应用 Secret        # 应用 Secret
 *  FH_WECOM_AGENTID=应用 AgentId          # 应用 AgentId
 *  FH_WECOM_WEBHOOK_URL=回调 URL           # Webhook 回调地址
 *  FH_WECOM_TOKEN=回调 Token              # 回调 Token（签名校验用）
 *  FH_WECOM_ENCODING_AES_KEY=加解密 Key   # 消息加解密 Key（43 位）
 *
 * 安全：
 *  - 配置缺失时 fail-open：只打日志不抛错，保持服务可用
 *  - 零硬编码密钥：所有凭据从环境变量读取
 */

import { logger } from '../../shared/logger';
import type { InboundAdapter, InboundMessage, Platform } from './types';

/* ===================== 配置加载 ===================== */

export interface WecomInboundConfig {
  enabled: boolean;
  corpid?: string;
  corpsecret?: string;
  agentid?: string;
  webhookUrl?: string;
  token?: string;
  encodingAesKey?: string;
}

export function loadWecomInboundConfig(): WecomInboundConfig {
  const enabled = process.env.FH_INBOUND_WECOM_ENABLED === 'true';
  
  // 检查必要配置是否存在（fail-open：不全检，缺啥打啥日志）
  if (enabled && !process.env.FH_WECOM_CORPID) {
    logger.warn('wecom inbound enabled but FH_WECOM_CORPID not set');
  }
  if (enabled && !process.env.FH_WECOM_CORPSECRET) {
    logger.warn('wecom inbound enabled but FH_WECOM_CORPSECRET not set');
  }
  if (enabled && !process.env.FH_WECOM_AGENTID) {
    logger.warn('wecom inbound enabled but FH_WECOM_AGENTID not set');
  }
  if (enabled && !process.env.FH_WECOM_WEBHOOK_URL) {
    logger.warn('wecom inbound enabled but FH_WECOM_WEBHOOK_URL not set');
  }

  return {
    enabled,
    corpid: process.env.FH_WECOM_CORPID,
    corpsecret: process.env.FH_WECOM_CORPSECRET,
    agentid: process.env.FH_WECOM_AGENTID,
    webhookUrl: process.env.FH_WECOM_WEBHOOK_URL,
    token: process.env.FH_WECOM_TOKEN,
    encodingAesKey: process.env.FH_WECOM_ENCODING_AES_KEY,
  };
}

/* ===================== 企微入站适配器骨架 ===================== */

export class WecomInboundAdapter implements InboundAdapter {
  private readonly config: WecomInboundConfig;
  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private wssServer?: unknown; // WebSocket server 占位（未来扩展）

  constructor(config: WecomInboundConfig) {
    this.config = config;
  }

  /** 返回当前适配器支持的平台 */
  get platform(): Platform {
    return 'wecom';
  }

  /**
   * 启动消息接收：
   *  - 配置完整 → 注册 webhook 回调 + 可选 wss 长连接
   *  - 配置缺失 → fail-open：只打日志，返回 started=false
   */
  async subscribe(handler: (msg: InboundMessage) => Promise<void>): Promise<{ started: boolean; reason?: string }> {
    this.messageHandler = handler;

    // 检查必要配置
    const missing: string[] = [];
    if (!this.config.corpid) missing.push('corpid');
    if (!this.config.corpsecret) missing.push('corpsecret');
    if (!this.config.agentid) missing.push('agentid');
    if (!this.config.webhookUrl) missing.push('webhookUrl');

    if (missing.length > 0) {
      logger.info('wecom inbound adapter skipped', { 
        reason: `missing config: ${missing.join(', ')}`,
        enabled: this.config.enabled,
      });
      return { started: false, reason: `missing config: ${missing.join(', ')}` };
    }

    if (!this.config.enabled) {
      logger.info('wecom inbound adapter disabled by config');
      return { started: false, reason: 'disabled by config' };
    }

    // 初始化 webhook 回调处理器（占位：实际需 Express/Koa 路由注册，暂不上存）
    await this.buildWebhookHandler();
    
    // 初始化 wss 长连接（占位：未来扩展实时推送）
    // this.wssServer = await this.initWss();

    logger.info('wecom inbound adapter started', {
      corpid: this.config.corpid?.slice(0, 8) + '...',
      webhookUrl: this.config.webhookUrl,
    });

    return { started: true };
  }

  /** 停止接收并清理资源 */
  async close(): Promise<void> {
    this.messageHandler = undefined;
    
    // 清理 wss 连接
    if (this.wssServer) {
      // this.wssServer.close();
      this.wssServer = undefined;
    }

    logger.info('wecom inbound adapter closed');
  }

  /**
   * 构建 webhook 回调处理器（占位实现）：
   *  - 验签（如配置了 token）
   *  - 解密（如配置了 encodingAesKey）
   *  - 解析 XML/JSON
   *  - 构造 InboundMessage 交 handler
   */
  private async buildWebhookHandler(): Promise<(req: unknown, res: unknown) => Promise<void>> {
    // TODO: 实际需框架集成（Express/Koa/Fastify）
    // 此处仅返回类型占位，不实现具体路由逻辑
    
    const handler = async (req: unknown, _res: unknown): Promise<void> => {
      // 占位：实际应从 req 解析消息体
      const body = req as {
        ToUserName?: string;
        FromUserName?: string;
        Content?: string;
        MediaId?: string;
        CreateTime?: number;
        agent_id?: string;
        user_id?: string;
        text?: string;
        create_time?: number;
      };
      
      // 验签（如配置了 token）
      if (this.config.token) {
        // TODO: verifySignature(req);
      }

      // 解密（如配置了 encodingAesKey）
      // if (this.config.encodingAesKey) { ... }

      // 解析消息并构造 InboundMessage
      // 企微回调格式示例：
      // {
      //   "ToUserName": "@com",
      //   "FromUserName": "UserID1",
      //   "CreateTime": 1234567890,
      //   "MsgType": "text",
      //   "Content": "你好",
      //   "AgentId": 12345
      // }
      
      const msg: InboundMessage = {
        platform: 'wecom',
        conversationId: body.ToUserName || body.agent_id || 'unknown',
        userId: body.FromUserName || body.user_id || 'unknown',
        text: body.Content || body.text || undefined,
        media: body.MediaId ? JSON.stringify({ type: 'image', mediaId: body.MediaId }) : undefined,
        ts: Math.floor((body.CreateTime || body.create_time || Date.now() / 1000) as number),
      };

      // 交 handler 处理
      if (this.messageHandler) {
        try {
          await this.messageHandler(msg);
        } catch (e) {
          logger.error('wecom inbound handler error', { error: e instanceof Error ? e.message : String(e) });
        }
      }
    };

    return handler;
  }

  /**
   * 初始化 WSS 长连接（占位实现）：
   *  - 用于实时消息推送（替代 webhook 轮询）
   *  - 企微官方支持 Server 事件订阅（需申请权限）
   */
  // private async initWss(): Promise<unknown> {
  //   // TODO: 实现 WebSocket 服务器
  //   // 参考：https://developer.work.weixin.qq.com/document/path/92167
  //   return null;
  // }
}

/**
 * 创建企微入站适配器实例（工厂函数）：
 *  - 自动加载配置
 *  - 配置缺失时返回 null（fail-open）
 */
export function createWecomInboundAdapter(): WecomInboundAdapter | null {
  const config = loadWecomInboundConfig();
  
  if (!config.enabled) {
    logger.debug('wecom inbound adapter not created (disabled)');
    return null;
  }

  // 即使配置缺失也返回实例（subscribe 时会 fail-open）
  return new WecomInboundAdapter(config);
}

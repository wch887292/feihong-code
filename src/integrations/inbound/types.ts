/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 入站消息抽象类型定义（平台无关）：
 *  - InboundMessage：统一消息结构，所有平台入站消息都映射为此格式
 *  - InboundAdapter：入站适配器接口，各平台实现此接口接收消息
 *
 * 设计原则：
 *  - 零硬编码：不绑定任何具体平台凭据
 *  - fail-open：配置缺失时只打日志不抛错，保持服务可用
 *  - 本地优先：默认只映射到本地会话，不外发客户数据
 */

/** 消息平台类型 */
export type Platform = 'wecom' | 'mp' | 'telegram' | 'dingtalk';

/**
 * 入站消息统一结构：
 *  - platform：来源平台
 *  - conversationId：会话 ID（群聊/私聊区分）
 *  - userId：发送者 ID（用户/机器人标识）
 *  - text：文本内容（可为空，如图片消息）
 *  - media：媒体资源（图片/语音/视频等，JSON 字符串）
 *  - ts：时间戳（Unix 秒）
 */
export interface InboundMessage {
  platform: Platform;
  conversationId: string;
  userId: string;
  text?: string;
  media?: string;
  ts: number;
}

/**
 * 入站适配器接口：各平台实现此接口接收消息
 *  - subscribe：启动消息接收（webhook 回调或长连接）
 *  - close：停止接收并清理资源
 *  - platform：返回当前适配器支持的平台
 */
export interface InboundAdapter {
  /** 启动消息接收 */
  subscribe(handler: (msg: InboundMessage) => Promise<void>): Promise<{ started: boolean; reason?: string }>;
  /** 停止接收并清理资源 */
  close(): Promise<void>;
  /** 返回当前适配器支持的平台 */
  get platform(): Platform;
}

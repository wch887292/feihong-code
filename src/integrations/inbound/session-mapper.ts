/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 入站消息到本地会话的映射器：
 *  - 把 InboundMessage 映射为本地 goal（任务目标）
 *  - 默认只映射到本地不外发客户数据（隐私优先）
 *  - 支持多轮对话续接（基于 conversationId + userId 会话上下文）
 *
 * 设计原则：
 *  - 零外发：所有数据仅落盘本地，不主动推送第三方
 *  - 会话隔离：每个用户独立会话上下文
 *  - 可配置扩展：预留 hooks 供未来扩展（如审计日志、数据脱敏）
 */

import type { InboundMessage } from './types';

/**
 * 本地会话上下文：
 *  - conversationId + userId 组合唯一标识一个会话
 *  - messages 存储历史消息（用于多轮对话）
 *  - lastActive 最后活跃时间
 */
export interface LocalSession {
  conversationId: string;
  userId: string;
  messages: Array<{ text: string; ts: number; role: 'user' | 'assistant' }>;
  lastActive: number;
}

/**
 * 会话映射结果：
 *  - goal：生成的任务目标文本
 *  - session：映射后的本地会话
 */
export interface SessionMappingResult {
  goal: string;
  session: LocalSession;
}

/**
 * 会话管理器：维护本地会话状态
 *  - 单例模式，全局共享会话数据
 *  - 支持持久化（预留接口）
 */
class SessionManager {
  private sessions = new Map<string, LocalSession>();

  /** 生成会话键（conversationId + userId 组合） */
  private makeKey(conversationId: string, userId: string): string {
    return `${conversationId}:${userId}`;
  }

  /** 获取或创建会话 */
  getSession(conversationId: string, userId: string): LocalSession {
    const key = this.makeKey(conversationId, userId);
    let session = this.sessions.get(key);
    
    if (!session) {
      session = {
        conversationId,
        userId,
        messages: [],
        lastActive: Math.floor(Date.now() / 1000),
      };
      this.sessions.set(key, session);
    }
    
    return session;
  }

  /** 添加消息到会话 */
  addMessage(session: LocalSession, text: string, role: 'user' | 'assistant'): void {
    session.messages.push({ text, ts: Math.floor(Date.now() / 1000), role });
    session.lastActive = Math.floor(Date.now() / 1000);
    
    // 限制消息数量（防止内存溢出）
    if (session.messages.length > 50) {
      session.messages = session.messages.slice(-50);
    }
  }

  /** 获取最近 N 条用户消息（用于构建 context） */
  getUserContext(session: LocalSession, limit = 10): string {
    const userMsgs = session.messages
      .filter(m => m.role === 'user')
      .slice(-limit)
      .map(m => m.text);
    
    return userMsgs.join('\n');
  }

  /** 保存会话（预留持久化接口） */
  saveSession(_session: LocalSession): void {
    // TODO: 持久化到本地文件/数据库
    // 当前仅内存存储
  }
}

const sessionManager = new SessionManager();

/**
 * 映射入站消息为本地会话：
 *  - 提取文本内容作为 goal
 *  - 维护会话上下文（多轮对话）
 *  - 返回映射结果
 */
export function mapInboundToSession(msg: InboundMessage): SessionMappingResult {
  const session = sessionManager.getSession(msg.conversationId, msg.userId);
  
  // 构建 goal：优先使用文本内容，无文本则提示
  const goal = msg.text?.trim() || '收到一条无文本内容的消息，请确认是否需要人工处理。';
  
  // 添加用户消息到会话
  sessionManager.addMessage(session, goal, 'user');
  
  // 如果有历史消息，附加到 goal 作为上下文
  const context = sessionManager.getUserContext(session);
  if (context) {
    // 前 N-1 条作为上下文，最后一条是当前 goal
    const lines = context.split('\n');
    if (lines.length > 1) {
      const previous = lines.slice(0, -1).join('\n');
      const current = lines[lines.length - 1];
      sessionManager.addMessage(session, `【上下文】${previous}`, 'assistant');
      sessionManager.addMessage(session, current, 'user');
    }
  }
  
  // 保存会话
  sessionManager.saveSession(session);
  
  return {
    goal,
    session,
  };
}

/**
 * 获取会话信息（用于调试/监控）
 */
export function getSessionInfo(conversationId: string, userId: string): LocalSession | null {
  const key = sessionManager['makeKey'](conversationId, userId);
  return sessionManager['sessions'].get(key) || null;
}

/**
 * 清空所有会话（用于测试/重置）
 */
export function clearAllSessions(): void {
  sessionManager['sessions'].clear();
}

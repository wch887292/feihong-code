/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 会话状态：维护消息历史，供编排循环与 M3 长时任务恢复复用。
 */
import type { ChatMessage } from '../models/model.interface';
import type { RunId } from '../shared/types';

export interface SessionState {
  runId: RunId;
  cwd: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export class SessionStore {
  private state: SessionState;

  constructor(runId: RunId, cwd: string) {
    const now = new Date().toISOString();
    this.state = { runId, cwd, messages: [], createdAt: now, updatedAt: now };
  }

  get runId(): RunId {
    return this.state.runId;
  }

  get messages(): ChatMessage[] {
    return this.state.messages;
  }

  append(msg: ChatMessage): void {
    this.state.messages.push(msg);
    this.state.updatedAt = new Date().toISOString();
  }

  snapshot(): SessionState {
    return structuredClone(this.state) as SessionState;
  }

  /** 从持久化检查点恢复会话（M3 resume 用） */
  static restore(state: SessionState): SessionStore {
    const inst = new SessionStore(state.runId, state.cwd);
    (inst as unknown as { state: SessionState }).state = {
      ...structuredClone(state),
      messages: structuredClone(state.messages),
    };
    return inst;
  }
}

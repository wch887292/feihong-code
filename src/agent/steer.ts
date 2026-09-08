/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P3 steer() 中途人工纠偏：
 *  - 任务运行中用户插话改目标，模型按新指令继续（不中断、不回滚已确认变更）
 *  - SteerSource 是事件源抽象：orchestrator 循环顶部 drain() 取出待注入消息
 *  - InMemorySteerQueue 是默认实现：线程安全的 FIFO 队列，push 后下一轮循环消费
 *  - Web/SSE 场景可自定义 SteerSource（如从 Redis/消息队列拉取）
 *
 * 设计原则：
 *  - steer 不替代 abort（中断信号仍走 AbortSignal），steer 是"改方向"而非"停止"
 *  - steer 消息注入为 user 角色，模型在下一轮自然响应，无需特殊协议
 *  - 已确认的文件变更保留（change-manager 暂存状态不动），只重置错误/循环计数
 */

/** 单条 steer 消息 */
export interface SteerMessage {
  /** 唯一标识（用于审计/去重） */
  id: string;
  /** 用户插话内容（自然语言） */
  message: string;
  /** 可选聚焦点（如"只改 X 文件"、"不要动 Y 模块"） */
  focus?: string;
  /** 推入时间（ISO） */
  pushedAt: string;
}

/**
 * steer 事件源抽象。
 * orchestrator 每轮循环顶部调用 drain() 取出所有待注入消息并消费。
 */
export interface SteerSource {
  /** 取出所有待注入的 steer 消息（消费后清空），无消息返回空数组 */
  drain(): SteerMessage[];
  /** 推入一条 steer 消息（线程安全，可在任意时刻调用） */
  push(msg: Omit<SteerMessage, 'id' | 'pushedAt'> & { id?: string }): SteerMessage;
  /** 当前待消费消息数（调试/监控用） */
  size(): number;
}

/**
 * 内存 FIFO steer 队列（默认实现）。
 * 单进程内使用；多进程/分布式场景请自定义 SteerSource（如 Redis Stream）。
 */
export class InMemorySteerQueue implements SteerSource {
  private queue: SteerMessage[] = [];

  drain(): SteerMessage[] {
    if (this.queue.length === 0) return [];
    const msgs = this.queue;
    this.queue = [];
    return msgs;
  }

  push(
    msg: Omit<SteerMessage, 'id' | 'pushedAt'> & { id?: string },
  ): SteerMessage {
    const full: SteerMessage = {
      id: msg.id ?? `steer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: msg.message,
      focus: msg.focus,
      pushedAt: new Date().toISOString(),
    };
    this.queue.push(full);
    return full;
  }

  size(): number {
    return this.queue.length;
  }
}

/** 便捷工厂：创建内存 steer 队列 */
export function createSteerQueue(): InMemorySteerQueue {
  return new InMemorySteerQueue();
}

/**
 * 飞虹 Code - 事件驱动 Agent (阶段二-2)
 *
 * 支持事件触发的自动化 Agent：
 * - 定时任务（cron 表达式）
 * - 文件变更监听（文件创建/修改/删除）
 * - Webhook 接收（GitHub PR、飞书消息等）
 *
 * 事件触发时自动唤醒 Agent 处理任务，处理完成后回到休眠状态。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from 'fs';
import { join, resolve } from 'path';
import { logger } from '../shared/logger';

/** 事件类型 */
export type EventType = 'cron' | 'file-change' | 'webhook' | 'manual';

/** 事件严重程度 */
export type EventSeverity = 'info' | 'warning' | 'critical';

/** 事件定义 */
export interface AgentEvent {
  id: string;
  type: EventType;
  severity: EventSeverity;
  title: string;
  description: string;
  /** 事件源（cron 表达式 / 文件路径 / webhook 来源） */
  source: string;
  /** 事件负载 */
  payload?: Record<string, unknown>;
  /** 触发时间 */
  triggeredAt: string;
  /** 关联的 Agent 任务 ID */
  taskId?: string;
  /** 处理状态 */
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored';
  /** 处理结果 */
  result?: string;
  /** 处理完成时间 */
  completedAt?: string;
}

/** 定时任务配置 */
export interface CronTaskConfig {
  id: string;
  name: string;
  /** cron 表达式（5段：分 时 日 月 周） */
  cron: string;
  /** 触发时执行的 Agent 任务描述 */
  task: string;
  /** 是否启用 */
  enabled: boolean;
  /** 上次触发时间 */
  lastTriggeredAt?: string;
  /** 触发次数 */
  triggerCount: number;
}

/** 文件监听配置 */
export interface FileWatchConfig {
  id: string;
  name: string;
  /** 监听的目录或文件路径 */
  path: string;
  /** 监听的事件类型 */
  events: Array<'create' | 'modify' | 'delete'>;
  /** 文件过滤（glob 模式） */
  filter?: string[];
  /** 触发时执行的 Agent 任务描述模板（支持 {path}、{event} 变量） */
  taskTemplate: string;
  /** 是否启用 */
  enabled: boolean;
  /** 防抖时间（毫秒），避免频繁触发 */
  debounceMs: number;
}

/** Webhook 配置 */
export interface WebhookConfig {
  id: string;
  name: string;
  /** Webhook 路径（如 /webhook/github） */
  path: string;
  /** 来源（github / feishu / custom） */
  source: string;
  /** 验证密钥（可选） */
  secret?: string;
  /** 事件过滤（如 pull_request.opened） */
  eventFilter?: string[];
  /** 触发时执行的 Agent 任务描述模板 */
  taskTemplate: string;
  /** 是否启用 */
  enabled: boolean;
}

/** 事件驱动配置 */
export interface EventDrivenConfig {
  cronTasks: CronTaskConfig[];
  fileWatches: FileWatchConfig[];
  webhooks: WebhookConfig[];
  /** 事件历史最大保留数 */
  maxHistory: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: EventDrivenConfig = {
  cronTasks: [],
  fileWatches: [],
  webhooks: [],
  maxHistory: 100,
};

/**
 * 简单的 cron 表达式解析器（支持 5 段：分 时 日 月 周）
 * 仅支持 *、数字、逗号、范围（a-b）、步长（星号/n）
 */
function parseCron(cron: string): {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
} {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`无效的 cron 表达式: ${cron}（需要5段）`);

  const parseField = (field: string, min: number, max: number): number[] => {
    if (field === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    const values = new Set<number>();
    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [range, step] = part.split('/');
        const stepNum = parseInt(step, 10);
        const [start, end] = range === '*' ? [min, max] : range.split('-').map(Number);
        for (let i = start; i <= end; i += stepNum) values.add(i);
      } else if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        for (let i = start; i <= end; i++) values.add(i);
      } else {
        values.add(parseInt(part, 10));
      }
    }
    return Array.from(values).filter((v) => v >= min && v <= max).sort((a, b) => a - b);
  };

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

/** 检查 cron 任务是否应该在当前时间触发 */
function shouldTriggerCron(cron: string, date: Date): boolean {
  try {
    const parsed = parseCron(cron);
    return (
      parsed.minute.includes(date.getMinutes()) &&
      parsed.hour.includes(date.getHours()) &&
      parsed.dayOfMonth.includes(date.getDate()) &&
      parsed.month.includes(date.getMonth() + 1) &&
      parsed.dayOfWeek.includes(date.getDay())
    );
  } catch {
    return false;
  }
}

/**
 * 事件驱动 Agent 管理器
 */
export class EventDrivenAgentManager {
  private config: EventDrivenConfig;
  private configPath: string;
  private events: AgentEvent[] = [];
  private cronTimer?: NodeJS.Timeout;
  private fileWatchers: Map<string, ReturnType<typeof watch>> = new Map();
  private fileDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private onEventCallback?: (event: AgentEvent) => Promise<void>;

  constructor(homeDir: string, onEvent?: (event: AgentEvent) => Promise<void>) {
    const eventDir = join(homeDir, 'event-driven');
    if (!existsSync(eventDir)) mkdirSync(eventDir, { recursive: true });
    this.configPath = join(eventDir, 'config.json');
    this.config = this.loadConfig();
    this.onEventCallback = onEvent;
    this.events = this.loadEvents();
  }

  /** 加载配置 */
  private loadConfig(): EventDrivenConfig {
    if (existsSync(this.configPath)) {
      try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(this.configPath, 'utf-8')) };
      } catch (e) {
        logger.warn('event-driven config load failed', { error: String(e) });
      }
    }
    return { ...DEFAULT_CONFIG };
  }

  /** 保存配置 */
  private saveConfig(): void {
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /** 加载事件历史 */
  private loadEvents(): AgentEvent[] {
    const eventsPath = this.configPath.replace('config.json', 'events.json');
    if (existsSync(eventsPath)) {
      try {
        return JSON.parse(readFileSync(eventsPath, 'utf-8'));
      } catch {
        return [];
      }
    }
    return [];
  }

  /** 保存事件历史 */
  private saveEvents(): void {
    const eventsPath = this.configPath.replace('config.json', 'events.json');
    const toSave = this.events.slice(-this.config.maxHistory);
    writeFileSync(eventsPath, JSON.stringify(toSave, null, 2), 'utf-8');
  }

  /** 启动事件驱动引擎 */
  start(): void {
    logger.info('event-driven agent manager starting');

    // 启动 cron 检查器（每分钟检查一次）
    this.cronTimer = setInterval(() => this.checkCronTasks(), 60000);

    // 启动文件监听器
    for (const watch of this.config.fileWatches) {
      if (watch.enabled) this.startFileWatch(watch);
    }

    logger.info('event-driven agent manager started', {
      cronTasks: this.config.cronTasks.filter((t) => t.enabled).length,
      fileWatches: this.config.fileWatches.filter((w) => w.enabled).length,
      webhooks: this.config.webhooks.filter((w) => w.enabled).length,
    });
  }

  /** 停止事件驱动引擎 */
  stop(): void {
    if (this.cronTimer) clearInterval(this.cronTimer);
    for (const watcher of this.fileWatchers.values()) watcher.close();
    this.fileWatchers.clear();
    for (const timer of this.fileDebounceTimers.values()) clearTimeout(timer);
    this.fileDebounceTimers.clear();
    logger.info('event-driven agent manager stopped');
  }

  /** 检查 cron 任务 */
  private checkCronTasks(): void {
    const now = new Date();
    for (const task of this.config.cronTasks) {
      if (!task.enabled) continue;
      if (shouldTriggerCron(task.cron, now)) {
        // 避免同一分钟内重复触发
        if (task.lastTriggeredAt && new Date(task.lastTriggeredAt).getMinutes() === now.getMinutes()) {
          continue;
        }
        this.triggerEvent({
          type: 'cron',
          severity: 'info',
          title: task.name,
          description: `定时任务触发: ${task.cron}`,
          source: task.cron,
          payload: { taskId: task.id, task: task.task },
        });
        task.lastTriggeredAt = now.toISOString();
        task.triggerCount++;
        this.saveConfig();
      }
    }
  }

  /** 启动文件监听 */
  private startFileWatch(config: FileWatchConfig): void {
    try {
      const watcher = watch(resolve(config.path), { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const event = eventType === 'rename' ? 'create' : 'modify';
        if (!config.events.includes(event as 'create' | 'modify' | 'delete')) return;

        // 防抖
        const debounceKey = `${config.id}:${filename}`;
        if (this.fileDebounceTimers.has(debounceKey)) {
          clearTimeout(this.fileDebounceTimers.get(debounceKey)!);
        }
        this.fileDebounceTimers.set(
          debounceKey,
          setTimeout(() => {
            this.fileDebounceTimers.delete(debounceKey);
            const task = config.taskTemplate
              .replace('{path}', filename.toString())
              .replace('{event}', event);
            this.triggerEvent({
              type: 'file-change',
              severity: 'info',
              title: config.name,
              description: `文件变更: ${filename} (${event})`,
              source: config.path,
              payload: { watchId: config.id, filename: filename.toString(), event, task },
            });
          }, config.debounceMs),
        );
      });
      this.fileWatchers.set(config.id, watcher);
      logger.info('file watch started', { id: config.id, path: config.path });
    } catch (e) {
      logger.error('file watch failed', { id: config.id, path: config.path, error: String(e) });
    }
  }

  /** 触发事件 */
  async triggerEvent(eventData: Omit<AgentEvent, 'id' | 'triggeredAt' | 'status'>): Promise<AgentEvent> {
    const event: AgentEvent = {
      ...eventData,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      triggeredAt: new Date().toISOString(),
      status: 'pending',
    };

    this.events.push(event);
    this.saveEvents();

    logger.info('event triggered', { id: event.id, type: event.type, title: event.title });

    // 异步处理事件
    if (this.onEventCallback) {
      event.status = 'processing';
      try {
        await this.onEventCallback(event);
        event.status = 'completed';
        event.completedAt = new Date().toISOString();
      } catch (e) {
        event.status = 'failed';
        event.result = String(e);
        event.completedAt = new Date().toISOString();
        logger.error('event processing failed', { id: event.id, error: String(e) });
      }
      this.saveEvents();
    }

    return event;
  }

  /** 处理 webhook 请求 */
  async handleWebhook(path: string, payload: Record<string, unknown>, headers: Record<string, string>): Promise<{ ok: boolean; event?: AgentEvent; error?: string }> {
    const webhook = this.config.webhooks.find((w) => w.path === path && w.enabled);
    if (!webhook) return { ok: false, error: 'Webhook 未找到或未启用' };

    // 验证密钥（如果配置了）
    if (webhook.secret) {
      const signature = headers['x-hub-signature'] || headers['x-gitlab-token'] || '';
      if (signature && signature !== webhook.secret) {
        return { ok: false, error: 'Webhook 验证失败' };
      }
    }

    // 事件过滤
    const eventType = headers['x-github-event'] || headers['x-gitlab-event'] || (payload as any).event || 'unknown';
    if (webhook.eventFilter && webhook.eventFilter.length > 0) {
      if (!webhook.eventFilter.some((f) => eventType.includes(f))) {
        return { ok: true, event: undefined }; // 忽略不匹配的事件
      }
    }

    // 生成任务描述
    const task = webhook.taskTemplate
      .replace('{event}', eventType)
      .replace('{payload}', JSON.stringify(payload).slice(0, 500));

    const event = await this.triggerEvent({
      type: 'webhook',
      severity: 'info',
      title: `${webhook.name}: ${eventType}`,
      description: `Webhook 事件: ${eventType}`,
      source: webhook.source,
      payload: { webhookId: webhook.id, eventType, payload, task },
    });

    return { ok: true, event };
  }

  // ========== 配置管理方法 ==========

  getConfig(): EventDrivenConfig {
    return this.config;
  }

  getEvents(limit?: number): AgentEvent[] {
    return this.events.slice(-(limit || 50)).reverse();
  }

  addCronTask(task: Omit<CronTaskConfig, 'id' | 'triggerCount'>): CronTaskConfig {
    const newTask: CronTaskConfig = {
      ...task,
      id: `cron-${Date.now()}`,
      triggerCount: 0,
    };
    this.config.cronTasks.push(newTask);
    this.saveConfig();
    return newTask;
  }

  updateCronTask(id: string, updates: Partial<CronTaskConfig>): CronTaskConfig | null {
    const task = this.config.cronTasks.find((t) => t.id === id);
    if (!task) return null;
    Object.assign(task, updates);
    this.saveConfig();
    return task;
  }

  removeCronTask(id: string): boolean {
    const index = this.config.cronTasks.findIndex((t) => t.id === id);
    if (index === -1) return false;
    this.config.cronTasks.splice(index, 1);
    this.saveConfig();
    return true;
  }

  addFileWatch(watch: Omit<FileWatchConfig, 'id'>): FileWatchConfig {
    const newWatch: FileWatchConfig = { ...watch, id: `watch-${Date.now()}` };
    this.config.fileWatches.push(newWatch);
    this.saveConfig();
    if (newWatch.enabled) this.startFileWatch(newWatch);
    return newWatch;
  }

  removeFileWatch(id: string): boolean {
    const index = this.config.fileWatches.findIndex((w) => w.id === id);
    if (index === -1) return false;
    const watcher = this.fileWatchers.get(id);
    if (watcher) watcher.close();
    this.fileWatchers.delete(id);
    this.config.fileWatches.splice(index, 1);
    this.saveConfig();
    return true;
  }

  addWebhook(webhook: Omit<WebhookConfig, 'id'>): WebhookConfig {
    const newWebhook: WebhookConfig = { ...webhook, id: `webhook-${Date.now()}` };
    this.config.webhooks.push(newWebhook);
    this.saveConfig();
    return newWebhook;
  }

  removeWebhook(id: string): boolean {
    const index = this.config.webhooks.findIndex((w) => w.id === id);
    if (index === -1) return false;
    this.config.webhooks.splice(index, 1);
    this.saveConfig();
    return true;
  }
}

/**
 * 便捷函数：创建事件驱动 Agent 管理器
 */
export function createEventDrivenAgentManager(homeDir: string, onEvent?: (event: AgentEvent) => Promise<void>): EventDrivenAgentManager {
  return new EventDrivenAgentManager(homeDir, onEvent);
}

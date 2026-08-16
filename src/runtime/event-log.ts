/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 事件日志（append-only JSONL，单一可信源）。
 * 所有模型调用、工具调用、结果都落盘，便于审计与 M3 长时任务恢复。
 */
import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { homedir } from 'os';
import type { RunId } from '../shared/types';
import { logger } from '../shared/logger';

export type EventType =
  | 'session.start'
  | 'session.resume'
  | 'session.end'
  | 'model.request'
  | 'model.response'
  | 'tool.call'
  | 'tool.result'
  | 'plan'
  | 'error'
  | 'self-heal'
  | 'self-heal.attempt'
  | 'context.compact'
  | 'experience.extracted';

export interface AgentEvent {
  ts: string;
  runId: RunId;
  type: EventType;
  [key: string]: unknown;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? p.replace(/^~/, homedir()) : p;
}

export class EventLog {
  private readonly runId: RunId;
  private readonly file: string;

  constructor(runId: RunId, logDir: string) {
    this.runId = runId;
    this.file = `${expandHome(logDir)}/${runId}.jsonl`;
  }

  async append(type: EventType, payload: Record<string, unknown>): Promise<void> {
    const ev: AgentEvent = { ts: new Date().toISOString(), runId: this.runId, type, ...payload };
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, JSON.stringify(ev) + '\n', 'utf8');
    } catch (e) {
      logger.warn('event-log append failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  get filePath(): string {
    return this.file;
  }
}

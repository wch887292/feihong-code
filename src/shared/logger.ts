/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 结构化 JSON 日志（铁律：禁止散落 console.log，日志带 runId，禁止记录密钥/PII）
 */
import type { LogEntry, RunId } from './types';

let runId: RunId = 'unknown';

/** 在 CLI 启动时为本次运行设置唯一 runId */
export function setRunId(id: RunId): void {
  runId = id;
}

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const lower = k.toLowerCase();
    if (/apikey|secret|token|password|passwd|authorization/.test(lower)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(level: LogEntry['level'], msg: string, meta: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    runId,
    ...redact(meta),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  info: (msg: string, meta: Record<string, unknown> = {}) => emit('info', msg, meta),
  warn: (msg: string, meta: Record<string, unknown> = {}) => emit('warn', msg, meta),
  error: (msg: string, meta: Record<string, unknown> = {}) => emit('error', msg, meta),
  debug: (msg: string, meta: Record<string, unknown> = {}) => emit('debug', msg, meta),
};

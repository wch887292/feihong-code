/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
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

// M12 修复：扩充敏感 key 识别（覆盖常见密钥/令牌字段名）
const SENSITIVE_KEY_RE =
  /api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|token|password|passwd|pwd|authorization|bearer|private[_-]?key|cookie|credential|passphrase|session[_-]?id|x-api-key/i;
// 值形态：sk-... / JWT / 长十六进制或 base64 令牌（仅对字符串值生效，避免误伤普通文本）
const SENSITIVE_VALUE_RE =
  /\bsk-[A-Za-z0-9_-]{8,}\b|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9+/]{32,}={0,2}/;

/** 元数据脱敏：敏感 key 整值遮蔽；普通 key 但值疑似令牌也遮蔽。 */
export function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'string' && SENSITIVE_VALUE_RE.test(v)) {
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

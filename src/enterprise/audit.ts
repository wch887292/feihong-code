/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M4 审计：防篡改哈希链审计日志。
 *
 * 每条记录携带 prevHash 与自身 hash：
 *   hash = sha256(seq|ts|tenant|user|role|runId|action|resource|decision|reason|prevHash)
 * 任何一条被改写/删除/插入，都会导致后续链断裂，`fhcode audit verify` 可精确定位断点。
 *
 * 落盘：<租户目录>/audit/audit-YYYY-MM.jsonl（按月切分，append-only）
 * 脱敏：resource/reason 中的 key/token/secret/password 一律替换为 ***
 */
import { createHash } from 'crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
  writeSync,
} from 'fs';
import { join } from 'path';
import { logger } from '../shared/logger';

export type AuditDecision = 'allow' | 'deny' | 'approved' | 'rejected' | 'info';

export interface AuditRecord {
  seq: number;
  ts: string;
  tenantId: string;
  userId: string;
  role: string;
  runId: string;
  /** 动作标识，如 tool:run_shell / session:start / rollback:execute */
  action: string;
  resource: string;
  decision: AuditDecision;
  reason: string;
  prevHash: string;
  hash: string;
}

export type AuditInput = Omit<AuditRecord, 'seq' | 'ts' | 'prevHash' | 'hash'>;

const GENESIS = '0'.repeat(64);

// M12 修复：扩充敏感字段识别，覆盖常见密钥/令牌形态（含 JSON 键值、Bearer、JWT）。
const SECRET_KEYS =
  'api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|' +
  'token|password|passwd|pwd|authorization|bearer|private[_-]?key|cookie|credential|' +
  'passphrase|session[_-]?id|x-api-key';
// 匹配 key=value / key:value / "key":"value" / 'key':'value'，捕获前导与值
const SECRET_RE = new RegExp(
  `((?:${SECRET_KEYS})["']?\\s*[=:]\\s*["']?)([^"'\\s]+)`,
  'gi',
);
const BEARER_RE = /\bBearer\s+(\S+)/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const SK_RE = /\b(sk-[A-Za-z0-9_-]{8,})\b/g;

/** 敏感信息脱敏（审计日志同样不得泄密） */
export function redact(text: string): string {
  return text
    .replace(SECRET_RE, '$1***')
    .replace(BEARER_RE, 'Bearer ***')
    .replace(JWT_RE, '***')
    .replace(SK_RE, 'sk-***');
}

function computeHash(r: Omit<AuditRecord, 'hash'>): string {
  const payload = [
    r.seq,
    r.ts,
    r.tenantId,
    r.userId,
    r.role,
    r.runId,
    r.action,
    r.resource,
    r.decision,
    r.reason,
    r.prevHash,
  ].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function monthFile(dir: string, d = new Date()): string {
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return join(dir, `audit-${ym}.jsonl`);
}

/**
 * M5 修复：读取审计文件最后一条有效记录（用于跨进程重算 seq/prevHash）。
 * 空文件或无有效行返回 null。
 */
function readLastRecord(file: string): AuditRecord | null {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      return JSON.parse(line) as AuditRecord;
    } catch {
      /* 跳过损坏行 */
    }
  }
  return null;
}

// M5 修复：跨进程写锁参数
const AUDIT_LOCK_FILE = '.audit.lock';
const AUDIT_LOCK_TIMEOUT_MS = 5000;
const AUDIT_LOCK_STALE_MS = 10000;
/** 退避上限：初始 10ms，指数增长到 200ms，减少空转 CPU */
const AUDIT_LOCK_BACKOFF_MAX_MS = 200;

// 模块级复用（避免每次 sleepSync 重建 SharedArrayBuffer）
const SLEEP_SAB = new SharedArrayBuffer(4);
const SLEEP_VIEW = new Int32Array(SLEEP_SAB);

/** 跨进程同步睡眠（Node 主线程可用 Atomics.wait 阻塞） */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(SLEEP_VIEW, 0, 0, ms);
  } catch {
    /* 不支持时直接返回，退化为忙等 */
  }
}

/**
 * M5 修复：跨进程 advisory 文件锁。
 * 用 `openSync(path,'wx')` 原子创建锁文件；持有期间执行 fn；
 * 锁超时/过期会被清理，避免挂死进程导致审计永久阻塞。
 */
function withAuditLock(dir: string, fn: () => void): void {
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, AUDIT_LOCK_FILE);
  const deadline = Date.now() + AUDIT_LOCK_TIMEOUT_MS;
  let backoffMs = 10;
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      try {
        fn();
        return;
      } finally {
        try {
          unlinkSync(lockPath);
        } catch {
          /* 忽略清理失败 */
        }
      }
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'EEXIST') {
        // 锁被占用：检查是否过期（进程崩溃遗留）
        try {
          const st = statSync(lockPath);
          if (Date.now() - st.mtimeMs > AUDIT_LOCK_STALE_MS) {
            unlinkSync(lockPath);
            backoffMs = 10; // 锁已清理，重置退避
            continue;
          }
        } catch {
          /* 锁已消失，重试 */
        }
        if (Date.now() > deadline) {
          throw new Error('审计写入锁等待超时（可能存在挂死的写进程）');
        }
        // 指数退避（10ms → 200ms），降低锁竞争下的 CPU 空转
        sleepSync(backoffMs);
        backoffMs = Math.min(backoffMs * 2, AUDIT_LOCK_BACKOFF_MAX_MS);
        continue;
      }
      throw e;
    }
  }
}

/** 列出审计目录下按时间排序的全部分片文件 */
export function auditFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^audit-\d{4}-\d{2}\.jsonl$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export function readAudit(dir: string): AuditRecord[] {
  const out: AuditRecord[] = [];
  for (const file of auditFiles(dir)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AuditRecord);
      } catch {
        // 损坏行保留为占位，verify 时会因 seq 不连续而报错
        out.push({
          seq: -1,
          ts: '',
          tenantId: '',
          userId: '',
          role: '',
          runId: '',
          action: 'corrupted-line',
          resource: file,
          decision: 'info',
          reason: '无法解析的审计行',
          prevHash: '',
          hash: '',
        });
      }
    }
  }
  return out;
}

/**
 * 审计器：同步写入，保证进程崩溃前的记录不丢（审计不可缓冲）。
 */
export class AuditLog {
  private seq = 0;
  private prevHash = GENESIS;

  constructor(private readonly dir: string) {
    const existing = readAudit(dir);
    const last = existing[existing.length - 1];
    if (last && last.seq > 0) {
      this.seq = last.seq;
      this.prevHash = last.hash;
    }
  }

  record(input: AuditInput): AuditRecord {
    // M5 修复：跨进程加锁，并在锁内从文件尾部重算 seq/prevHash，
    // 避免多进程各自维护的内存计数相互覆盖而破坏哈希链。
    let rec!: AuditRecord;
    withAuditLock(this.dir, () => {
      const file = monthFile(this.dir);
      const last = readLastRecord(file);
      const seq = last ? last.seq : 0;
      const prevHash = last ? last.hash : GENESIS;
      const base: Omit<AuditRecord, 'hash'> = {
        seq: seq + 1,
        ts: new Date().toISOString(),
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        runId: input.runId,
        action: input.action,
        resource: redact(input.resource).slice(0, 500),
        decision: input.decision,
        reason: redact(input.reason).slice(0, 300),
        prevHash,
      };
      const next: AuditRecord = { ...base, hash: computeHash(base) };
      try {
        mkdirSync(this.dir, { recursive: true });
        appendFileSync(file, JSON.stringify(next) + '\n', 'utf8');
        this.seq = next.seq;
        this.prevHash = next.hash;
        rec = next;
      } catch (e) {
        logger.error('审计写入失败（高危：操作将被拒绝）', {
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    });
    return rec;
  }

  get lastHash(): string {
    return this.prevHash;
  }

  get count(): number {
    return this.seq;
  }
}

export interface VerifyResult {
  ok: boolean;
  total: number;
  brokenAt?: number;
  detail?: string;
}

/** 校验哈希链完整性：seq 连续 + prevHash 衔接 + hash 自洽 */
export function verifyAudit(dir: string): VerifyResult {
  const records = readAudit(dir);
  if (records.length === 0) return { ok: true, total: 0 };

  let prev = GENESIS;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.seq !== i + 1) {
      return {
        ok: false,
        total: records.length,
        brokenAt: i + 1,
        detail: `序号不连续：期望 ${i + 1}，实际 ${r.seq}（疑似删除或插入记录）`,
      };
    }
    if (r.prevHash !== prev) {
      return {
        ok: false,
        total: records.length,
        brokenAt: r.seq,
        detail: `prevHash 不匹配：期望 ${prev.slice(0, 12)}…，实际 ${String(r.prevHash).slice(0, 12)}…`,
      };
    }
    const { hash, ...rest } = r;
    const expect = computeHash(rest);
    if (hash !== expect) {
      return {
        ok: false,
        total: records.length,
        brokenAt: r.seq,
        detail: `记录内容被篡改：hash 不自洽（期望 ${expect.slice(0, 12)}…）`,
      };
    }
    prev = hash;
  }
  return { ok: true, total: records.length };
}

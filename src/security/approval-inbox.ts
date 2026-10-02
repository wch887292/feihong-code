/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P4 审批收件箱（v8.6.0「Always-on 飞虹 dots」收官期）
 *
 * ask 判定的动作进入收件箱等待人工裁决：
 *   submit → pending →（decide）→ approved / rejected
 *           pending →（过期）  → expired
 *
 * 持久化：approvals.json 原子写（tmp 带 PID → renameSync），重启后队列不丢（T4.3）。
 * 审计对接：可选注入 M4 AuditLog，提交与裁决事件均入 hash chain（T4.5）。
 * 幂等保护：已裁决项不可再次裁决（T4.4）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AuditLog, redact } from '../enterprise/audit';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalItem {
  id: string;
  /** 待审批的动作描述 */
  action: string;
  /** 提交原因/上下文 */
  reason: string;
  requestedAt: string;
  status: ApprovalStatus;
  decidedAt?: string;
  decidedBy?: string;
  /** 绝对过期时间（ISO）；到点未裁决自动转 expired */
  expiresAt?: string;
}

interface InboxFile {
  version: 1;
  items: ApprovalItem[];
}

/** 原子写（Windows 文件锁安全：tmp 文件带 PID → renameSync） */
function writeJsonAtomic(target: string, data: InboxFile): void {
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, target);
}

let seqCounter = 0;
function newId(now: Date): string {
  seqCounter += 1;
  const t = now.getTime().toString(36);
  return `ap-${t}-${seqCounter.toString(36)}-${Math.floor(Math.random() * 46656).toString(36).padStart(3, '0')}`;
}

export interface ApprovalInboxOptions {
  /** M4 审计器：提交/裁决事件自动入 hash chain（T4.5） */
  audit?: AuditLog;
  /** 可控时钟（测试注入） */
  now?: () => Date;
  /** 默认审批有效期 ms；0 或负数表示永不过期 */
  defaultTtlMs?: number;
  /** 审计主体（tenant/user/run），默认占位值 */
  auditActor?: { tenantId?: string; userId?: string; role?: string; runId?: string };
}

export class ApprovalInbox {
  private items: ApprovalItem[] = [];
  private readonly filePath: string;
  private readonly now: () => Date;

  constructor(
    dir: string,
    private readonly opts: ApprovalInboxOptions = {},
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'approvals.json');
    this.items = this.load();
    this.now = opts.now ?? (() => new Date());
  }

  private load(): ApprovalItem[] {
    try {
      if (!existsSync(this.filePath)) return [];
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<InboxFile>;
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      return []; // 损坏文件按空箱启动（队列可再生，审计在 audit 侧不受影响）
    }
  }

  private save(): void {
    writeJsonAtomic(this.filePath, { version: 1, items: this.items });
  }

  private auditRecord(action: string, decision: 'info' | 'approved' | 'rejected', reason: string): void {
    if (!this.opts.audit) return;
    try {
      this.opts.audit.record({
        tenantId: this.opts.auditActor?.tenantId ?? 'local',
        userId: this.opts.auditActor?.userId ?? 'agent',
        role: this.opts.auditActor?.role ?? 'operator',
        runId: this.opts.auditActor?.runId ?? 'inbox',
        action,
        resource: reason.slice(0, 500),
        decision,
        reason: reason.slice(0, 300),
      });
    } catch {
      // 审计失败不阻断审批流（审计是记录，不是前置条件——与 M4 P1.2 降级策略一致）
    }
  }

  /** 提交待审批动作（action/reason 先脱敏再落盘——队列文件不得含密钥明文，T4.6） */
  submit(action: string, reason: string, opts: { ttlMs?: number } = {}): ApprovalItem {
    const now = this.now();
    const ttl = opts.ttlMs ?? this.opts.defaultTtlMs;
    const item: ApprovalItem = {
      id: newId(now),
      action: redact(action),
      reason: redact(reason),
      requestedAt: now.toISOString(),
      status: 'pending',
      ...(ttl && ttl > 0 ? { expiresAt: new Date(now.getTime() + ttl).toISOString() } : {}),
    };
    this.items.push(item);
    this.save();
    this.auditRecord('approval:submit', 'info', `${action} — ${reason}`);
    return item;
  }

  /** 列出审批项（可按状态过滤；默认全部） */
  list(status?: ApprovalStatus): ApprovalItem[] {
    return status ? this.items.filter((i) => i.status === status) : [...this.items];
  }

  get(id: string): ApprovalItem | null {
    return this.items.find((i) => i.id === id) ?? null;
  }

  /**
   * 裁决。幂等：非 pending 项拒绝重复裁决。
   * @returns ok=false 表示该项不可裁决（不存在/已裁决/已过期）
   */
  decide(
    id: string,
    approve: boolean,
    by: string,
  ): { ok: boolean; item?: ApprovalItem; error?: string } {
    const item = this.items.find((i) => i.id === id);
    if (!item) return { ok: false, error: `审批项不存在：${id}` };
    if (item.status === 'expired') {
      return { ok: false, item, error: '审批项已过期，请重新提交' };
    }
    if (item.status !== 'pending') {
      return { ok: false, item, error: `审批项已裁决（${item.status}），不可重复裁决` };
    }
    const now = this.now();
    if (item.expiresAt && now.getTime() > new Date(item.expiresAt).getTime()) {
      item.status = 'expired';
      this.save();
      return { ok: false, item, error: '审批项已过期，请重新提交' };
    }
    item.status = approve ? 'approved' : 'rejected';
    item.decidedAt = now.toISOString();
    item.decidedBy = by;
    this.save();
    this.auditRecord('approval:decide', approve ? 'approved' : 'rejected', `${item.action} — by ${by}`);
    return { ok: true, item };
  }

  /** 将到点未决的 pending 项转为 expired；返回过期数量 */
  expireStale(): number {
    const now = this.now().getTime();
    let n = 0;
    for (const item of this.items) {
      if (item.status === 'pending' && item.expiresAt && now > new Date(item.expiresAt).getTime()) {
        item.status = 'expired';
        n += 1;
      }
    }
    if (n > 0) this.save();
    return n;
  }

  get size(): number {
    return this.items.length;
  }
}

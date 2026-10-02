/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 透明记忆（v8.6.0 P2 · T2）：可读 / 可编辑 / 可导出。
 * 反 OpenAI dots「记忆不可读、不可导出」的锁定设计——
 * 用户对自己被 AI 记住的一切拥有完整的查看、修改、带走权利。
 *
 * 数据源：SQLiteStore.user_memory（HonchoStore 同源，用户级事实记忆）。
 * 导出安全：默认经 enterprise/audit.redact 脱敏（sk- 密钥 / Bearer / JWT / key=value），
 * 导出文件即审计友好格式：JSON 结构化 + Markdown 可读双轨。
 */
import { redact as auditRedact } from '../enterprise/audit';
import type { SQLiteStore } from '../shared/sqlite-store';

export interface TransparentEntry {
  id: number;
  content: string;
  category: string;
  importance: number;
  /** ISO 8601 时间戳（由 unixepoch 秒转换） */
  createdAt: string;
}

export interface ExportOptions {
  /** 是否脱敏（默认 true，导出即安全） */
  redact?: boolean;
}

export interface ImportOptions {
  /** 去重：内容相同的条目跳过（默认 true） */
  dedupe?: boolean;
}

export interface ImportResult {
  added: number;
  skipped: number;
}

export interface ExportPayload {
  format: 'feihong-transparent-memory';
  version: 1;
  userId: string;
  exportedAt: string;
  redacted: boolean;
  count: number;
  entries: Array<{ content: string; category: string; importance: number; createdAt: string }>;
}

/** 秒/毫秒时间戳统一转 ISO 8601（容错：>1e12 视为毫秒） */
function toIso(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toISOString();
}

function rowToEntry(r: Record<string, unknown>): TransparentEntry {
  return {
    id: Number(r.id),
    content: String(r.content),
    category: r.category ? String(r.category) : 'fact',
    importance: Number(r.importance ?? 0.5),
    createdAt: toIso(Number(r.created_at ?? 0)),
  };
}

export class TransparentMemory {
  constructor(
    private readonly store: SQLiteStore,
    private readonly userId: string,
  ) {
    // 确保用户存在（user_memory 外键指向 users 表），模块可脱离 HonchoStore 独立使用
    this.store.userUpsert({ id: userId });
  }

  /** 新增记忆（等价 rememberFact， importance 显式可传） */
  add(content: string, importance = 0.5, category = 'fact'): boolean {
    this.store.userAddMemory(this.userId, content, category, importance);
    return true;
  }

  /** 读取全部记忆（按重要度降序，limit 默认 1000，导出场景须取全量） */
  list(limit = 1000): TransparentEntry[] {
    return this.store.userListMemory(this.userId, limit).map(rowToEntry);
  }

  /** 关键词检索 */
  search(keyword: string, limit = 50): TransparentEntry[] {
    return this.store.userSearchMemory(this.userId, keyword, limit).map(rowToEntry);
  }

  /** 编辑记忆内容（返回是否命中） */
  update(id: number, patch: { content?: string; category?: string; importance?: number }): boolean {
    return this.store.userUpdateMemory(this.userId, id, patch);
  }

  /** 删除单条记忆（返回是否命中） */
  remove(id: number): boolean {
    return this.store.userDeleteMemory(this.userId, id);
  }

  /** 导出为结构化 JSON（默认脱敏，可直接回导） */
  exportJson(options: ExportOptions = {}): string {
    const payload = this.buildPayload(options);
    return JSON.stringify(payload, null, 2);
  }

  /** 导出为人类可读 Markdown（默认脱敏） */
  exportMarkdown(options: ExportOptions = {}): string {
    const payload = this.buildPayload(options);
    const lines: string[] = [
      '# 飞虹 Code 透明记忆导出',
      '',
      `- 导出时间：${payload.exportedAt}`,
      `- 所属用户：${payload.userId}`,
      `- 条目数量：${payload.count}`,
      `- 脱敏处理：${payload.redacted ? '是（sk-密钥/Bearer/JWT/key=value 已遮蔽）' : '否'}`,
      '',
      '## 记忆条目',
      '',
    ];
    payload.entries.forEach((e, i) => {
      lines.push(`### [${i + 1}] ${e.createdAt}（${e.category} · 重要度 ${e.importance.toFixed(2)}）`);
      lines.push('');
      lines.push(e.content);
      lines.push('');
    });
    return lines.join('\n');
  }

  /** 导入此前导出的 JSON（默认按内容去重），返回新增/跳过计数 */
  importJson(json: string, options: ImportOptions = {}): ImportResult {
    const dedupe = options.dedupe ?? true;
    const parsed = JSON.parse(json) as Partial<ExportPayload>;
    if (parsed.format !== 'feihong-transparent-memory' || !Array.isArray(parsed.entries)) {
      throw new Error('导入失败：不是合法的 feihong-transparent-memory 导出文件');
    }
    const existing = new Set(dedupe ? this.list().map((e) => e.content.trim()) : []);
    let added = 0;
    let skipped = 0;
    for (const e of parsed.entries) {
      if (typeof e.content !== 'string' || e.content.trim().length === 0) {
        skipped += 1;
        continue;
      }
      if (dedupe && existing.has(e.content.trim())) {
        skipped += 1;
        continue;
      }
      this.store.userAddMemory(
        this.userId,
        e.content,
        typeof e.category === 'string' ? e.category : 'fact',
        typeof e.importance === 'number' ? e.importance : 0.5,
      );
      existing.add(e.content.trim());
      added += 1;
    }
    return { added, skipped };
  }

  private buildPayload(options: ExportOptions): ExportPayload {
    const doRedact = options.redact ?? true;
    const raw = this.list();
    const entries = raw.map((e) => ({
      content: doRedact ? auditRedact(e.content) : e.content,
      category: e.category,
      importance: e.importance,
      createdAt: e.createdAt,
    }));
    return {
      format: 'feihong-transparent-memory',
      version: 1,
      userId: this.userId,
      exportedAt: new Date().toISOString(),
      redacted: doRedact,
      count: entries.length,
      entries,
    };
  }
}

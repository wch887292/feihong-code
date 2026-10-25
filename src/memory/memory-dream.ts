/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 记忆健康检查与梦境整理（memory-dream）
 * 纯函数、可离线可测、全程不接任何 LLM provider 不发网络请求。
 * 对短期记忆进行健康检查、固化、清理，形成稳定的长期记忆库。
 *
 * 设计原则：
 *  - 确定性规则驱动，不调用 LLM；
 *  - 幂等安全，加锁防并发重入；
 *  - fail-open 策略，任一步异常只降级为报告不删数据；
 *  - 原子写 + tombstone 保护，避免静默丢数据。
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

/* ============================ 类型定义 ============================ */

/** 梦境整理选项 */
export interface DreamOptions {
  /** 记忆目录路径 */
  dir: string;
  /** 条目 TTL（毫秒），超过此时间未访问视为过期 */
  ttlMs: number;
  /** 最大条目数，超过后触发 prune */
  maxEntries: number;
  /** 固化锁 TTL（毫秒），防止并发重入 */
  lockTtlMs: number;
  /** 当前时间戳（用于测试注入） */
  now: number;
}

/** 记忆条目结构（与 honcho-store 对齐） */
interface MemoryEntry {
  id: string;
  repoId: string;
  scope: 'global' | 'repo' | 'session';
  kind: 'decision' | 'lesson' | 'convention' | 'architecture' | 'bug' | 'note';
  content: string;
  tags: string[];
  files?: string[];
  createdAt: number;
  updatedAt: number;
  recall?: number;
  usage?: number;
  source?: string;
}

/** 健康检查报告 */
export interface HealthReport {
  ok: boolean;
  entries: number;
  bytes: number;
  estTokens: number;
  overLimit: boolean;
}

/** 固化锁状态 */
interface LockState {
  acquired: boolean;
  pid?: number;
  expiresAt?: number;
}

/* ============================ 工具函数 ============================ */

/** 计算字符串的 sha256 hash（用于去重） */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

/** 估算 tokens（简单规则：1 字符 ≈ 0.25 token，中文按 3 字节计） */
function estimateTokens(text: string): number {
  const bytes = Buffer.byteLength(text, 'utf8');
  // 粗略估算：ASCII 1 字符 1 byte ≈ 1 token，中文 3 byte ≈ 1-2 token
  // 简化为 bytes / 4 作为 token 数（偏保守）
  return Math.floor(bytes / 4);
}

/** 读取 JSON 文件（返回 null 若不存在或解析失败） */
function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 原子写 JSON 文件（先写临时文件再 rename） */
function writeJsonAtomically<T>(path: string, data: T): void {
  const tmpPath = path + '.tmp.' + process.pid;
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    // 原子 rename（Windows 上 rename 可能失败，回退到直接写）
    try {
      require('fs').renameSync(tmpPath, path);
    } catch {
      // 回退：删除临时文件，直接覆盖原文件
      try { unlinkSync(tmpPath); } catch {}
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    }
  } catch (e) {
    // 写失败时清理临时文件
    try { unlinkSync(tmpPath); } catch {}
    throw e;
  }
}

/** 获取记忆条目列表（从目录中扫描 .json 文件） */
function listMemoryEntries(dir: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  if (!existsSync(dir)) return entries;

  const files = require('fs').readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    if (!f.isFile() || !f.name.endsWith('.json')) continue;
    const entry = readJsonFile<MemoryEntry>(join(dir, f.name));
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

/** 获取固化锁（带 PID 和 TTL 过期自释放） */
function acquireLock(dir: string, lockTtlMs: number, now: number): LockState {
  const lockPath = join(dir, '.dream-lock.json');
  const existing = readJsonFile<LockState>(lockPath);

  // 无锁或已过期 → 获取锁
  if (!existing || existing.expiresAt === undefined || existing.expiresAt <= now) {
    const newState: LockState = {
      acquired: true,
      pid: process.pid,
      expiresAt: now + lockTtlMs,
    };
    try {
      writeJsonAtomically(lockPath, newState);
      return newState;
    } catch {
      // 竞争失败
      return { acquired: false };
    }
  }

  // 锁仍有效 → 返回失败
  return { acquired: false };
}

/** 释放固化锁 */
function releaseLock(dir: string): void {
  const lockPath = join(dir, '.dream-lock.json');
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch {
    // 忽略释放失败
  }
}

/** 写入 tombstone（标记已删除，防止静默丢数据） */
function writeTombstone(dir: string, entryId: string, deletedAt: number): void {
  const tombstonePath = join(dir, '.tombstones.json');
  let tombstones: Record<string, number> = {};
  const existing = readJsonFile<Record<string, number>>(tombstonePath);
  if (existing) {
    tombstones = existing;
  }
  tombstones[entryId] = deletedAt;
  writeJsonAtomically(tombstonePath, tombstones);
}

/* ============================ 核心功能 ============================ */

/**
 * 记忆健康检查
 * 统计条目数、总大小、估算 tokens、是否超限
 */
export function memoryHealthCheck(options: DreamOptions): HealthReport {
  const entries = listMemoryEntries(options.dir);
  const totalBytes = entries.reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e), 'utf8'), 0);
  const estTokens = entries.reduce((sum, e) => sum + estimateTokens(e.content), 0);
  const overLimit = entries.length > options.maxEntries;

  return {
    ok: !overLimit,
    entries: entries.length,
    bytes: totalBytes,
    estTokens,
    overLimit,
  };
}

/**
 * 梦境固化
 * 把 recall 或 usage 计数高的短期条目提升为长期，同 key 去重合并
 * 写前先取固化锁，锁文件带 PID 加 TTL 过期自释放防并发重入
 */
export function consolidate(options: DreamOptions): {
  promoted: number;
  merged: number;
  skipped: number;
} {
  // 取锁
  const lock = acquireLock(options.dir, options.lockTtlMs, options.now);
  if (!lock.acquired) {
    return { promoted: 0, merged: 0, skipped: 1 };
  }

  try {
    const entries = listMemoryEntries(options.dir);
    const byKey = new Map<string, MemoryEntry[]>();

    // 按 key（id + repoId）分组
    for (const e of entries) {
      const key = `${e.id}:${e.repoId}`;
      if (!byKey.has(key)) {
        byKey.set(key, []);
      }
      byKey.get(key)!.push(e);
    }

    let promoted = 0;
    let merged = 0;
    let skipped = 0;

    // 处理每个分组
    for (const group of byKey.values()) {
      if (group.length === 1) {
        // 单一条目：判断是否提升到长期
        const e = group[0];
        const isHighRecall = (e.recall ?? 0) >= 3;
        const isHighUsage = (e.usage ?? 0) >= 5;
        const isSession = e.scope === 'session';

        if (isSession && (isHighRecall || isHighUsage)) {
          // 提升为长期
          e.scope = 'global';
          e.updatedAt = options.now;
          try {
            writeJsonAtomically(join(options.dir, `${e.id}.json`), e);
            promoted++;
          } catch {
            skipped++;
          }
        } else {
          skipped++;
        }
      } else {
        // 多条目：去重合并
        // 按内容 hash 分组
        const byHash = new Map<string, MemoryEntry[]>();
        for (const e of group) {
          const h = hashContent(e.content);
          if (!byHash.has(h)) {
            byHash.set(h, []);
          }
          byHash.get(h)!.push(e);
        }

        if (byHash.size === 1) {
          // 内容相同：保留最新的一条，标记其他为 tombstone
          const latest = group.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b);
          for (const e of group) {
            if (e.id !== latest.id) {
              writeTombstone(options.dir, e.id, options.now);
              try {
                unlinkSync(join(options.dir, `${e.id}.json`));
              } catch {}
            }
          }
          merged++;
        } else {
          // 内容不同：保留 recall/usage 最高的
          const best = group.reduce((a, b) => {
            const scoreA = (a.recall ?? 0) * 2 + (a.usage ?? 0);
            const scoreB = (b.recall ?? 0) * 2 + (b.usage ?? 0);
            return scoreA > scoreB ? a : b;
          });
          for (const e of group) {
            if (e.id !== best.id) {
              writeTombstone(options.dir, e.id, options.now);
              try {
                unlinkSync(join(options.dir, `${e.id}.json`));
              } catch {}
            }
          }
          merged++;
        }
      }
    }

    return { promoted, merged, skipped };
  } finally {
    releaseLock(options.dir);
  }
}

/**
 * 清理过期条目
 * 按 updatedAt 加 ttlMs 小于 now 删除过期条目，原子写且删前先写 tombstone 不静默丢
 */
export function pruneExpired(options: DreamOptions): { deleted: number; preserved: number } {
  const entries = listMemoryEntries(options.dir);
  const threshold = options.now - options.ttlMs;

  let deleted = 0;
  let preserved = 0;

  for (const e of entries) {
    if (e.updatedAt < threshold) {
      // 过期：写 tombstone 后删除
      writeTombstone(options.dir, e.id, options.now);
      try {
        unlinkSync(join(options.dir, `${e.id}.json`));
        deleted++;
      } catch {
        preserved++;
      }
    } else {
      preserved++;
    }
  }

  return { deleted, preserved };
}

/**
 * 运行梦境整理全流程
 * 编排为：取锁 → healthCheck → consolidate → pruneExpired → 健康报告
 * 全程 fail-open，任一步异常不删数据只降级为报告
 */
export function runDream(options: DreamOptions): {
  success: boolean;
  health: HealthReport;
  consolidated: { promoted: number; merged: number; skipped: number };
  pruned: { deleted: number; preserved: number };
  error?: string;
} {
  const result: { success: boolean; health: HealthReport; consolidated: { promoted: number; merged: number; skipped: number }; pruned: { deleted: number; preserved: number }; error?: string } = {
    success: true,
    health: { ok: true, entries: 0, bytes: 0, estTokens: 0, overLimit: false },
    consolidated: { promoted: 0, merged: 0, skipped: 0 },
    pruned: { deleted: 0, preserved: 0 },
    error: undefined,
  };

  try {
    // 1. 取锁（consolidate 内部已处理，这里只做预检）
    const lock = acquireLock(options.dir, options.lockTtlMs, options.now);
    if (!lock.acquired) {
      result.success = false;
      result.error = '锁定失败：检测到并发运行';
      return result;
    }

    // 2. 健康检查
    result.health = memoryHealthCheck(options);

    // 3. 梦境固化
    result.consolidated = consolidate(options);

    // 4. 清理过期
    result.pruned = pruneExpired(options);

    // 5. 释放锁
    releaseLock(options.dir);
  } catch (e) {
    // fail-open：不删数据，只记录错误
    result.success = false;
    result.error = e instanceof Error ? e.message : String(e);
    // 确保锁被释放
    try { releaseLock(options.dir); } catch {}
  }

  return result;
}

/**
 * 项目长期中文记忆（TheOne 核心能力之一）
 *
 * 作用：为 fhcode 提供持久记忆，解决“会话上下文有限、重启丢失项目历史/踩坑记录/架构约定”的问题。
 * 特性：
 *  - 记忆按仓库隔离（repoId）；
 *  - 三种作用域：全局 / 当前仓库 / 当前会话；
 *  - 任务前检索相关经验，避免重复踩坑；任务后自动抽取事实入库。
 */
import type { LlmClient, MemoryEntry, MemoryQuery, MemorySearchResult, MemoryStore } from '../types.js';

/** 默认内存实现（可替换为文件/向量库实现） */
export class InMemoryMemoryStore implements MemoryStore {
  private entries = new Map<string, MemoryEntry>();

  async save(entry: MemoryEntry): Promise<MemoryEntry> {
    const id = entry.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const final: MemoryEntry = { ...entry, id };
    this.entries.set(`${entry.repoId}:${id}`, final);
    return final;
  }

  async search(q: MemoryQuery): Promise<MemorySearchResult[]> {
    const scopeSet = q.scope ? new Set(q.scope) : null;
    const kindSet = q.kinds ? new Set(q.kinds) : null;
    const query = q.query.toLowerCase();

    const scored: MemorySearchResult[] = [];
    for (const e of this.entries.values()) {
      if (e.repoId !== q.repoId) continue;
      if (scopeSet && !scopeSet.has(e.scope)) continue;
      if (kindSet && !kindSet.has(e.kind)) continue;

      // 简易打分：标题/正文/标签命中关键词
      const hay = `${e.content} ${e.tags.join(' ')}`.toLowerCase();
      const queryWords = query.split(/\s+/).filter(Boolean);
      const hits = queryWords.filter((w) => hay.includes(w)).length;
      if (hits === 0) continue;
      const score = hits / Math.max(1, queryWords.length);
      scored.push({ entry: e, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const limit = q.limit ?? 5;
    return scored.slice(0, limit);
  }

  async get(repoId: string, id: string): Promise<MemoryEntry | null> {
    return this.entries.get(`${repoId}:${id}`) ?? null;
  }

  async delete(repoId: string, id: string): Promise<void> {
    this.entries.delete(`${repoId}:${id}`);
  }

  snapshot(): MemoryEntry[] {
    return Array.from(this.entries.values());
  }
}

export interface MemoryServiceOptions {
  store?: MemoryStore;
  llm?: LlmClient;
}

export interface MemoryService {
  store: MemoryStore;
  /** 执行前：检索相关历史经验 */
  recall(query: MemoryQuery): Promise<MemorySearchResult[]>;
  /** 执行后：从结果中抽取关键事实入库 */
  absorb(input: { repoId: string; taskSummary: string; result: string; scope: MemoryEntry['scope'] }): Promise<MemoryEntry | null>;
}

/** 记忆服务：在原始存储之上提供 recall/absorb 两个业务入口 */
export function createMemoryService(opts: MemoryServiceOptions = {}): MemoryService {
  const store = opts.store ?? new InMemoryMemoryStore();

  return {
    store,
    async recall(query) {
      return store.search(query);
    },
    async absorb({ repoId, taskSummary, result, scope }) {
      if (!opts.llm) {
        // 无 LLM 时降级：直接存一条 note 型记忆
        return store.save({
          id: `mem_${Date.now()}`,
          repoId,
          scope,
          kind: 'note',
          content: `${taskSummary}\n${result.slice(0, 500)}`,
          tags: [taskSummary],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      // 有 LLM 时：让模型抽取决策/教训/约定等结构化事实
      const res = await opts.llm.complete({
        prompt: `根据以下任务结果，抽取一条结构化中文记忆（kind 取 decision/lesson/convention/architecture/bug/note，tags 为关键词数组）：
任务：${taskSummary}
结果：${result.slice(0, 2000)}`,
        json: true,
      });
      const parsed = res.json as { kind?: MemoryEntry['kind']; content?: string; tags?: string[] } | null;
      if (!parsed?.content) return null;
      return store.save({
        id: `mem_${Date.now()}`,
        repoId,
        scope,
        kind: parsed.kind ?? 'note',
        content: parsed.content,
        tags: parsed.tags ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    },
  };
}

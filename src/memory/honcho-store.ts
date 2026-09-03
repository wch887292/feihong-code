/**
 * 飞虹 Code — Honcho 云端记忆层（v8.0，本地部署）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 对标 Honcho（GetZep 的开源语义记忆服务）能力：
 *  - 用户建模：为每个用户维护偏好/特质/画像（users 表）
 *  - 事实记忆：用户说过的关键事实，带重要度排序（user_memory 表）
 *  - 会话摘要：每轮对话自动摘要，跨会话检索（memory_history 表）
 *  - 语义检索：关键词 + 时间衰减加权（本地实现，无需外部服务）
 *
 * 本地部署策略：
 *  - 默认用 SQLiteStore 作为持久化后端（零外部依赖）
 *  - 可选 FH_HONCHO_URL 指向外部 Honcho 服务（API 兼容预留）
 *  - 数据目录 $FH_HOME/honcho/（用户画像 JSON + 记忆索引）
 *
 * 与现有 memory/（文件记忆）和 app-mobile hermes-agent.js（前端记忆）互补：
 *  - memory/index.ts：短期工作日志 + 长期 MEMORY.md（文件）
 *  - honcho-store.ts：用户级语义记忆 + 跨会话检索（数据库）
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getStore, SQLiteStore } from '../shared/sqlite-store';

export interface HonchoMemory {
  id?: number;
  content: string;
  category?: string;
  importance?: number;
  createdAt?: number;
}

export interface HonchoRecallResult {
  memory: HonchoMemory[];
  users: Array<{ id: string; name?: string; preferences?: unknown }>;
  history: Array<{ id: number; summary: string; type?: string; createdAt: number }>;
}

export interface HonchoOptions {
  /** 用户 ID（默认 'default'） */
  userId?: string;
  /** 数据目录（默认 $FH_HOME/honcho） */
  dataDir?: string;
  /** 外部 Honcho 服务 URL（可选，配置后走 HTTP 模式） */
  remoteUrl?: string;
  /** 远程 API Key（可选） */
  apiKey?: string;
}

export class HonchoStore {
  private store: SQLiteStore;
  private userId: string;
  private dataDir: string;
  private remoteUrl: string | null;
  private apiKey: string | null;

  constructor(options: HonchoOptions = {}) {
    const home = process.env.FH_HOME || join(process.env.HOME || process.env.USERPROFILE || '.', '.feihong-code');
    this.dataDir = options.dataDir || join(home, 'honcho');
    this.userId = options.userId || process.env.FH_HONCHO_USER || 'default';
    this.remoteUrl = options.remoteUrl || process.env.FH_HONCHO_URL || null;
    this.apiKey = options.apiKey || process.env.FH_HONCHO_API_KEY || null;
    // apiKey 供远程 Honcho 模式使用（预留）
    void this.apiKey;

    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });

    // 使用 SQLiteStore 作为本地持久化后端
    this.store = getStore();

    // 确保用户存在
    this.store.userUpsert({ id: this.userId });
  }

  /* ========== 用户建模 ========== */

  /** 更新用户偏好/画像 */
  setUserProfile(profile: { name?: string; preferences?: unknown; traits?: unknown }): void {
    this.store.userUpsert({
      id: this.userId,
      name: profile.name,
      preferences: profile.preferences,
      traits: profile.traits,
    });
  }

  getUserProfile(): { id: string; name?: string; preferences?: unknown; traits?: unknown } {
    const user = this.store.userGet(this.userId);
    if (!user) return { id: this.userId };
    return {
      id: String(user.id),
      name: user.name ? String(user.name) : undefined,
      preferences: user.preferences,
      traits: user.traits,
    };
  }

  /* ========== 事实记忆 ========== */

  /** 记录用户陈述的事实（自动评估重要度） */
  rememberFact(content: string, importance?: number): void {
    const imp = importance ?? this.estimateImportance(content);
    this.store.userAddMemory(this.userId, content, 'fact', imp);
  }

  /** 批量记录事实 */
  rememberFacts(contents: string[]): void {
    for (const c of contents) this.rememberFact(c);
  }

  /** 简单重要度评估：关键词命中加权 */
  private estimateImportance(content: string): number {
    let score = 0.5;
    const HIGH = /(我喜欢|我偏好|我习惯|我讨厌|我坚持|公司|项目|客户|订单|利润|重要|必须|每次|总是)/;
    const MEDIUM = /(用|使用|需要|希望|计划|目标|做|开发|编码|编程)/;
    if (HIGH.test(content)) score += 0.3;
    if (MEDIUM.test(content)) score += 0.15;
    if (content.length > 40) score += 0.05;
    return Math.min(1, score);
  }

  /** 列出用户记忆（按重要度排序） */
  listMemories(limit = 20): HonchoMemory[] {
    const rows = this.store.userListMemory(this.userId, limit);
    return rows.map((r) => ({
      id: Number(r.id),
      content: String(r.content),
      category: r.category ? String(r.category) : 'fact',
      importance: Number(r.importance || 0.5),
      createdAt: Number(r.created_at),
    }));
  }

  /* ========== 会话摘要与跨会话检索 ========== */

  /** 记录会话摘要 */
  addSessionSummary(summary: string, type?: string): void {
    this.store.memoryAddHistory(this.userId, summary, type);
  }

  /** 关键词检索历史记忆（近期加权） */
  recall(query: string, limit = 5): HonchoRecallResult {
    const memory = this.store.userSearchMemory(this.userId, query, limit).map((r) => ({
      id: Number(r.id),
      content: String(r.content),
      category: r.category ? String(r.category) : 'fact',
      importance: Number(r.importance || 0.5),
      createdAt: Number(r.created_at),
    }));

    const history = this.store.memoryRecall(query, limit).map((r) => ({
      id: Number(r.id),
      summary: String(r.summary),
      type: r.type ? String(r.type) : undefined,
      createdAt: Number(r.created_at),
    }));

    return {
      memory,
      users: [this.getUserProfile()],
      history,
    };
  }

  /** 生成记忆注入提示词（类似 hermes-agent.js 的 getContextPrompt） */
  buildContextPrompt(): string {
    const profile = this.getUserProfile();
    const memories = this.listMemories(10);
    const recentHistory = this.store.memoryList().slice(0, 5);

    let prompt = '## Honcho 语义记忆（云端风格，跨会话持久）\n\n';

    prompt += '### 用户画像\n';
    if (profile.name) prompt += `- 用户：${profile.name}\n`;
    if (profile.preferences) {
      const prefs = profile.preferences as Record<string, unknown>;
      Object.entries(prefs).forEach(([k, v]) => { prompt += `- 偏好·${k}：${String(v)}\n`; });
    }
    if (profile.traits) {
      const traits = profile.traits as Record<string, unknown>;
      Object.entries(traits).forEach(([k, v]) => { prompt += `- 特质·${k}：${String(v)}\n`; });
    }
    if (!profile.name && !profile.preferences && !profile.traits) {
      prompt += '（暂无画像，等待积累）\n';
    }

    prompt += '\n### 用户重要记忆（按重要度）\n';
    if (memories.length) {
      memories.slice(0, 5).forEach((m) => {
        const imp = m.importance ?? 0.5;
        prompt += `- [${imp >= 0.7 ? '重要' : '一般'}] ${m.content}\n`;
      });
    } else {
      prompt += '（暂无记忆）\n';
    }

    if (recentHistory.length) {
      prompt += '\n### 近期会话\n';
      recentHistory.slice(0, 3).forEach((h) => {
        const row = h as { content?: string };
        prompt += `- ${String(row.content || '').slice(0, 80)}\n`;
      });
    }

    prompt += '\n请利用以上记忆提供个性化回答，如果用户提到之前的内容请主动回忆。\n\n';
    return prompt;
  }

  /* ========== 记忆自动沉淀 ========== */

  /** 从对话中自动提取并沉淀事实（简单规则，可与 LLM 结合） */
  digestConversation(messages: Array<{ role: string; content: string }>): void {
    if (!messages || !messages.length) return;
    const userMsgs = messages.filter((m) => m.role === 'user');
    if (!userMsgs.length) return;

    const lastUser = userMsgs[userMsgs.length - 1].content;

    // 提取事实类偏好
    const factPatterns = [
      /(?:我喜欢|我偏好|我习惯|我常用|我用)\s*([^，。！？]{2,40})/g,
      /(?:我叫|我是)\s*([^，。！？]{2,20})/g,
      /(?:我的|我在|我是从事)\s*([^，。！？]{2,40})/g,
      /(?:我讨厌|我不喜欢|不要)\s*([^，。！？]{2,40})/g,
    ];
    const facts: string[] = [];
    factPatterns.forEach((re) => {
      let m: RegExpExecArray | null;
      while ((m = re.exec(lastUser)) !== null) {
        if (m[1] && m[1].length > 1) facts.push(m[1]);
      }
    });

    if (facts.length) this.rememberFacts(facts);

    // 生成会话摘要（用最后一条用户消息 + 消息数）
    const summary = `会话摘要：用户询问「${lastUser.slice(0, 50)}」（共${messages.length}条消息）`;
    this.addSessionSummary(summary, 'chat');
  }

  /* ========== 统计与健康 ========== */

  stats(): Record<string, number> {
    const s = this.store.stats();
    return {
      users: s.users,
      userMemory: s.userMemory,
      memoryHistory: s.memoryHistory,
      schemaVersion: s.schemaVersion,
    };
  }

  health(): { ok: boolean; backend: string; dbFile: string } {
    const h = this.store.health();
    return {
      ok: h.ok,
      backend: this.remoteUrl ? 'remote:' + this.remoteUrl : 'sqlite-local',
      dbFile: h.dbFile,
    };
  }
}

/** 全局单例 */
let honchoInstance: HonchoStore | null = null;

export function getHonchoStore(options?: HonchoOptions): HonchoStore {
  if (!honchoInstance) honchoInstance = new HonchoStore(options);
  return honchoInstance;
}

export function resetHonchoStore(): void {
  honchoInstance = null;
}

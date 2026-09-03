/**
 * 飞虹 Code — SQLite 数据存储模块（v8.0）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 基于 Node.js 内置 node:sqlite（DatabaseSync），零外部依赖。
 * 统一替代文件/JSON 存储，提供：
 *  - 通用 KV 存储（models/config/memory 等）
 *  - 任务表（替代 task-queue 的 <id>.json 文件）
 *  - 记忆表（MEMORY.md / USER.md / 历史摘要）
 *  - 技能表（Skills）
 *  - 知识库表（Knowledge docs）
 *  - 会话/用户建模（Honcho 风格）
 *
 * 设计：
 *  - 单例连接，路径默认 $FH_HOME/feihong.db（可 FH_DB_PATH 覆盖）
 *  - 启动自动建表 + 迁移（SCHEMA_VERSION 版本号递增）
 *  - 所有写操作 try/catch + 回滚保护
 *  - 敏感字段按表声明加密（复用 secure-store 的 AES-256-GCM）
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getMasterKey, encryptText, decryptText } from './secure-store';

/** 当前 Schema 版本：每次变更结构需 +1 并补 migrate() 分支 */
export const SCHEMA_VERSION = 1;

/** 需要加密的字段（key 表名:字段名） */
const ENCRYPTED_FIELDS: Record<string, string[]> = {
  'config': ['value'],
  'models': ['apiKey'],
};

export interface SQLiteStoreOptions {
  /** 数据库文件路径（默认 $FH_HOME/feihong.db） */
  dbPath?: string;
  /** 是否输出调试日志 */
  debug?: boolean;
}

interface Row {
  [key: string]: unknown;
}

function resolveDbPath(): string {
  if (process.env.FH_DB_PATH) return process.env.FH_DB_PATH;
  const home = process.env.FH_HOME || join(process.env.HOME || process.env.USERPROFILE || '.', '.feihong-code');
  return join(home, 'feihong.db');
}

export class SQLiteStore {
  private db: DatabaseSync;
  private debugEnabled: boolean;
  private migrations: Record<number, (db: DatabaseSync) => void>;

  constructor(options: SQLiteStoreOptions = {}) {
    const dbPath = options.dbPath || resolveDbPath();
    this.debugEnabled = options.debug || false;

    // 确保目录存在
    const dir = dbPath.substring(0, dbPath.lastIndexOf(/[\\/]/.exec(dbPath)?.[0] || '/'));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    // 迁移定义：key = schema 版本
    this.migrations = {
      1: (db) => this.migrateToV1(db),
    };

    this.ensureSchema();
  }

  /* ========== 私有方法 ========== */

  private debug(...args: unknown[]): void {
    if (this.debugEnabled) console.log('[SQLiteStore]', ...args);
  }

  private encrypt(table: string, field: string, value: string): string {
    if (!value) return value;
    const encFields = ENCRYPTED_FIELDS[table];
    if (!encFields || !encFields.includes(field)) return value;
    try {
      const key = getMasterKey(process.env.FH_HOME || join(process.env.HOME || '.', '.feihong-code'));
      return encryptText(value, key);
    } catch {
      return value;
    }
  }

  private decrypt(table: string, field: string, value: string): string {
    if (!value) return value;
    const encFields = ENCRYPTED_FIELDS[table];
    if (!encFields || !encFields.includes(field)) return value;
    if (!value.startsWith('v1:')) return value; // 未加密的旧数据
    try {
      const key = getMasterKey(process.env.FH_HOME || join(process.env.HOME || '.', '.feihong-code'));
      return decryptText(value, key);
    } catch {
      return value;
    }
  }

  /* ========== Schema 管理 ========== */

  private migrateToV1(db: DatabaseSync): void {
    // 元数据表
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      -- 通用 KV 存储（models/config/settings 等）
      CREATE TABLE IF NOT EXISTS kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (namespace, key)
      );

      -- 任务表
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        progress INTEGER NOT NULL DEFAULT 0,
        input TEXT,
        result TEXT,
        error TEXT,
        model TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

      -- 模型表
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'openai-compatible',
        api_base TEXT,
        api_key TEXT,
        context_window INTEGER,
        max_output INTEGER,
        supports_streaming INTEGER NOT NULL DEFAULT 1,
        supports_vision INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- Agent 表
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'solo',
        status TEXT NOT NULL DEFAULT 'idle',
        system_prompt TEXT,
        model TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_active INTEGER
      );

      -- 技能表
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        trigger TEXT,
        prompt TEXT,
        tags TEXT,
        version TEXT DEFAULT '1.0.0',
        use_count INTEGER NOT NULL DEFAULT 0,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

      -- 记忆表（MEMORY.md / USER.md / 摘要）
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'note',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- 记忆摘要/历史（Honcho 风格）
      CREATE TABLE IF NOT EXISTS memory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        summary TEXT NOT NULL,
        type TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_memory_history_created ON memory_history(created_at);

      -- 用户建模（Honcho 风格）
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        preferences TEXT,
        traits TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      -- 用户记忆条目
      CREATE TABLE IF NOT EXISTS user_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'fact',
        importance REAL NOT NULL DEFAULT 0.5,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id);

      -- 知识库文档表
      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        type TEXT DEFAULT 'markdown',
        tags TEXT,
        size INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge(title);
    `);

    db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)').run('schema_version', String(SCHEMA_VERSION));
  }

  private ensureSchema(): void {
    // 先检查 meta 表是否存在，判断是否全新库
    try {
      const metaTable = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'"
      ).get() as Row | undefined;

      if (!metaTable) {
        // 全新库：直接建 V1（migrateToV1 内部会建 meta 表并写入版本）
        this.migrateToV1(this.db);
        this.debug('全新数据库初始化到 schema v1');
        return;
      }

      // 已有库：读取版本号，按版本递增迁移
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as Row | undefined;
      const currentVersion = row ? parseInt(String(row.value), 10) : 0;

      for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
        if (this.migrations[v]) {
          this.migrations[v](this.db);
          this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)').run('schema_version', String(v));
          this.debug(`迁移到 schema v${v}`);
        }
      }
    } catch (e) {
      console.error('[SQLiteStore] schema 初始化失败:', e);
      throw e;
    }
  }

  /* ========== 通用 KV 存储 ========== */

  kvSet(namespace: string, key: string, value: unknown): void {
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    this.db.prepare(
      'INSERT INTO kv(namespace, key, value, updated_at) VALUES(?, ?, ?, unixepoch()) ' +
      'ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()'
    ).run(namespace, key, this.encrypt('config', 'value', v));
  }

  kvGet<T = unknown>(namespace: string, key: string, defaultValue?: T): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE namespace = ? AND key = ?').get(namespace, key) as Row | undefined;
    if (!row) return defaultValue;
    const raw = this.decrypt('config', 'value', String(row.value));
    try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
  }

  kvDelete(namespace: string, key: string): void {
    this.db.prepare('DELETE FROM kv WHERE namespace = ? AND key = ?').run(namespace, key);
  }

  kvList(namespace: string): Array<{ key: string; value: unknown }> {
    const rows = this.db.prepare('SELECT key, value FROM kv WHERE namespace = ? ORDER BY updated_at DESC').all(namespace) as Array<Row>;
    return rows.map((r) => {
      const raw = this.decrypt('config', 'value', String(r.value));
      let value: unknown;
      try { value = JSON.parse(raw); } catch { value = raw; }
      return { key: String(r.key), value };
    });
  }

  /* ========== 任务 CRUD ========== */

  taskUpsert(task: {
    id: string; type: string; status: string; progress?: number;
    input?: unknown; result?: unknown; error?: string; model?: string;
  }): void {
    this.db.prepare(
      `INSERT INTO tasks(id, type, status, progress, input, result, error, model, created_at, started_at, completed_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         progress = excluded.progress,
         input = excluded.input,
         result = excluded.result,
         error = excluded.error,
         model = excluded.model,
         started_at = COALESCE(excluded.started_at, tasks.started_at),
         completed_at = excluded.completed_at`
    ).run(
      task.id, task.type, task.status, task.progress ?? 0,
      task.input !== undefined ? JSON.stringify(task.input) : null,
      task.result !== undefined ? JSON.stringify(task.result) : null,
      task.error ?? null, task.model ?? null,
      task.status === 'running' ? Date.now() : null,
      task.status === 'completed' || task.status === 'failed' ? Date.now() : null
    );
  }

  taskGet(id: string): Row | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    if (row) {
      if (row.input) row.input = JSON.parse(String(row.input));
      if (row.result) row.result = JSON.parse(String(row.result));
    }
    return row;
  }

  taskList(options: { status?: string; limit?: number; offset?: number } = {}): Row[] {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    if (options.status) {
      return this.db.prepare(
        'SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(options.status, limit, offset) as Row[];
    }
    return this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as Row[];
  }

  taskCount(): { total: number; pending: number; running: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM tasks').get() as Row).c as number;
    const pending = (this.db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'").get() as Row).c as number;
    const running = (this.db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'running'").get() as Row).c as number;
    return { total, pending, running };
  }

  taskDelete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  /* ========== 模型 CRUD ========== */

  modelUpsert(model: {
    id: string; name: string; provider?: string; apiBase?: string;
    apiKey?: string; contextWindow?: number; maxOutput?: number;
    supportsStreaming?: boolean; supportsVision?: boolean;
  }): void {
    this.db.prepare(
      `INSERT INTO models(id, name, provider, api_base, api_key, context_window, max_output, supports_streaming, supports_vision)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, provider = excluded.provider, api_base = excluded.api_base,
         api_key = excluded.api_key, context_window = excluded.context_window,
         max_output = excluded.max_output, supports_streaming = excluded.supports_streaming,
         supports_vision = excluded.supports_vision`
    ).run(
      model.id, model.name, model.provider || 'openai-compatible', model.apiBase || null,
      this.encrypt('models', 'apiKey', model.apiKey || ''),
      model.contextWindow ?? null, model.maxOutput ?? null,
      model.supportsStreaming !== false ? 1 : 0,
      model.supportsVision ? 1 : 0
    );
  }

  modelList(): Row[] {
    const rows = this.db.prepare('SELECT * FROM models ORDER BY created_at').all() as Row[];
    return rows.map((r) => ({
      ...r,
      apiKey: this.decrypt('models', 'apiKey', String(r.api_key || '')),
    }));
  }

  modelGet(id: string): Row | undefined {
    const row = this.db.prepare('SELECT * FROM models WHERE id = ?').get(id) as Row | undefined;
    if (row) row.apiKey = this.decrypt('models', 'apiKey', String(row.api_key || ''));
    return row;
  }

  /** 返回数据库原始行（api_key 保持加密态），供安全审计/验证使用 */
  modelGetRaw(id: string): Row | undefined {
    return this.db.prepare('SELECT * FROM models WHERE id = ?').get(id) as Row | undefined;
  }

  modelDelete(id: string): void {
    this.db.prepare('DELETE FROM models WHERE id = ?').run(id);
  }

  /* ========== 技能 CRUD ========== */

  skillUpsert(skill: {
    id: string; name: string; description?: string; trigger?: string;
    prompt?: string; tags?: string[]; version?: string; useCount?: number; builtin?: boolean;
  }): void {
    this.db.prepare(
      `INSERT INTO skills(id, name, description, trigger, prompt, tags, version, use_count, builtin)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, description = excluded.description, trigger = excluded.trigger,
         prompt = excluded.prompt, tags = excluded.tags, version = excluded.version,
         use_count = excluded.use_count, builtin = excluded.builtin`
    ).run(
      skill.id, skill.name, skill.description || null, skill.trigger || null,
      skill.prompt || null, skill.tags ? JSON.stringify(skill.tags) : null,
      skill.version || '1.0.0', skill.useCount || 0, skill.builtin ? 1 : 0
    );
  }

  skillList(): Row[] {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY created_at').all() as Row[];
    return rows.map((r) => ({ ...r, tags: r.tags ? JSON.parse(String(r.tags)) : [] }));
  }

  skillSearch(query: string): Row[] {
    const q = `%${query}%`;
    return this.db.prepare(
      'SELECT * FROM skills WHERE name LIKE ? OR description LIKE ? OR trigger LIKE ? ORDER BY use_count DESC'
    ).all(q, q, q) as Row[];
  }

  skillDelete(id: string): void {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  }

  /* ========== 记忆 CRUD ========== */

  memorySet(key: string, content: string, kind = 'note'): void {
    this.db.prepare(
      'INSERT INTO memory(key, content, kind, updated_at) VALUES(?, ?, ?, unixepoch()) ' +
      'ON CONFLICT(key) DO UPDATE SET content = excluded.content, kind = excluded.kind, updated_at = unixepoch()'
    ).run(key, content, kind);
  }

  memoryGet(key: string): string | undefined {
    const row = this.db.prepare('SELECT content FROM memory WHERE key = ?').get(key) as Row | undefined;
    return row ? String(row.content) : undefined;
  }

  memoryList(kind?: string): Row[] {
    if (kind) return this.db.prepare('SELECT * FROM memory WHERE kind = ? ORDER BY updated_at DESC').all(kind) as Row[];
    return this.db.prepare('SELECT * FROM memory ORDER BY updated_at DESC').all() as Row[];
  }

  memoryAddHistory(sessionId: string | null, summary: string, type?: string): void {
    this.db.prepare('INSERT INTO memory_history(session_id, summary, type) VALUES(?, ?, ?)').run(sessionId, summary, type || null);
  }

  memoryRecall(keyword: string, limit = 5): Row[] {
    const q = `%${keyword}%`;
    return this.db.prepare(
      'SELECT * FROM memory_history WHERE summary LIKE ? ORDER BY created_at DESC LIMIT ?'
    ).all(q, limit) as Row[];
  }

  /* ========== 用户建模（Honcho 风格） ========== */

  userUpsert(user: {
    id: string; name?: string; preferences?: unknown; traits?: unknown;
  }): void {
    this.db.prepare(
      `INSERT INTO users(id, name, preferences, traits, created_at, updated_at)
       VALUES(?, ?, ?, ?, unixepoch(), unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, preferences = excluded.preferences,
         traits = excluded.traits, updated_at = unixepoch()`
    ).run(
      user.id, user.name || null,
      user.preferences !== undefined ? JSON.stringify(user.preferences) : null,
      user.traits !== undefined ? JSON.stringify(user.traits) : null
    );
  }

  userGet(id: string): Row | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    if (row) {
      if (row.preferences) row.preferences = JSON.parse(String(row.preferences));
      if (row.traits) row.traits = JSON.parse(String(row.traits));
    }
    return row;
  }

  userAddMemory(userId: string, content: string, category = 'fact', importance = 0.5): void {
    this.db.prepare('INSERT INTO user_memory(user_id, content, category, importance) VALUES(?, ?, ?, ?)')
      .run(userId, content, category, importance);
  }

  userListMemory(userId: string, limit = 20): Row[] {
    return this.db.prepare(
      'SELECT * FROM user_memory WHERE user_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?'
    ).all(userId, limit) as Row[];
  }

  userSearchMemory(userId: string, keyword: string, limit = 10): Row[] {
    const q = `%${keyword}%`;
    return this.db.prepare(
      'SELECT * FROM user_memory WHERE user_id = ? AND content LIKE ? ORDER BY importance DESC LIMIT ?'
    ).all(userId, q, limit) as Row[];
  }

  /* ========== 知识库 CRUD ========== */

  knowledgeUpsert(doc: {
    id: string; title: string; content?: string; type?: string; tags?: string[]; size?: number;
  }): void {
    this.db.prepare(
      `INSERT INTO knowledge(id, title, content, type, tags, size, created_at)
       VALUES(?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, content = excluded.content, type = excluded.type,
         tags = excluded.tags, size = excluded.size`
    ).run(
      doc.id, doc.title, doc.content || null, doc.type || 'markdown',
      doc.tags ? JSON.stringify(doc.tags) : null, doc.size ?? (doc.content?.length || 0)
    );
  }

  knowledgeList(): Row[] {
    const rows = this.db.prepare('SELECT id, title, type, tags, size, created_at FROM knowledge ORDER BY created_at').all() as Row[];
    return rows.map((r) => ({ ...r, tags: r.tags ? JSON.parse(String(r.tags)) : [] }));
  }

  knowledgeSearch(query: string): Row[] {
    const q = `%${query}%`;
    return this.db.prepare(
      'SELECT * FROM knowledge WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC'
    ).all(q, q) as Row[];
  }

  knowledgeDelete(id: string): void {
    this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
  }

  /* ========== 统计与健康 ========== */

  stats(): Record<string, number> {
    const count = (table: string): number => {
      try { return (this.db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as Row).c as number; }
      catch { return 0; }
    };
    return {
      tasks: count('tasks'),
      models: count('models'),
      agents: count('agents'),
      skills: count('skills'),
      memory: count('memory'),
      memoryHistory: count('memory_history'),
      users: count('users'),
      userMemory: count('user_memory'),
      knowledge: count('knowledge'),
      schemaVersion: SCHEMA_VERSION,
    };
  }

  /** 健康检查：执行简单查询验证数据库可访问 */
  health(): { ok: boolean; backend: string; version: number; dbFile: string } {
    try {
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as Row;
      return {
        ok: true,
        backend: 'sqlite',
        version: parseInt(String(row.value), 10),
        dbFile: this.dbFile(),
      };
    } catch (e) {
      return { ok: false, backend: 'error', version: 0, dbFile: this.dbFile() };
    }
  }

  dbFile(): string {
    // DatabaseSync 不直接暴露路径，通过环境变量或默认推断
    return process.env.FH_DB_PATH || join(process.env.FH_HOME || join(process.env.HOME || '.', '.feihong-code'), 'feihong.db');
  }

  /** 关闭数据库连接 */
  close(): void {
    try { this.db.close(); } catch { /* 已关闭 */ }
  }
}

/** 全局单例 */
let storeInstance: SQLiteStore | null = null;

export function getStore(options?: SQLiteStoreOptions): SQLiteStore {
  if (!storeInstance) storeInstance = new SQLiteStore(options);
  return storeInstance;
}

export function resetStore(): void {
  if (storeInstance) { storeInstance.close(); storeInstance = null; }
}

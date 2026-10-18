/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1-E 项目级记忆命名空间测试（对标 Codex memories 环境作用域）：
 *  - SQLiteStore V2 迁移：user_memory.project 列存在（全新库 + 老库升级路径）
 *  - userAddMemory/userListMemory/userSearchMemory 的 project 过滤语义
 *  - TransparentMemory / HonchoStore 按项目读写隔离
 * 隔离策略：临时 dbPath 直构 SQLiteStore，不触碰全局单例。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteStore, SCHEMA_VERSION } from '../../src/shared/sqlite-store';
import { TransparentMemory } from '../../src/memory/transparent';
import { HonchoStore } from '../../src/memory/honcho-store';

const dir = mkdtempSync(join(tmpdir(), 'fhcode-memory-project-'));

function fresh(userId: string): { store: SQLiteStore; close: () => void } {
  const store = new SQLiteStore({ dbPath: join(dir, `${userId}.db`) });
  return { store, close: () => store.close() };
}

test('P1-E1: 全新库 schema 升级到 V2 且 user_memory 含 project 列', () => {
  const { store, close } = fresh('p1e1');
  try {
    assert.ok(SCHEMA_VERSION >= 2, `SCHEMA_VERSION 应为 2 或更高，实际 ${SCHEMA_VERSION}`);
    store.userUpsert({ id: 'p1e1' });
    // 写一条带 project 的记忆，验证列真实存在
    store.userAddMemory('p1e1', '项目事实', 'fact', 0.5, 'demo-project');
    const rows = store.userListMemory('p1e1', 10, 'demo-project');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].project, 'demo-project');
  } finally {
    close();
  }
});

test('P1-E2: 老库（V1 无 project 列）升级后仍可用且数据保留', () => {
  // 先手工建一个 V1 结构库（无 project 列），再让 SQLiteStore 迁移
  const dbPath = join(dir, 'legacy-v1.db');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta(key, value) VALUES('schema_version', '1');
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, preferences TEXT, traits TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE user_memory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
        content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'fact', importance REAL NOT NULL DEFAULT 0.5,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), FOREIGN KEY (user_id) REFERENCES users(id));
      INSERT INTO users(id) VALUES('legacy');
      INSERT INTO user_memory(user_id, content, category, importance) VALUES('legacy', '旧数据', 'fact', 0.8);
    `);
    db.close();
  }
  const store = new SQLiteStore({ dbPath });
  try {
    // 旧数据仍在
    const legacy = store.userListMemory('legacy', 10);
    assert.strictEqual(legacy.length, 1);
    assert.strictEqual(legacy[0].content, '旧数据');
    // project 列可用（旧行为：全局作用域 project IS NULL）
    assert.strictEqual(legacy[0].project, null);
    // 新写入带 project 的记忆可共存
    store.userAddMemory('legacy', '新项目数据', 'fact', 0.6, 'proj-a');
    const proj = store.userListMemory('legacy', 10, 'proj-a');
    assert.strictEqual(proj.length, 1);
    assert.strictEqual(proj[0].project, 'proj-a');
    const glob = store.userListMemory('legacy', 10);
    assert.strictEqual(glob.length, 1, '缺省只返回全局记忆，不含项目记忆');
  } finally {
    store.close();
  }
});

test('P1-E3: userListMemory project 过滤语义（缺省=全局 / * =全部 / 指定=该项目）', () => {
  const { store, close } = fresh('p1e3');
  try {
    store.userUpsert({ id: 'p1e3' });
    store.userAddMemory('p1e3', '全局记忆1', 'fact', 0.5);
    store.userAddMemory('p1e3', '全局记忆2', 'fact', 0.4);
    store.userAddMemory('p1e3', '项目A记忆', 'fact', 0.9, 'proj-a');
    store.userAddMemory('p1e3', '项目B记忆', 'fact', 0.7, 'proj-b');

    const globalOnly = store.userListMemory('p1e3', 10);
    assert.strictEqual(globalOnly.length, 2, '缺省=仅全局');
    assert.ok(globalOnly.every((r) => r.project == null));

    const all = store.userListMemory('p1e3', 10, '*');
    assert.strictEqual(all.length, 4, '* = 全部作用域');

    const projA = store.userListMemory('p1e3', 10, 'proj-a');
    assert.strictEqual(projA.length, 1);
    assert.strictEqual(projA[0].content, '项目A记忆');
  } finally {
    close();
  }
});

test('P1-E4: userSearchMemory 支持 project 过滤', () => {
  const { store, close } = fresh('p1e4');
  try {
    store.userUpsert({ id: 'p1e4' });
    store.userAddMemory('p1e4', '部署流程文档', 'fact', 0.5);
    store.userAddMemory('p1e4', '部署到生产', 'fact', 0.5, 'ops');
    const globalHits = store.userSearchMemory('p1e4', '部署', 10);
    assert.strictEqual(globalHits.length, 1, '缺省只搜全局');
    const opsHits = store.userSearchMemory('p1e4', '部署', 10, 'ops');
    assert.strictEqual(opsHits.length, 1);
    assert.strictEqual(opsHits[0].project, 'ops');
    const allHits = store.userSearchMemory('p1e4', '部署', 10, '*');
    assert.strictEqual(allHits.length, 2);
  } finally {
    close();
  }
});

test('P1-E5: TransparentMemory 按项目读写隔离', () => {
  const { store, close } = fresh('p1e5');
  try {
    const tm = new TransparentMemory(store, 'p1e5');
    tm.add('全局偏好', 0.6);
    tm.add('项目事实', 0.9, 'fact', 'proj-x');
    const globalOnly = tm.list(50);
    assert.strictEqual(globalOnly.length, 1);
    assert.strictEqual(globalOnly[0].content, '全局偏好');
    assert.strictEqual(globalOnly[0].project, null);
    const projX = tm.list(50, 'proj-x');
    assert.strictEqual(projX.length, 1);
    assert.strictEqual(projX[0].content, '项目事实');
    assert.strictEqual(projX[0].project, 'proj-x');
    // search 同语义
    const hits = tm.search('项目', 10, 'proj-x');
    assert.strictEqual(hits.length, 1);
  } finally {
    close();
  }
});

test('P1-E6: HonchoStore rememberFact 支持项目作用域', () => {
  // HonchoStore 内部用全局 SQLiteStore 单例：先 reset 再用临时 dbPath 重建单例，隔离真实 FH_HOME
  const { resetStore, getStore } = require('../../src/shared/sqlite-store') as typeof import('../../src/shared/sqlite-store');
  resetStore();
  const tempStore = getStore({ dbPath: join(dir, 'honcho-shared.db') });
  try {
    const hs = new HonchoStore({ userId: 'p1e6', dataDir: join(dir, 'honcho-p1e6') });
    hs.rememberFact('全局用户偏好', 0.8);
    hs.rememberFact('仅本项目的事实', 0.9, 'proj-y');
    const globalOnly = hs.listMemories(10);
    assert.strictEqual(globalOnly.length, 1, '缺省=全局');
    assert.strictEqual(globalOnly[0].content, '全局用户偏好');
    const projY = hs.listMemories(10, 'proj-y');
    assert.strictEqual(projY.length, 1);
    assert.strictEqual(projY[0].content, '仅本项目的事实');
    assert.strictEqual(projY[0].project, 'proj-y');
  } finally {
    tempStore.close();
    resetStore();
  }
});

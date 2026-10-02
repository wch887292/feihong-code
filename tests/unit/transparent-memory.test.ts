/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2 透明记忆测试（T2.1-T2.6）：可读 / 可编辑 / 可导出 / 脱敏 / round-trip
 * 隔离策略：直接构造 SQLiteStore（临时 dbPath），不触碰全局单例与真实 FH_HOME。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLiteStore } from '../../src/shared/sqlite-store';
import { TransparentMemory } from '../../src/memory/transparent';

const dir = mkdtempSync(join(tmpdir(), 'fhcode-transparent-'));

function fresh(userId: string): { store: SQLiteStore; tm: TransparentMemory; close: () => void } {
  const store = new SQLiteStore({ dbPath: join(dir, `${userId}.db`) });
  return { store, tm: new TransparentMemory(store, userId), close: () => store.close() };
}

// ---------- T2.1 写读一致 ----------

test('T2.1a 新增记忆后 list 返回一致的内容与重要度', () => {
  const { store, tm, close } = fresh('t21a');
  try {
    tm.add('我偏好 TypeScript 严格模式', 0.9);
    const all = tm.list();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].content, '我偏好 TypeScript 严格模式');
    assert.strictEqual(all[0].importance, 0.9);
  } finally {
    close();
  }
});

test('T2.1b 记录元数据完整：默认分类 fact、createdAt 为合法 ISO 时间戳', () => {
  const { tm, close } = fresh('t21b');
  try {
    tm.add('元数据检查条目');
    const e = tm.list()[0];
    assert.strictEqual(e.category, 'fact');
    assert.ok(!Number.isNaN(Date.parse(e.createdAt)), 'createdAt 应可解析');
    assert.ok(e.createdAt.startsWith(new Date().toISOString().slice(0, 10)), '应为当前日期附近');
    assert.ok(e.id > 0);
  } finally {
    close();
  }
});

// ---------- T2.2 导出格式 ----------

test('T2.2a exportJson 产出合法 JSON：含格式标识/版本/导出时间/计数', () => {
  const { tm, close } = fresh('t22a');
  try {
    tm.add('导出格式检查甲', 0.8);
    tm.add('导出格式检查乙', 0.6, 'preference');
    const payload = JSON.parse(tm.exportJson()) as {
      format: string; version: number; userId: string; exportedAt: string; count: number;
      entries: Array<{ content: string; category: string; importance: number; createdAt: string }>;
    };
    assert.strictEqual(payload.format, 'feihong-transparent-memory');
    assert.strictEqual(payload.version, 1);
    assert.strictEqual(payload.userId, 't22a');
    assert.ok(!Number.isNaN(Date.parse(payload.exportedAt)));
    assert.strictEqual(payload.count, 2);
    assert.strictEqual(payload.entries.length, 2);
    assert.ok(payload.entries.every((e) => e.content && e.createdAt));
  } finally {
    close();
  }
});

test('T2.2b exportMarkdown 人类可读：含标题/元信息/条目内容', () => {
  const { tm, close } = fresh('t22b');
  try {
    tm.add('Markdown 导出可见内容', 0.7);
    const md = tm.exportMarkdown();
    assert.ok(md.includes('# 飞虹 Code 透明记忆导出'));
    assert.ok(md.includes('条目数量：1'));
    assert.ok(md.includes('导出时间：'));
    assert.ok(md.includes('Markdown 导出可见内容'));
  } finally {
    close();
  }
});

// ---------- T2.3 编辑/删除即时生效 ----------

test('T2.3a 编辑记忆后 list 立即反映新内容', () => {
  const { tm, close } = fresh('t23a');
  try {
    tm.add('旧内容：使用 npm', 0.5);
    const id = tm.list()[0].id;
    assert.strictEqual(tm.update(id, { content: '新内容：使用 pnpm', importance: 0.8 }), true);
    const after = tm.list()[0];
    assert.strictEqual(after.content, '新内容：使用 pnpm');
    assert.strictEqual(after.importance, 0.8);
  } finally {
    close();
  }
});

test('T2.3b 删除记忆后不再出现；对不存在 id 操作返回 false', () => {
  const { tm, close } = fresh('t23b');
  try {
    tm.add('待删除条目');
    const id = tm.list()[0].id;
    assert.strictEqual(tm.remove(id), true);
    assert.strictEqual(tm.list().length, 0);
    assert.strictEqual(tm.remove(999999), false);
    assert.strictEqual(tm.update(999999, { content: 'x' }), false);
  } finally {
    close();
  }
});

// ---------- T2.4 round-trip ----------

test('T2.4a 导出→全新库导入→记忆集合一致（可带走可恢复）', () => {
  const a = fresh('t24a-src');
  try {
    a.tm.add('事实一：公司主营企业管理咨询', 0.9);
    a.tm.add('事实二：客户群体为服装厂老板', 0.8, 'preference');
    a.tm.add('事实三：偏好 commit-by-commit 节奏', 0.7);
    const json = a.tm.exportJson();

    const b = fresh('t24a-dst');
    try {
      const r = b.tm.importJson(json);
      assert.strictEqual(r.added, 3);
      assert.strictEqual(r.skipped, 0);
      const srcSet = new Set(a.tm.list().map((e) => e.content));
      const dstSet = new Set(b.tm.list().map((e) => e.content));
      assert.deepStrictEqual(dstSet, srcSet);
    } finally {
      b.close();
    }
  } finally {
    a.close();
  }
});

test('T2.4b 导入去重：同一文件重复导入只增首次', () => {
  const a = fresh('t24b-src');
  const b = fresh('t24b-dst');
  try {
    a.tm.add('去重测试唯一内容', 0.5);
    const json = a.tm.exportJson();
    assert.deepStrictEqual(b.tm.importJson(json), { added: 1, skipped: 0 });
    assert.deepStrictEqual(b.tm.importJson(json), { added: 0, skipped: 1 });
    assert.strictEqual(b.tm.list().length, 1);
  } finally {
    a.close();
    b.close();
  }
});

// ---------- T2.5 并发安全 ----------

test('T2.5 并发写 20 条不丢不重', async () => {
  const { tm, close } = fresh('t25');
  try {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => tm.add(`并发条目 ${i}`, 0.5 + i * 0.01)),
    );
    const all = tm.list(100);
    assert.strictEqual(all.length, 20);
    assert.strictEqual(new Set(all.map((e) => e.content)).size, 20);
  } finally {
    close();
  }
});

// ---------- T2.6 脱敏集成 ----------

test('T2.6a 默认导出脱敏：sk- 密钥明文不出现在导出物中', () => {
  const { tm, close } = fresh('t26a');
  try {
    tm.add('我的 API key 是 sk-abc1234567890xyz 请记住');
    const json = tm.exportJson();
    assert.ok(!json.includes('sk-abc1234567890xyz'), 'JSON 导出不得含密钥明文');
    assert.ok(json.includes('sk-***'), '应已遮蔽');
    const md = tm.exportMarkdown();
    assert.ok(!md.includes('sk-abc1234567890xyz'), 'Markdown 导出不得含密钥明文');
  } finally {
    close();
  }
});

test('T2.6b 显式 redact:false 为对照组：原文保留（本地自用场景）', () => {
  const { tm, close } = fresh('t26b');
  try {
    tm.add('我的 API key 是 sk-abc1234567890xyz 请记住');
    const json = tm.exportJson({ redact: false });
    assert.ok(json.includes('sk-abc1234567890xyz'), '关闭脱敏时保留原文');
  } finally {
    close();
  }
});

// ---------- 补充：导入防错 ----------

test('补充 importJson 非法文件抛出可读错误', () => {
  const { tm, close } = fresh('t2x');
  try {
    assert.throws(() => tm.importJson('{"format":"other","entries":[]}'), /feihong-transparent-memory/);
    assert.throws(() => tm.importJson('not json at all'), Error);
  } finally {
    close();
  }
});

// 清理临时目录（node:test 收尾阶段执行）
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 文件锁容忍：残留于系统临时目录，无害 */
  }
});

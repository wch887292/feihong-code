/**
 * 经验学习模块单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ChatMessage } from '../../src/models/model.interface';
import {
  extractExperience,
  saveExperience,
  upsertExperience,
  loadExperiences,
  updateExperienceUsage,
  generateExperiencePrompt,
  listExperiences,
  type Experience,
} from '../../src/agent/experience';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'fhcode-exp-'));
}

function sampleExperience(id: string, successRate: number): Experience {
  return {
    id,
    type: 'tool-efficiency',
    title: `经验-${id}`,
    content: `内容-${id}`,
    metadata: {
      sessionCount: 1,
      successRate,
      tags: ['read_file', 'write_file'],
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    },
  };
}

test('extractExperience: 提取高效工具序列', () => {
  const messages: ChatMessage[] = [
    { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_file', arguments: {} }] },
    { role: 'tool', content: 'ok', toolCallId: '1' },
    { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'write_file', arguments: {} }] },
    { role: 'tool', content: 'ok', toolCallId: '2' },
    { role: 'assistant', content: '', toolCalls: [{ id: '3', name: 'run_shell', arguments: {} }] },
    { role: 'tool', content: 'ok', toolCallId: '3' },
    { role: 'assistant', content: '完成', toolCalls: [] },
  ];
  const exps = extractExperience(messages, 'run-1');
  const toolExp = exps.find((e) => e.type === 'tool-efficiency');
  assert.ok(toolExp, '应提取工具效率经验');
  assert.ok(toolExp!.title.includes('read_file → write_file → run_shell'));
});

test('extractExperience: 提取错误模式', () => {
  const messages: ChatMessage[] = [
    { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'edit_file', arguments: {} }] },
    { role: 'tool', content: '错误: 路径不存在 /foo/bar', toolCallId: '1' },
    { role: 'assistant', content: '完成', toolCalls: [] },
  ];
  const exps = extractExperience(messages, 'run-2');
  const errExp = exps.find((e) => e.type === 'error-pattern');
  assert.ok(errExp, '应提取错误模式经验');
  assert.ok(errExp!.metadata.tags.includes('path-traversal'));
});

test('saveExperience + loadExperiences: 持久化与关键词匹配', async () => {
  const dir = tmpDir();
  try {
    const exp = sampleExperience('a', 0.9);
    await saveExperience(dir, exp);
    const loaded = await loadExperiences(dir, ['read_file']);
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].id, 'a');

    const none = await loadExperiences(dir, ['nonexistent-keyword']);
    assert.strictEqual(none.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadExperiences: 按成功率降序返回前 5 条', async () => {
  const dir = tmpDir();
  try {
    const exps: Experience[] = [
      sampleExperience('low', 0.2),
      sampleExperience('mid', 0.5),
      sampleExperience('high', 0.95),
    ];
    for (const e of exps) await saveExperience(dir, e);
    const loaded = await loadExperiences(dir, ['read_file']);
    assert.strictEqual(loaded.length, 3);
    assert.strictEqual(loaded[0].id, 'high');
    assert.strictEqual(loaded[loaded.length - 1].id, 'low');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadExperiences: 目录不存在返回空数组', async () => {
  const loaded = await loadExperiences('/nonexistent/path/xyz', ['x']);
  assert.deepStrictEqual(loaded, []);
});

test('updateExperienceUsage: 递增 sessionCount', async () => {
  const dir = tmpDir();
  try {
    const exp = sampleExperience('u1', 1);
    await saveExperience(dir, exp);
    await updateExperienceUsage(dir, 'u1');
    const loaded = await listExperiences(dir);
    assert.strictEqual(loaded[0].metadata.sessionCount, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateExperiencePrompt: 空经验返回空串', () => {
  assert.strictEqual(generateExperiencePrompt([]), '');
});

test('generateExperiencePrompt: 非空经验生成提示', () => {
  const prompt = generateExperiencePrompt([sampleExperience('p1', 1)]);
  assert.ok(prompt.includes('历史经验参考'));
  assert.ok(prompt.includes('经验-p1'));
});

test('listExperiences: 按 sessionCount 降序', async () => {
  const dir = tmpDir();
  try {
    const a = sampleExperience('a', 1);
    a.metadata.sessionCount = 1;
    const b = sampleExperience('b', 1);
    b.metadata.sessionCount = 5;
    await saveExperience(dir, a);
    await saveExperience(dir, b);
    const list = await listExperiences(dir);
    assert.strictEqual(list[0].id, 'b');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertExperience: 同 id 多次 upsert 仅保留一条，sessionCount 累加', async () => {
  const dir = tmpDir();
  try {
    const exp = sampleExperience('dup-1', 0.8);
    await upsertExperience(dir, exp);
    // 第二次相同 id：更新 successRate 而非追加
    const exp2 = sampleExperience('dup-1', 1.0);
    await upsertExperience(dir, exp2);
    const list = await listExperiences(dir);
    assert.strictEqual(list.length, 1, '同 id 应只保留一条记录');
    assert.strictEqual(list[0].metadata.sessionCount, 2, 'sessionCount 应累加为 2');
    // successRate 应为加权平均 (0.8*1 + 1.0*1) / 2 = 0.9
    const expectedRate = (0.8 * 1 + 1.0 * 1) / 2;
    assert.ok(Math.abs(list[0].metadata.successRate - expectedRate) < 0.001,
      `successRate 应为 ${expectedRate}，实际 ${list[0].metadata.successRate}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertExperience: 不同 id 各自独立存储', async () => {
  const dir = tmpDir();
  try {
    await upsertExperience(dir, sampleExperience('a', 0.9));
    await upsertExperience(dir, sampleExperience('b', 0.7));
    const list = await listExperiences(dir);
    assert.strictEqual(list.length, 2);
    assert.ok(list.some(e => e.id === 'a'));
    assert.ok(list.some(e => e.id === 'b'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertExperience: 同一 id 合并 sessionCount，不产生重复记录', async () => {
  const dir = tmpDir();
  try {
    const exp1 = sampleExperience('dedup-1', 0.8);
    await upsertExperience(dir, exp1);

    // 第二次以相同 id 插入，successRate 不同的经验
    const exp2 = sampleExperience('dedup-1', 1.0);
    await upsertExperience(dir, exp2);

    const list = await listExperiences(dir);
    // 只应有一条记录，而非两条
    assert.strictEqual(list.length, 1, `应只有 1 条记录，实际 ${list.length}`);
    // sessionCount 应为 2（原 1 + 本次 1）
    assert.strictEqual(list[0].metadata.sessionCount, 2, 'sessionCount 应累加为 2');
    // 成功率应加权平均：(0.8 * 1 + 1.0 * 1) / 2 = 0.9
    assert.ok(Math.abs(list[0].metadata.successRate - 0.9) < 0.01, 'successRate 应为加权平均');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsertExperience: 新 id 正常新增', async () => {
  const dir = tmpDir();
  try {
    const exp = sampleExperience('new-id', 0.7);
    await upsertExperience(dir, exp);
    const list = await listExperiences(dir);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'new-id');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

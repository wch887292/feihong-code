/**
 * 自我迭代系统单元测试：强化学习经验库 + 自我改进器真实分析
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage } from '../../src/models/model.interface';
import {
  upsertExperience,
  retrieveRelevantExperiences,
  extractExperience,
  extractFixPattern,
  listExperiences,
  normalizeExperienceId,
  type Experience,
} from '../../src/agent/experience';
import { createSelfImprover } from '../../src/agent/self-improver';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'fhcode-selflearn-'));
}

function mkExp(id: string, tags: string[], successRate: number): Experience {
  return {
    id,
    type: 'tool-efficiency',
    title: `t-${id}`,
    content: 'content',
    metadata: { sessionCount: 1, successRate, tags, createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() },
  };
}

test('upsertExperience 合并同 id 经验（强化学习累积权重）', async () => {
  const dir = tmpDir();
  try {
    const e = mkExp(normalizeExperienceId('tool-efficiency', 'read → edit'), ['read', 'edit'], 1.0);
    await upsertExperience(dir, e);
    await upsertExperience(dir, { ...e, metadata: { ...e.metadata, successRate: 0.0, tags: ['edit', 'newtag'] } });

    const all = await listExperiences(dir);
    assert.equal(all.length, 1, '应去重为 1 条');
    assert.equal(all[0].metadata.sessionCount, 2, 'sessionCount 应累加');
    assert.ok(Math.abs(all[0].metadata.successRate - 0.5) < 1e-9, '成功率应加权平均');
    assert.ok(all[0].metadata.tags.includes('newtag'), '标签应合并');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retrieveRelevantExperiences 加权召回优先返回相关经验', async () => {
  const dir = tmpDir();
  try {
    await upsertExperience(dir, mkExp('a', ['read', 'edit'], 1.0));      // 相关
    await upsertExperience(dir, mkExp('b', ['deploy', 'docker'], 0.0));  // 不相关
    const got = await retrieveRelevantExperiences(dir, '请读取并编辑文件', { limit: 5 });
    assert.ok(got.length >= 1);
    assert.equal(got[0].id, 'a', '标签重叠最高的经验应排第一');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extractExperience 生成稳定 id（跨 run 可去重）', () => {
  const msgs: ChatMessage[] = [
    { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_file', arguments: {} }] },
    { role: 'tool', content: 'ok', toolCallId: '1' },
    { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'edit_file', arguments: {} }] },
    { role: 'tool', content: 'ok', toolCallId: '2' },
    { role: 'assistant', content: '', toolCalls: [{ id: '3', name: 'run_shell', arguments: {} }] },
    { role: 'tool', content: 'ok', toolCallId: '3' },
  ];
  const a = extractExperience(msgs, 'run-1');
  const b = extractExperience(msgs, 'run-2');
  const idA = a.find((e) => e.type === 'tool-efficiency')?.id;
  const idB = b.find((e) => e.type === 'tool-efficiency')?.id;
  assert.ok(idA && idB);
  assert.equal(idA, idB, '相同工具序列应生成相同稳定 id');
});

test('extractFixPattern 从自愈成功会话提取修复经验', () => {
  const msgs: ChatMessage[] = [
    { role: 'tool', content: '错误: TypeError: cannot read property of undefined', toolCallId: '1' },
    { role: 'assistant', content: '已修复该问题并通过验证', toolCalls: [] },
  ];
  const exp = extractFixPattern(msgs);
  assert.ok(exp, '应提取到修复经验');
  assert.equal(exp!.type, 'success-pattern');
  assert.ok(exp!.metadata.tags.includes('runtime-error'), '应归类到具体错误类别');
});

test('extractFixPattern 无修复信号时返回 null', () => {
  const msgs: ChatMessage[] = [
    { role: 'tool', content: '错误: timeout', toolCallId: '1' },
    { role: 'assistant', content: '我不确定', toolCalls: [] },
  ];
  assert.equal(extractFixPattern(msgs), null);
});

test('SelfImprover.reflect 真实分析对话并写入统一经验库', async () => {
  const dir = tmpDir();
  try {
    const improver = createSelfImprover({ experienceDir: dir });
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_file', arguments: {} }] },
      { role: 'tool', content: 'ok', toolCallId: '1' },
      { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'edit_file', arguments: {} }] },
      { role: 'tool', content: '错误: permission denied', toolCallId: '2' },
      { role: 'assistant', content: '已修复权限问题', toolCalls: [] },
    ];
    const r = await improver.reflect(msgs, false, 1234);
    assert.ok(r.patterns.length > 0);
    assert.ok(r.improvements.some((i) => i.includes('前置校验')), '应针对错误产出改进');

    // 经验应写入与 orchestrator 共用的 experiences 库（闭环回流）
    const exps = await listExperiences(dir);
    assert.ok(exps.length >= 1, '反思应产出并保存经验');

    // getLearnedPrompt 能召回
    const prompt = await improver.getLearnedPrompt('修复权限问题');
    assert.ok(prompt.includes('经验'), '学习提示应基于既往经验生成');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

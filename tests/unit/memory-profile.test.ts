/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ④ 业务画像聚合测试（纯函数，全离线）。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { aggregateProfile, formatProfile } from '../../src/memory/profile';
import type { ProjectMemoryEntry } from '../../src/agent/layered-memory';

function entry(partial: Partial<ProjectMemoryEntry>): ProjectMemoryEntry {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    goal: partial.goal ?? '任务',
    decisions: partial.decisions ?? [],
    artifacts: partial.artifacts ?? [],
    pendingIssues: partial.pendingIssues ?? [],
    userPreferences: partial.userPreferences ?? [],
    timestamp: partial.timestamp ?? new Date().toISOString(),
    tags: partial.tags ?? [],
  };
}

test('P1 空记忆 → 空画像', () => {
  const p = aggregateProfile([]);
  assert.strictEqual(p.totalTasks, 0);
  assert.strictEqual(p.keyDecisions.length, 0);
  assert.ok(formatProfile(p).includes('暂无项目记忆'));
});

test('P2 高频标签按频次排序并取 TopN', () => {
  const entries = [
    entry({ goal: 'a', tags: ['管理', '咨询'] }),
    entry({ goal: 'b', tags: ['管理', '代码'] }),
    entry({ goal: 'c', tags: ['管理'] }),
  ];
  const p = aggregateProfile(entries);
  assert.strictEqual(p.topDomains[0].tag, '管理');
  assert.strictEqual(p.topDomains[0].count, 3);
  assert.ok(p.topDomains.length <= 8);
});

test('P3 决策/产物/偏好去重', () => {
  const entries = [
    entry({ goal: 'a', decisions: ['用分层记忆'], artifacts: ['a.ts'], userPreferences: ['中文'] }),
    entry({ goal: 'b', decisions: ['用分层记忆', 'CLI优先'], artifacts: ['a.ts', 'b.ts'], userPreferences: ['中文', '简洁'] }),
  ];
  const p = aggregateProfile(entries);
  assert.strictEqual(p.keyDecisions.length, 2, '重复决策应去重');
  assert.strictEqual(p.artifacts.length, 2, '重复产物应去重');
  assert.strictEqual(p.userPreferences.length, 2);
});

test('P4 时间跨度与最近任务（最新在前）', () => {
  const entries = [
    entry({ goal: '旧任务', timestamp: '2026-09-01T00:00:00.000Z' }),
    entry({ goal: '新任务', timestamp: '2026-10-01T00:00:00.000Z' }),
  ];
  const p = aggregateProfile(entries);
  assert.strictEqual(p.firstAt, '2026-09-01T00:00:00.000Z');
  assert.strictEqual(p.lastAt, '2026-10-01T00:00:00.000Z');
  assert.strictEqual(p.recentGoals[0], '新任务', '最近任务应排最前');
});

test('P5 formatProfile 输出可读画像', () => {
  const entries = [
    entry({ goal: '做对标分析', decisions: ['三档调度'], tags: ['对标'], artifacts: ['src/x.ts'] }),
  ];
  const text = formatProfile(aggregateProfile(entries));
  assert.ok(text.includes('累计任务：1'));
  assert.ok(text.includes('三档调度'));
  assert.ok(text.includes('对标'));
});

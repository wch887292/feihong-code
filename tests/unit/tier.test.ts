/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 算力档位单元测试（对标纳米Work 轻量/省钱/满血）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, classifyGoalTier, normalizeTier, type ComputeTier } from '../../src/models/tier';

test('TIERS 含三档且元信息完整', () => {
  for (const k of ['light', 'save', 'full'] as const) {
    assert.ok(TIERS[k].label, `档位 ${k} 缺 label`);
    assert.ok(TIERS[k].desc, `档位 ${k} 缺 desc`);
    assert.ok(['cost', 'capability', 'latency'].includes(TIERS[k].strategy), `档位 ${k} 策略非法`);
  }
});

test('classifyGoalTier 按复杂度升档', () => {
  assert.equal(classifyGoalTier('帮我写一个工具函数'), 'light');
  assert.equal(classifyGoalTier('帮我设计一个复杂的分布式系统架构方案'), 'full');
  // 长文本（>120 字）且无硬关键词 -> 省钱
  assert.equal(classifyGoalTier('x'.repeat(200)), 'save');
  assert.equal(classifyGoalTier(''), 'light');
});

test('normalizeTier 过滤非法值', () => {
  assert.equal(normalizeTier('light'), 'light' as ComputeTier);
  assert.equal(normalizeTier('invalid'), undefined);
  assert.equal(normalizeTier(undefined), undefined);
  assert.equal(normalizeTier(null), undefined);
});

/**
 * ModelRouter 统计模块单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：updateStat 聚合 / 失败记录模型名 / saveStats+loadStats 落盘往返 /
 *       getStats 报表 / rank 按策略排序
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ModelRouter } from '../../src/models/model-router';
import { ModelError } from '../../src/shared/errors';
import type { ModelProvider, ChatRequest, ChatResponse } from '../../src/models/model.interface';

function mockProvider(id: string, opts: { fail?: boolean; costPer1k?: number; tags?: string[] } = {}): ModelProvider {
  return {
    id,
    model: id,
    tags: (opts.tags ?? ['code-gen']) as ModelProvider['tags'],
    costPer1k: opts.costPer1k ?? 0,
    chat: async (req: ChatRequest): Promise<ChatResponse> => {
      if (opts.fail) throw new Error('mock provider down');
      return {
        providerId: id,
        model: id,
        costUsd: 0.001,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        message: { role: 'assistant', content: `ok from ${id}`, toolCalls: [] },
      };
    },
  };
}

test('updateStat: 成功/失败分别聚合，失败记录使用 provider 模型名（非空串）', async () => {
  const router = new ModelRouter([], 'cost', 0);
  await router.updateStat('p1', 'p1', true, 0.001, 100);
  await router.updateStat('p1', 'p1', false, 0, 300);
  const stats = router.getStats();
  assert.equal(stats.length, 1, '同 provider+model 应合并为一条');
  assert.equal(stats[0].totalCalls, 2);
  assert.equal(stats[0].successfulCalls, 1);
  assert.equal(stats[0].failedCalls, 1);
  assert.equal(stats[0].model, 'p1', '失败条目不能记录为空串模型名');
  assert.equal(stats[0].successRate, 0.5);
  // 平均延迟 = (100*1 + 300) / 2 = 200
  assert.equal(stats[0].avgLatencyMs, 200);
});

test('saveStats + loadStats: 统计落盘后可完整还原（model-stats 命令依赖）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-stats-'));
  try {
    const router = new ModelRouter([], 'cost', 0, 'model-stats.jsonl', dir);
    await router.updateStat('deepseek', 'deepseek-chat', true, 0.01, 50);
    await router.updateStat('deepseek', 'deepseek-chat', true, 0.01, 70);

    // 从磁盘重新加载（模拟新的进程 / model-stats 命令读取）
    const reloaded = new ModelRouter([], 'cost', 0, 'model-stats.jsonl', dir);
    await reloaded.loadStats(dir);
    const stats = reloaded.getStats();
    assert.equal(stats.length, 1);
    assert.equal(stats[0].totalCalls, 2);
    assert.equal(stats[0].totalCostUsd, 0.02);
    assert.equal(stats[0].avgLatencyMs, 60);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('updateStat: 未配置 homeDir 时不落盘（兼容纯内存用法）', async () => {
  const router = new ModelRouter([], 'cost', 0);
  await router.updateStat('p', 'p', true, 0, 10);
  // 未指定 homeDir，不应写出文件（statsFile 默认相对路径不落盘）
  assert.equal(router.getStats().length, 1);
});

test('chat: 全部 provider 失败时抛出最后错误', async () => {
  // maxRetries=1 表示单轮遍历（原始语义）；瞬时错误默认重试 3 轮，见下方专项用例
  const router = new ModelRouter([mockProvider('a', { fail: true }), mockProvider('b', { fail: true })], 'cost', 0, '', '', 1, 0);
  await assert.rejects(() => router.chat({ messages: [] }), /mock provider down/);
  // 失败也应记录统计（模型名非空）
  const stats = router.getStats();
  assert.equal(stats.length, 2);
  for (const s of stats) {
    assert.equal(s.failedCalls, 1);
    assert.notEqual(s.model, '', '失败统计不得出现空模型名');
  }
});

test('chat: fallback 到第二个 provider 并记录成功统计', async () => {
  const router = new ModelRouter([mockProvider('bad', { fail: true }), mockProvider('good')], 'cost', 0);
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'good');
  const stats = router.getStats();
  assert.equal(stats.length, 2, '失败与成功的 provider 各一条');
  const good = stats.find((s) => s.providerId === 'good');
  assert.ok(good);
  assert.equal(good.successfulCalls, 1);
});

test('chat: 瞬时 429 自动退避重试轮换直到成功', async () => {
  let bCalls = 0;
  const a: ModelProvider = {
    id: 'a',
    model: 'a',
    tags: ['code-gen'],
    chat: async () => {
      throw new ModelError('HTTP 429 rate limited', 'a', 429);
    },
  };
  const b: ModelProvider = {
    id: 'b',
    model: 'b',
    tags: ['code-gen'],
    chat: async () => {
      bCalls++;
      if (bCalls < 2) throw new ModelError('HTTP 429 rate limited', 'b', 429);
      return {
        providerId: 'b',
        model: 'b',
        costUsd: 0.001,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        message: { role: 'assistant', content: 'ok from b', toolCalls: [] },
      };
    },
  };
  // maxRetries=3, backoff=0（跳过真实退避等待）
  const router = new ModelRouter([a, b], 'cost', 0, '', '', 3, 0);
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'b');
  assert.equal(bCalls, 2, '首次 429 后应自动重试轮换直到成功');
});

test('chat: 鉴权 401 错误仅轮换不重试', async () => {
  let calls = 0;
  const p: ModelProvider = {
    id: 'p',
    model: 'p',
    tags: ['code-gen'],
    chat: async () => {
      calls++;
      throw new ModelError('HTTP 401 unauthorized', 'p', 401);
    },
  };
  // maxRetries=3，但 401 属鉴权类应立即终止，不触发退避重试
  const router = new ModelRouter([p], 'cost', 0, '', '', 3, 0);
  await assert.rejects(() => router.chat({ messages: [] }), /401/);
  assert.equal(calls, 1, '401 不应退避重试同一模型');
});

test('rank: cost 策略优先低成本 provider', () => {
  const router = new ModelRouter(
    [mockProvider('expensive', { costPer1k: 5 }), mockProvider('cheap', { costPer1k: 0.1 })],
    'cost',
    0,
  );
  const order = router.rank();
  assert.equal(order[0].id, 'cheap', 'cost 策略应排低成本在前');
});

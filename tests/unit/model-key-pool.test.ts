/**
 * 飞虹 Code · provider 级 Key 池单元测试（P0-1，对标 FCC ApiKeyList 设计）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：
 *  - 401/403/429 key 级错误优先切同一 provider 的下一把 key
 *  - key 池耗尽后跳下一家；非 key 级错误跳过剩余 key 直接挑战下一家
 *  - 存量单 key 行为回归（未配 keyRefs 时与改造前一致）
 *  - rank 重排后同 provider key 实例仍聚拢相邻
 *  - updateStat 记录 keyIndex
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../../src/models/model-router';
import { ModelError } from '../../src/shared/errors';
import type { ModelProvider, ChatRequest, ChatResponse } from '../../src/models/model.interface';

/** 调用记录：按顺序记录每次 chat 的 (providerId, keyIndex) */
interface CallRecord {
  id: string;
  keyIndex: number | undefined;
}

/**
 * 带 keyIndex 的 mock provider：plan 决定该 key 的行为——
 * 'ok' 正常返回；数字则抛出对应状态码的 ModelError
 */
function keyedProvider(id: string, keyIndex: number | undefined, plan: 'ok' | number): ModelProvider {
  return {
    id,
    model: id,
    tags: ['code-gen'],
    costPer1k: 0,
    keyIndex,
    chat: async (_req: ChatRequest): Promise<ChatResponse> => {
      if (plan !== 'ok') {
        throw new ModelError(`HTTP ${plan} mock`, id, plan);
      }
      return {
        providerId: id,
        model: id,
        costUsd: 0.001,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        message: { role: 'assistant', content: `ok from ${id}#${keyIndex ?? 1}`, toolCalls: [] },
      };
    },
  };
}

/** 包一层调用记录，返回 [provider, calls] */
function traced(p: ModelProvider, calls: CallRecord[]): ModelProvider {
  return {
    ...p,
    chat: async (req: ChatRequest): Promise<ChatResponse> => {
      calls.push({ id: p.id, keyIndex: p.keyIndex });
      return p.chat(req);
    },
  };
}

test('key 池: 401 优先切同一 provider 的下一把 key（key1 401 → key2 成功）', async () => {
  const calls: CallRecord[] = [];
  const router = new ModelRouter(
    [
      traced(keyedProvider('provA', 1, 401), calls),
      traced(keyedProvider('provA', 2, 'ok'), calls),
      traced(keyedProvider('provB', 1, 'ok'), calls),
    ],
    'cost',
    0,
    '',
    '',
    1,
    0,
  );
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'provA', '应在 provA 的 key2 上成功');
  assert.deepEqual(
    calls.map((c) => `${c.id}#${c.keyIndex ?? 1}`),
    ['provA#1', 'provA#2'],
    '调用顺序必须是 key1 → key2，不碰 provB',
  );
});

test('key 池: 429 优先切下一把 key', async () => {
  const calls: CallRecord[] = [];
  const router = new ModelRouter(
    [
      traced(keyedProvider('provA', 1, 429), calls),
      traced(keyedProvider('provA', 2, 'ok'), calls),
    ],
    'cost',
    0,
    '',
    '',
    1,
    0,
  );
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'provA');
  assert.deepEqual(
    calls.map((c) => `${c.id}#${c.keyIndex ?? 1}`),
    ['provA#1', 'provA#2'],
  );
});

test('key 池: 403 优先切下一把 key', async () => {
  const calls: CallRecord[] = [];
  const router = new ModelRouter(
    [
      traced(keyedProvider('provA', 1, 403), calls),
      traced(keyedProvider('provA', 2, 'ok'), calls),
    ],
    'cost',
    0,
    '',
    '',
    1,
    0,
  );
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'provA');
  assert.deepEqual(
    calls.map((c) => `${c.id}#${c.keyIndex ?? 1}`),
    ['provA#1', 'provA#2'],
  );
});

test('key 池: 400 非 key 级错误不切 key，跳过剩余 key 直接挑战下一家', async () => {
  const calls: CallRecord[] = [];
  const router = new ModelRouter(
    [
      traced(keyedProvider('provA', 1, 400), calls),
      traced(keyedProvider('provA', 2, 'ok'), calls),
      traced(keyedProvider('provB', 1, 'ok'), calls),
    ],
    'cost',
    0,
    '',
    '',
    1,
    0,
  );
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'provB', '400 应跳过 provA 剩余 key 直接用 provB');
  assert.deepEqual(
    calls.map((c) => `${c.id}#${c.keyIndex ?? 1}`),
    ['provA#1', 'provB#1'],
    '不应出现 provA#2',
  );
});

test('key 池: 全部 key 耗尽后跳下一家', async () => {
  const calls: CallRecord[] = [];
  const router = new ModelRouter(
    [
      traced(keyedProvider('provA', 1, 429), calls),
      traced(keyedProvider('provA', 2, 429), calls),
      traced(keyedProvider('provB', 1, 'ok'), calls),
    ],
    'cost',
    0,
    '',
    '',
    1,
    0,
  );
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'provB');
  assert.deepEqual(
    calls.map((c) => `${c.id}#${c.keyIndex ?? 1}`),
    ['provA#1', 'provA#2', 'provB#1'],
  );
});

test('key 池: rank 重排（provB 成本更低排最前）后同 provider key 仍聚拢，401 切 key 生效', async () => {
  const calls: CallRecord[] = [];
  const router = new ModelRouter(
    [
      // provB costPer1k=0 排最前但 500 失败；provA 两把 key 靠聚拢保证 key1 401 后切 key2
      { ...keyedProvider('provB', 1, 500), costPer1k: 0 },
      traced(keyedProvider('provA', 2, 'ok'), calls),
      traced(keyedProvider('provA', 1, 401), calls),
      traced(keyedProvider('provB', 1, 500), calls),
    ].map((p) => (p.id === 'provB' ? traced(p, calls) : p)) as ModelProvider[],
    'cost',
    0,
    '',
    '',
    1,
    0,
  );
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'provA');
  assert.deepEqual(
    calls.map((c) => `${c.id}#${c.keyIndex ?? 1}`),
    ['provB#1', 'provA#1', 'provA#2'],
    'provA 两个 key 必须相邻且 keyIndex 升序',
  );
});

test('回归: 未配 key 池时单 key 401 直接跳下一家（与改造前行为一致）', async () => {
  const calls: CallRecord[] = [];
  const router = new ModelRouter(
    [traced(keyedProvider('provA', undefined, 401), calls), traced(keyedProvider('provB', undefined, 'ok'), calls)],
    'cost',
    0,
    '',
    '',
    1,
    0,
  );
  const resp = await router.chat({ messages: [] });
  assert.equal(resp.providerId, 'provB');
  assert.deepEqual(
    calls.map((c) => c.id),
    ['provA', 'provB'],
  );
});

test('统计: updateStat 记录 keyIndex，旧记录缺省视为 1', async () => {
  const router = new ModelRouter([], 'cost', 0);
  await router.updateStat('provA', 'm1', true, 0.001, 10, 2);
  await router.updateStat('provB', 'm2', true, 0.001, 10);
  const stats = router.getStats();
  assert.equal(stats.length, 2);
  assert.equal(stats.find((s) => s.providerId === 'provA')?.keyIndex, 2);
  assert.equal(stats.find((s) => s.providerId === 'provB')?.keyIndex, 1, '未传 keyIndex 默认 1');
});

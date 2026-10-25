/**
 * 飞虹 Code · P2 Web/HTTP 边界 zod schema 单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖 validateBody + schemas：
 *   - 缺必填字段 / 空串 → 422 + fields，不放行 next
 *   - 合法入参 → 放行 next，且 passthrough 保留未声明的额外字段（不破坏既有 handler）
 *   - 枚举越界（agentType/mode/type）→ 422
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBody } from '../../src/web/http-guards';
import {
  taskBodySchema,
  taskMessageBodySchema,
  webhookBodySchema,
  memoryShortBodySchema,
  memoryAppendBodySchema,
  honchoRememberBodySchema,
} from '../../src/web/schemas';

type AnyRes = { statusCode: number; body: unknown; status: (c: number) => AnyRes; json: (b: unknown) => AnyRes };
function runValidate(schema: unknown, body: unknown): { next: boolean; res: AnyRes } {
  const res: AnyRes = {
    statusCode: 0,
    body: undefined,
    status(c) {
      res.statusCode = c;
      return res;
    },
    json(b) {
      res.body = b;
      return res;
    },
  };
  let next = false;
  const mw = validateBody(schema as never);
  (mw as unknown as (r: unknown, r2: unknown, n: () => void) => void)({ body, header: () => undefined } as never, res as never, () => {
    next = true;
  });
  return { next, res };
}

test('taskBodySchema：goal 缺/空 → 422；合法 + 额外字段 → 放行且 passthrough', () => {
  let r = runValidate(taskBodySchema, {});
  assert.equal(r.next, false);
  assert.equal(r.res.statusCode, 422);
  assert.ok(((r.res.body as any).fields ?? []).some((f: any) => /goal/.test(f.path)));

  r = runValidate(taskBodySchema, { goal: '' });
  assert.equal(r.res.statusCode, 422, '空串 goal 应 422（min(1)）');

  r = runValidate(taskBodySchema, { goal: 'hi', permissions: { a: 1 }, attachments: ['x'], mode: 'autonomous' });
  assert.equal(r.next, true, '合法入参应放行');
  assert.equal(r.res.statusCode, 0);
  // passthrough：额外字段保留在 req.body（中间件已写回）
  const parsed = (taskBodySchema as any).parse({ goal: 'hi', permissions: { a: 1 } }) as Record<string, unknown>;
  assert.deepEqual(parsed.permissions, { a: 1 }, '未声明字段应保留');
});

test('taskBodySchema：agentType 越界 → 422', () => {
  const r = runValidate(taskBodySchema, { goal: 'hi', agentType: 'bogus' });
  assert.equal(r.res.statusCode, 422);
});

test('taskMessageBodySchema：message 必填', () => {
  assert.equal(runValidate(taskMessageBodySchema, { message: 'x' }).next, true);
  assert.equal(runValidate(taskMessageBodySchema, {}).res.statusCode, 422);
});

test('webhookBodySchema：url 必填字符串（格式仍由 handler 二次把关）', () => {
  assert.equal(runValidate(webhookBodySchema, { url: 'https://x.example/hook' }).next, true);
  assert.equal(runValidate(webhookBodySchema, {}).res.statusCode, 422);
});

test('memoryShortBodySchema：type 枚举越界 → 422；合法缺省 type → 放行', () => {
  assert.equal(runValidate(memoryShortBodySchema, { type: 'bogus', title: 't', content: 'c' }).res.statusCode, 422);
  const r = runValidate(memoryShortBodySchema, { title: 't', content: 'c' });
  assert.equal(r.next, true, '缺省 type 合法（handler 兜底为 note）');
});

test('memoryAppendBodySchema：title+content 必填', () => {
  assert.equal(runValidate(memoryAppendBodySchema, { title: 't', content: 'c' }).next, true);
  assert.equal(runValidate(memoryAppendBodySchema, { title: 't' }).res.statusCode, 422);
});

test('honchoRememberBodySchema：content 必填，importance 数值可选', () => {
  assert.equal(runValidate(honchoRememberBodySchema, { content: 'x', importance: 3 }).next, true);
  assert.equal(runValidate(honchoRememberBodySchema, { content: 'x', importance: 'high' }).res.statusCode, 422);
  assert.equal(runValidate(honchoRememberBodySchema, { content: '' }).res.statusCode, 422);
});

/**
 * 飞虹 Code · Web/HTTP 边界守卫单元测试（对标 fullstack-dev skill 铁律 5/6/7）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：
 *   - validateBody：合法入参归一写回 req.body；非法 → 422 + 字段级 fields，不触发 next
 *   - assertValid：合法返回解析结果；非法抛 ValidationError（携带 fields）
 *   - globalErrorHandler：AppError 结构化返回（status+code+fields）；未知错误 500 且不外泄内部信息；headersSent 已发送则短路
 *   - notFoundHandler：/api 未知路径 404
 *   - requestIdMiddleware：无头则生成，有头则沿用（截断 128）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  validateBody,
  assertValid,
  globalErrorHandler,
  notFoundHandler,
  requestIdMiddleware,
} from '../../src/web/http-guards';
import { ValidationError, ConfigError } from '../../src/shared/errors';

type AnyReq = Record<string, any> & { body: unknown; header: (n: string) => string | undefined };
type AnyRes = Record<string, any> & {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status: (c: number) => AnyRes;
  json: (b: unknown) => AnyRes;
};

function mkRes(): AnyRes {
  const res: AnyRes = {
    statusCode: 0,
    body: undefined,
    headersSent: false,
    status(c) {
      res.statusCode = c;
      return res;
    },
    json(b) {
      res.body = b;
      res.headersSent = true;
      return res;
    },
  };
  return res;
}
function mkReq(body: unknown, header?: string): AnyReq {
  return {
    body,
    header: (n: string) => (n.toLowerCase() === 'x-request-id' ? header : undefined),
  } as AnyReq;
}

const schema = z.object({
  goal: z.string().min(1),
  mode: z.enum(['interactive', 'autonomous']).optional(),
});

test('validateBody：合法入参归一写回 req.body 并触发 next', () => {
  const req = mkReq({ goal: ' x ', mode: 'autonomous' });
  const res = mkRes();
  let nextCalled = false;
  (validateBody(schema) as any)(req, res, () => {
    nextCalled = true;
  });
  assert.ok(nextCalled, '合法入参应放行 next');
  assert.equal(res.statusCode, 0, '不应写 4xx');
});

test('validateBody：缺 goal → 422 + 字段级 fields，不放行 next', () => {
  const req = mkReq({ mode: 'interactive' });
  const res = mkRes();
  let nextCalled = false;
  (validateBody(schema) as any)(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false, '非法入参不得放行 next');
  assert.equal(res.statusCode, 422);
  const body = res.body as any;
  assert.equal(body.ok, false);
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(body.fields) && body.fields.length >= 1, '应携带字段级错误');
});

test('assertValid：合法返回解析结果；非法抛 ValidationError', () => {
  const ok = assertValid(schema, { goal: 'hi' }) as { goal: string; mode?: string };
  assert.equal(ok.goal, 'hi');
  assert.throws(
    () => assertValid(schema, { goal: '' }),
    (e: unknown) => e instanceof ValidationError,
  );
});

test('globalErrorHandler：AppError 结构化返回 status+code+fields', () => {
  const res = mkRes();
  globalErrorHandler(new ConfigError('FH_HOME'), mkReq({}) as any, res as any, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal((res.body as any).code, 'CONFIG_ERROR');
  assert.equal((res.body as any).ok, false);

  const res2 = mkRes();
  globalErrorHandler(
    new ValidationError([{ path: 'goal', message: 'required' }]),
    mkReq({}) as any,
    res2 as any,
    () => {},
  );
  assert.equal(res2.statusCode, 422);
  assert.equal((res2.body as any).code, 'VALIDATION_ERROR');
  assert.deepEqual((res2.body as any).fields, [{ path: 'goal', message: 'required' }]);
});

test('globalErrorHandler：未知错误 → 500 INTERNAL_ERROR，且不外泄内部信息', () => {
  const res = mkRes();
  globalErrorHandler(new Error('db://secret-path leaked stack'), mkReq({}) as any, res as any, () => {});
  assert.equal(res.statusCode, 500);
  const body = res.body as any;
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.ok(!String(body.error).includes('secret-path'), '不得外泄内部路径/堆栈');
});

test('globalErrorHandler：headersSent 已发送则短路，不重写响应', () => {
  const res = mkRes();
  res.headersSent = true;
  globalErrorHandler(new Error('late'), mkReq({}) as any, res as any, () => {});
  assert.equal(res.statusCode, 0, 'headersSent 后不得再调 status');
});

test('notFoundHandler：/api 未知路径 404', () => {
  const res = mkRes();
  const req = { path: '/api/nope', header: () => undefined } as any;
  notFoundHandler(req, res as any);
  assert.equal(res.statusCode, 404);
  assert.equal((res.body as any).code, 'NOT_FOUND');
});

test('requestIdMiddleware：无头生成，有头沿用（截断 128）', () => {
  let nextCalled = 0;
  const req1 = { header: () => undefined } as any;
  requestIdMiddleware(req1, mkRes() as any, () => {
    nextCalled += 1;
  });
  assert.ok(typeof req1.requestId === 'string' && req1.requestId.length > 0, '应生成 requestId');
  assert.equal(nextCalled, 1);

  const longId = 'x'.repeat(200);
  const req2 = mkReq({}, longId);
  requestIdMiddleware(req2, mkRes() as any, () => {});
  assert.equal(req2.requestId, longId.slice(0, 128), '应沿用并截断至 128');
});

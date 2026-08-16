/**
 * Web 控制台鉴权单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：requireToken 中间件 —— 有效令牌放行 / 无效令牌 401 /
 *       缺 Authorization 头 401 / 非 Bearer 格式 401（fail-closed）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireToken } from '../../src/web/auth';

function makeReq(authorization?: string) {
  return { header: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined) };
}

function makeRes() {
  let statusCode = 200;
  let body: unknown = null;
  return {
    status(code: number) {
      statusCode = code;
      return { json: (b: unknown) => { body = b; } };
    },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

test('requireToken: 有效 Bearer 令牌放行并调用 next', () => {
  const token = 'secret-token-123';
  const middleware = requireToken(token);
  let nextCalled = false;
  const res = makeRes();
  middleware(makeReq(`Bearer ${token}`) as never, res as never, () => { nextCalled = true; });
  assert.equal(nextCalled, true, '有效令牌应放行');
  assert.equal(res.statusCode, 200);
});

test('requireToken: 令牌错误返回 401', () => {
  const middleware = requireToken('correct-token');
  const res = makeRes();
  let nextCalled = false;
  middleware(makeReq('Bearer wrong-token') as never, res as never, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'unauthorized' });
});

test('requireToken: 缺少 Authorization 头返回 401（fail-closed）', () => {
  const middleware = requireToken('any-token');
  const res = makeRes();
  let nextCalled = false;
  middleware(makeReq(undefined) as never, res as never, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireToken: 非 Bearer 格式（如 Basic）返回 401', () => {
  const middleware = requireToken('any-token');
  const res = makeRes();
  let nextCalled = false;
  middleware(makeReq('Basic dXNlcjpwYXNz') as never, res as never, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireToken: 大小写不敏感（bearer 前缀小写同样放行）', () => {
  const token = 'case-token';
  const middleware = requireToken(token);
  let nextCalled = false;
  const res = makeRes();
  middleware(makeReq(`bearer ${token}`) as never, res as never, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

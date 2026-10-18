/**
 * Web 控制台 API 集成测试（端到端：真实 HTTP 服务 + 鉴权 + 数据脱敏）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：无需鉴权的公钥接口 / fail-closed 鉴权（无 token、错 token → 401）/
 *       带 token 访问模型列表（apiKey 必须脱敏为空字符串）
 * 说明：FH_HOME 已由 tests/helpers/force-offline.mjs 隔离为临时目录，不会触碰真实数据；
 *       端口 0 = 系统随机分配，全程本机回环，无外网依赖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWebServer } from '../../src/web/server';
import type { Server } from 'http';

const TOKEN = 'it-test-token-abc123';

test('web-api: 公钥接口无需鉴权返回 RSA 公钥', async () => {
  const { url, close } = startWebServer({ port: 0, token: TOKEN });
  try {
    const res = await fetch(`${url}/api/security/public-key`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; publicKey?: string };
    assert.equal(body.ok, true);
    assert.ok(body.publicKey && body.publicKey.includes('BEGIN PUBLIC KEY'), '应返回 RSA 公钥 PEM');
  } finally {
    close();
  }
});

test('web-api: 无 token 访问受保护接口一律 401（fail-closed）', async () => {
  const { url, close } = startWebServer({ port: 0, token: TOKEN });
  try {
    const res = await fetch(`${url}/api/models`);
    assert.equal(res.status, 401, '无 token 必须 401，而非放行');
  } finally {
    close();
  }
});

test('web-api: 错误 token 访问受保护接口 401', async () => {
  const { url, close } = startWebServer({ port: 0, token: TOKEN });
  try {
    const res = await fetch(`${url}/api/models`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.equal(res.status, 401);
  } finally {
    close();
  }
});

test('web-api: 正确 token 返回模型列表且 apiKey 脱敏', async () => {
  const { url, close } = startWebServer({ port: 0, token: TOKEN });
  try {
    const res = await fetch(`${url}/api/models`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; models?: Array<{ apiKey?: string; apiBase?: string }> };
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.models), 'models 应为数组');
    for (const m of body.models ?? []) {
      assert.equal(m.apiKey, '', '模型列表中 apiKey 必须脱敏为空字符串，不得回传真实密钥');
    }
  } finally {
    close();
  }
});

test('web-api: 手机号+密码登录（首次注册默认密码=后4位，错误密码 401）', async () => {
  const { url, close } = startWebServer({ port: 0, token: TOKEN });
  try {
    // 首次登录：自动注册，默认密码=后 4 位
    const first = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13800138000', password: '8000' }),
    });
    assert.equal(first.status, 200, '首次登录应成功');
    const firstBody = (await first.json()) as { ok: boolean; token?: string; isFirstLogin?: boolean };
    assert.equal(firstBody.ok, true);
    assert.ok(firstBody.token, '应返回会话令牌');
    assert.equal(firstBody.isFirstLogin, true, '首次登录标记');

    // 已注册账号：正确密码可登录（非首次）
    const second = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13800138000', password: '8000' }),
    });
    const secondBody = (await second.json()) as { ok: boolean; isFirstLogin?: boolean };
    assert.equal(secondBody.isFirstLogin, false, '已注册账号非首次');

    // 错误密码：401 拒绝
    const bad = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13800138000', password: 'wrong-pass' }),
    });
    assert.equal(bad.status, 401, '错误密码必须 401');

    // 缺密码：400
    const noPwd = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13800138000' }),
    });
    assert.equal(noPwd.status, 400, '缺密码必须 400');
  } finally {
    close();
  }
});

/** 类型占位：startWebServer 返回的 close 为同步清理函数 */
export type WebServerHandle = { url: string; close: () => void };
void (null as unknown as Server);

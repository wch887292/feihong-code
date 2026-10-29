/**
 * 轻量 OpenTelemetry（OTLP 三路，默认关）单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 重点验证「默认轻量、缺 SDK 不 crash」的降级契约：
 *  - 无配置 → loadOtelConfig 回退默认 enabled false；initOtel no-op 返回 false；withSpan 透传
 *  - otel.json 损坏 → 回退默认，不抛错
 *  - enabled true 但 SDK 未安装（optionalDependencies 未装）→ 动态 import 失败被捕获，initOtel 返回 false 不 crash
 *  - withSpan 未启用时正常执行并返回 fn 值
 *  - emitLog/emitCounter 未启用时静默降级，不抛错
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  defaultOtelConfig,
  loadOtelConfig,
  initOtel,
  withSpan,
  emitLog,
  emitCounter,
  isOtelEnabled,
} from '../../src/runtime/otel';

function tmpBase(): string {
  return mkdtempSync(join(tmpdir(), 'fhcode-otel-'));
}

test('loadOtelConfig：无 .fhcode/otel.json → 回退默认 enabled false（向后兼容）', () => {
  const dir = tmpBase();
  try {
    const c = loadOtelConfig(dir);
    assert.deepEqual(c, defaultOtelConfig());
    assert.equal(c.enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadOtelConfig：otel.json 损坏 → 回退默认，不抛错', () => {
  const dir = tmpBase();
  try {
    mkdirSync(join(dir, '.fhcode'), { recursive: true });
    writeFileSync(join(dir, '.fhcode', 'otel.json'), '{ 坏 JSON ]]', 'utf-8');
    const c = loadOtelConfig(dir);
    assert.deepEqual(c, defaultOtelConfig());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadOtelConfig：合法 otel.json 解析 enabled/endpoint/service', () => {
  const dir = tmpBase();
  try {
    mkdirSync(join(dir, '.fhcode'), { recursive: true });
    writeFileSync(
      join(dir, '.fhcode', 'otel.json'),
      JSON.stringify({ enabled: true, endpoint: 'http://localhost:4318', service: 'fh-test' }),
      'utf-8',
    );
    const c = loadOtelConfig(dir);
    assert.equal(c.enabled, true);
    assert.equal(c.endpoint, 'http://localhost:4318');
    assert.equal(c.service, 'fh-test');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('initOtel：默认（enabled false）→ 返回 false，全链路 no-op，不影响 isOtelEnabled', async () => {
  const ok = await initOtel(); // 默认配置 enabled=false
  assert.equal(ok, false);
  assert.equal(isOtelEnabled(), false);
});

test('initOtel：enabled true 但 SDK 未安装 → 动态 import 失败被捕获，返回 false 不 crash', async () => {
  // 当前环境 node_modules 无 @opentelemetry/*（optionalDependencies 未安装），
  // 动态 import('@opentelemetry/sdk-node') 将抛 ERR_MODULE_NOT_FOUND，被 catch 捕获降级。
  const ok = await initOtel({ enabled: true, endpoint: 'http://localhost:4318', service: 'fh' });
  assert.equal(ok, false, 'SDK 缺失时 initOtel 必须降级返回 false');
  assert.equal(isOtelEnabled(), false, 'SDK 缺失时不得标记为已启用');
});

test('withSpan：未启用 OTel 时透传 fn 返回值', async () => {
  await initOtel(); // 确保处于未启用态
  const result = await withSpan('fh.task', async () => {
    return 42;
  });
  assert.equal(result, 42);
});

test('withSpan：未启用 OTel 时透传 fn 抛出的异常（不吞异常）', async () => {
  await initOtel();
  await assert.rejects(
    () => withSpan('fh.task', async () => {
      throw new Error('业务异常');
    }),
    /业务异常/,
  );
});

test('emitLog：未启用 OTel 时静默降级，不抛错', () => {
  // 未 initOtel（或未成功启用）时，emitLog 只走本地 logger.debug，绝不抛错
  assert.doesNotThrow(() => {
    emitLog('session.start', 'info', { runId: 'r1' });
  });
});

test('emitCounter：未启用 OTel 时 no-op，不抛错', () => {
  assert.doesNotThrow(() => {
    emitCounter('fh.selfheal.error', 1);
  });
});

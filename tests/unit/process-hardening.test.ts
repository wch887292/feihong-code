/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2-F 进程环境加固测试（对标 Codex process-hardening）：
 *  - 清理注入面环境变量（NODE_OPTIONS / NODE_DEBUG / DEBUG / LD_PRELOAD 等）
 *  - FH_ALLOW_DEBUG=1 逃生口保留 DEBUG / NODE_DEBUG
 *  - 幂等性
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { hardenProcessEnv, HARDENED_ENV_VARS } from '../../src/shared/process-hardening';

// 备份并恢复环境变量，避免污染测试进程
const backup = new Map<string, string | undefined>();
for (const k of HARDENED_ENV_VARS) backup.set(k, process.env[k]);
const debugFlag = process.env.FH_ALLOW_DEBUG;
function restore(): void {
  for (const [k, v] of backup) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (debugFlag === undefined) delete process.env.FH_ALLOW_DEBUG;
  else process.env.FH_ALLOW_DEBUG = debugFlag;
}

test('P2-F1: 默认清理注入面变量', () => {
  try {
    process.env.NODE_OPTIONS = '--require evil.js';
    process.env.NODE_DEBUG = 'net';
    process.env.DEBUG = 'fhcode:*';
    process.env.LD_PRELOAD = '/tmp/evil.so';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    delete process.env.FH_ALLOW_DEBUG;

    const removed = hardenProcessEnv();
    assert.ok(removed.includes('NODE_OPTIONS'), 'NODE_OPTIONS 应被清理');
    assert.ok(removed.includes('LD_PRELOAD'), 'LD_PRELOAD 应被清理');
    assert.strictEqual(process.env.NODE_OPTIONS, undefined);
    assert.strictEqual(process.env.LD_PRELOAD, undefined);
    assert.strictEqual(process.env.DEBUG, undefined);
    assert.strictEqual(process.env.ELECTRON_RUN_AS_NODE, undefined);
  } finally {
    restore();
  }
});

test('P2-F2: FH_ALLOW_DEBUG=1 保留 DEBUG/NODE_DEBUG 但仍清理其他注入面', () => {
  try {
    process.env.FH_ALLOW_DEBUG = '1';
    process.env.DEBUG = 'fhcode:*';
    process.env.NODE_DEBUG = 'net';
    process.env.NODE_OPTIONS = '--require evil.js';

    const removed = hardenProcessEnv();
    assert.strictEqual(process.env.DEBUG, 'fhcode:*', '逃生口保留 DEBUG');
    assert.strictEqual(process.env.NODE_DEBUG, 'net', '逃生口保留 NODE_DEBUG');
    assert.ok(removed.includes('NODE_OPTIONS'), 'NODE_OPTIONS 仍被清理');
    assert.strictEqual(process.env.NODE_OPTIONS, undefined);
  } finally {
    restore();
  }
});

test('P2-F3: 幂等——重复调用无副作用', () => {
  try {
    delete process.env.FH_ALLOW_DEBUG;
    process.env.NODE_OPTIONS = 'x';
    hardenProcessEnv();
    const again = hardenProcessEnv();
    assert.ok(!again.includes('NODE_OPTIONS'), '第二次调用不再报告已清理的变量');
    assert.strictEqual(process.env.NODE_OPTIONS, undefined);
  } finally {
    restore();
  }
});

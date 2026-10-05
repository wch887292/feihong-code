/**
 * src/license/online.ts 在线授权客户端单元测试
 * 覆盖：RSA-PSS 离线验签 / 宽限期计算 / 模式开关 / 吊销立即生效 / 到期拦截 / 换机拦截
 *
 * 关键安全语义（回归重点）：
 *  - 只有设置 FH_LICENSE_SERVER 才进入在线模式，否则离线逻辑完全不受影响
 *  - 吊销（revoked）立即失效，不进宽限
 *  - 宽限期耗尽才因心跳超时失效，避免网络抖动误伤
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateKeyPairSync, sign as cryptoSign, constants } from 'crypto';

import {
  verifyLicenseFile,
  graceHoursLeftAt,
  onlineFingerprint,
  onlineEnabled,
  licenseServerUrl,
  type OnlineState,
} from '../../src/license/online';

const ENV_KEYS = [
  'FH_LICENSE_SERVER',
  'FH_LICENSE_ONLINE',
  'FH_LICENSE_PUBLIC_KEY',
  'FH_LICENSE_GRACE_HOURS',
  'FH_LICENSE_PUBKEY_URL',
  'FH_HOME',
];

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), 'fh-license-online-'));
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of [...ENV_KEYS, ...Object.keys(vars)]) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** 生成一对 RSA 密钥，并构造一个 license-manager 格式的许可证文件 */
function makeLicenseFile(): { pem: string; b64: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const data = JSON.stringify({
    license_key: 'LK-TEST-0001',
    customer_name: '测试客户',
    type: 'pro',
    expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
    max_devices: 3,
  });
  const sig = cryptoSign('sha256', Buffer.from(data, 'utf-8'), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  const envelope = { data, signature: sig.toString('base64'), algorithm: 'RSA-PSS-SHA256' };
  const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  return { pem, b64: Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64') };
}

/** 写一条在线授权记录到沙箱 FH_HOME */
function writeOnlineRecord(home: string, patch: Record<string, unknown> = {}): void {
  mkdirSync(home, { recursive: true });
  const { b64 } = makeLicenseFile();
  const rec = {
    licenseKey: 'LK-TEST-0001',
    licenseFile: b64,
    authorizationCode: 'LIC-TEST-CODE',
    activatedAt: new Date(Date.now() - 3600_000).toISOString(),
    lastHeartbeatAt: Date.now(),
    deviceFingerprint: '', // 留空 => 跳过换机比对（换机另有专门用例）
    type: 'pro',
    issuedTo: '测试客户',
    expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(),
    seats: 3,
    serverStatus: 'active',
    heartbeatFailures: 0,
    ...patch,
  };
  writeFileSync(join(home, 'license-online.json'), JSON.stringify(rec, null, 2), 'utf-8');
}

/* ============================ 模式开关 ============================ */

test('onlineEnabled: 未设置 FH_LICENSE_SERVER 时为 false（离线模式不受影响）', () => {
  withEnv({}, () => {
    assert.strictEqual(onlineEnabled(), false);
    assert.strictEqual(licenseServerUrl(), '');
  });
});

test('onlineEnabled: 设置 FH_LICENSE_SERVER 后为 true', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com' }, () => {
    assert.strictEqual(onlineEnabled(), true);
    assert.strictEqual(licenseServerUrl(), 'https://lm.example.com');
  });
});

test('licenseServerUrl: 去掉末尾斜杠（避免双斜杠拼 URL）', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com///' }, () => {
    assert.strictEqual(licenseServerUrl(), 'https://lm.example.com');
  });
});

test('onlineEnabled: FH_LICENSE_ONLINE=0 可应急强制关闭在线模式', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com', FH_LICENSE_ONLINE: '0' }, () => {
    assert.strictEqual(onlineEnabled(), false);
  });
});

/* ============================ RSA-PSS 离线验签 ============================ */

test('verifyLicenseFile: 合法签名验证通过并解析出载荷', () => {
  const { pem, b64 } = makeLicenseFile();
  const r = verifyLicenseFile(b64, pem);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.data?.license_key, 'LK-TEST-0001');
  assert.strictEqual(r.data?.type, 'pro');
});

test('verifyLicenseFile: 篡改 data 后验签失败（防篡改生效）', () => {
  const { pem, b64 } = makeLicenseFile();
  const envelope = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as { data: string };
  envelope.data = envelope.data.replace('测试客户', '黑客客户');
  const tampered = Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64');
  const r = verifyLicenseFile(tampered, pem);
  assert.strictEqual(r.valid, false);
  assert.match(String(r.reason), /签名/);
});

test('verifyLicenseFile: 换一把公钥验签失败（不可伪造）', () => {
  const { b64 } = makeLicenseFile();
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wrongPem = other.publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const r = verifyLicenseFile(b64, wrongPem);
  assert.strictEqual(r.valid, false);
});

test('verifyLicenseFile: base64 损坏时给出解码失败而非抛异常', () => {
  const r = verifyLicenseFile('!!!not-base64!!!', 'x');
  assert.strictEqual(r.valid, false);
  assert.match(String(r.reason), /解码失败/);
});

test('verifyLicenseFile: 结构缺字段时报"结构不完整"', () => {
  const bad = Buffer.from(JSON.stringify({ data: '{}' }), 'utf-8').toString('base64');
  const r = verifyLicenseFile(bad, 'x');
  assert.strictEqual(r.valid, false);
  assert.match(String(r.reason), /结构不完整/);
});

/* ============================ 宽限期计算 ============================ */

test('graceHoursLeftAt: 刚心跳完接近满值', () => {
  withEnv({ FH_LICENSE_GRACE_HOURS: '72' }, () => {
    const left = graceHoursLeftAt(Date.now());
    assert.ok(left > 71 && left <= 72, `实际 ${left}`);
  });
});

test('graceHoursLeftAt: 超过宽限期归零（不返回负数）', () => {
  withEnv({ FH_LICENSE_GRACE_HOURS: '72' }, () => {
    const left = graceHoursLeftAt(Date.now() - 100 * 3600_000);
    assert.strictEqual(left, 0);
  });
});

test('graceHoursLeftAt: 自定义宽限小时数生效', () => {
  withEnv({ FH_LICENSE_GRACE_HOURS: '24' }, () => {
    const left = graceHoursLeftAt(Date.now() - 12 * 3600_000);
    assert.ok(left > 11 && left <= 12, `实际 ${left}`);
  });
});

test('graceHoursLeftAt: 非法配置回落默认 72h', () => {
  withEnv({ FH_LICENSE_GRACE_HOURS: 'abc' }, () => {
    const left = graceHoursLeftAt(Date.now() - 70 * 3600_000);
    assert.ok(left > 0 && left <= 2.5, `实际 ${left}`);
  });
});

/* ============================ 状态判定 ============================ */

function loadState(overrides: Partial<OnlineState> = {}): OnlineState {
  return {
    hasRecord: true,
    valid: true,
    inGrace: false,
    graceHoursLeft: 10,
    ...overrides,
  };
}

test('onlineState: 合法记录判为有效', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com', FH_HOME: sandbox() }, () => {
    const home = process.env.FH_HOME as string;
    writeOnlineRecord(home);
    // 动态导入以确保在 env 就绪后读取模块内部状态
    const mod = require('../../src/license/online') as typeof import('../../src/license/online');
    const st = mod.onlineState();
    assert.strictEqual(st.hasRecord, true);
    assert.strictEqual(st.valid, true);
    assert.ok(st.graceHoursLeft > 0);
  });
});

test('onlineState: 无记录时 invalid 并提示未激活', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com', FH_HOME: sandbox() }, () => {
    const mod = require('../../src/license/online') as typeof import('../../src/license/online');
    const st = mod.onlineState();
    assert.strictEqual(st.hasRecord, false);
    assert.strictEqual(st.valid, false);
    assert.match(String(st.error), /未激活/);
  });
});

test('onlineState: 服务端标记 revoked 时立即失效且宽限为 0（远程吊销生效）', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com', FH_HOME: sandbox() }, () => {
    const home = process.env.FH_HOME as string;
    writeOnlineRecord(home, { serverStatus: 'revoked' });
    const mod = require('../../src/license/online') as typeof import('../../src/license/online');
    const st = mod.onlineState();
    assert.strictEqual(st.valid, false);
    assert.strictEqual(st.graceHoursLeft, 0);
    assert.match(String(st.error), /吊销/);
  });
});

test('onlineState: 心跳超时超宽限期判为失效', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com', FH_HOME: sandbox(), FH_LICENSE_GRACE_HOURS: '72' }, () => {
    const home = process.env.FH_HOME as string;
    writeOnlineRecord(home, { lastHeartbeatAt: Date.now() - 100 * 3600_000 });
    const mod = require('../../src/license/online') as typeof import('../../src/license/online');
    const st = mod.onlineState();
    assert.strictEqual(st.valid, false);
    assert.match(String(st.error), /未与授权服务通信/);
  });
});

test('onlineState: 已到期判为失效', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com', FH_HOME: sandbox() }, () => {
    const home = process.env.FH_HOME as string;
    writeOnlineRecord(home, { expiresAt: new Date(Date.now() - 86400_000).toISOString() });
    const mod = require('../../src/license/online') as typeof import('../../src/license/online');
    const st = mod.onlineState();
    assert.strictEqual(st.valid, false);
    assert.match(String(st.error), /到期/);
  });
});

test('onlineState: 设备指纹不匹配（换机）立即失效', () => {
  withEnv({ FH_LICENSE_SERVER: 'https://lm.example.com', FH_HOME: sandbox() }, () => {
    const home = process.env.FH_HOME as string;
    writeOnlineRecord(home, { deviceFingerprint: 'deadbeef'.repeat(4) });
    const mod = require('../../src/license/online') as typeof import('../../src/license/online');
    const st = mod.onlineState();
    assert.strictEqual(st.valid, false);
    assert.match(String(st.error), /设备不匹配/);
  });
});

test('onlineState: 未启用在线模式时返回"在线授权未启用"且不拦截', () => {
  withEnv({ FH_HOME: sandbox() }, () => {
    const mod = require('../../src/license/online') as typeof import('../../src/license/online');
    const st = mod.onlineState();
    assert.strictEqual(st.valid, false);
    assert.strictEqual(mod.onlineBlocked(), false, '未启用在线模式不得拦截（交给离线逻辑）');
    assert.match(String(st.error), /未启用/);
  });
});

/* ============================ 指纹与文案 ============================ */

test('onlineFingerprint: 稳定 16 位十六进制且幂等', () => {
  withEnv({}, () => {
    const a = onlineFingerprint();
    const b = onlineFingerprint();
    assert.strictEqual(a, b);
    assert.match(a, /^[0-9a-f]{16}$/);
  });
});

test('loadState 辅助: 覆盖字段生效（测试自检）', () => {
  const st = loadState({ valid: false, error: 'x' });
  assert.strictEqual(st.valid, false);
  assert.strictEqual(st.error, 'x');
});

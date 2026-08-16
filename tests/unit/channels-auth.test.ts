/**
 * O6 安全前置单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：HMAC-SHA256 入站签名校验（正确/篡改/缺参）/
 *       企业微信 SHA1 回调签名校验 / 出站渠道白名单（空=全放行/显式限制/大小写）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'crypto';
import {
  verifyHmacSignature,
  verifyWecomSignature,
  allowedChannels,
  isChannelAllowed,
} from '../../src/web/channels';

const ENV_KEY = 'FH_CHANNEL_ALLOW';
const saved = process.env[ENV_KEY];

test.afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

test('verifyHmacSignature: 正确签名通过，篡改/缺参拒绝', () => {
  const secret = 'my-secret';
  const payload = '{"goal":"写一个 hello.ts"}';
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(verifyHmacSignature(secret, payload, sig), true);
  assert.equal(verifyHmacSignature(secret, payload, `sha256=${sig}`), true, 'sha256= 前缀兼容');
  assert.equal(verifyHmacSignature(secret, payload, sig.slice(0, -1) + '0'), false, '篡改应拒绝');
  assert.equal(verifyHmacSignature(secret, payload, undefined), false, '缺签名拒绝');
  assert.equal(verifyHmacSignature('', payload, sig), false, '缺密钥拒绝');
  assert.equal(verifyHmacSignature(secret, payload, 'not-hex'), false, '非法签名拒绝');
});

test('verifyWecomSignature: 企微 SHA1 排序校验', () => {
  const token = 'wecom-token';
  const ts = '1700000000';
  const nonce = 'nonce123';
  const echo = 'echo456';
  // 按规范：sha1(sort([token, timestamp, nonce, echoStr]).join(''))
  const expected = createHash('sha1').update([token, ts, nonce, echo].sort().join('')).digest('hex');
  assert.equal(verifyWecomSignature(token, ts, nonce, echo, expected), true);
  assert.equal(verifyWecomSignature(token, ts, nonce, echo, expected.slice(0, -1) + '0'), false, '篡改拒绝');
  assert.equal(verifyWecomSignature('', ts, nonce, echo, expected), false, '缺 token 拒绝');
});

test('allowedChannels / isChannelAllowed: 空=全放行，显式=仅白名单', () => {
  delete process.env[ENV_KEY];
  assert.deepEqual(allowedChannels(), []);
  assert.equal(isChannelAllowed('telegram'), true, '未配置白名单全放行');
  assert.equal(isChannelAllowed('wecom'), true);

  process.env[ENV_KEY] = 'telegram, WECOM';
  assert.deepEqual(allowedChannels(), ['telegram', 'wecom']);
  assert.equal(isChannelAllowed('telegram'), true);
  assert.equal(isChannelAllowed('WECOM'), true, '大小写不敏感');
  assert.equal(isChannelAllowed('slack'), false, '非白名单渠道拒绝');
});

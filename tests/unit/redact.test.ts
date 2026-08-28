/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 脱敏回归测试（M12）：覆盖 audit.redact 与 logger.redact 的敏感字段识别。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { redact as redactAudit } from '../../src/enterprise/audit';
import { redact as redactMeta } from '../../src/shared/logger';

test('audit.redact: 传统 key=value 形态脱敏', () => {
  const out = redactAudit('apiKey=sk-abcdefgh12345678');
  assert.ok(out.includes('***'), '应含脱敏占位');
  assert.ok(!out.includes('sk-abcdefgh12345678'), '原文密钥不应出现');
});

test('audit.redact: JSON 键值形态 ("key":"value") 脱敏', () => {
  const out = redactAudit('payload {"client_secret":"abc123secret"} done');
  assert.ok(!out.includes('abc123secret'), 'JSON 内 client_secret 值应被遮蔽');
});

test('audit.redact: Bearer 令牌脱敏', () => {
  // Authorization: Bearer <JWT> 形态：JWT 明文不应泄露（Bearer 词与 JWT 值均被遮蔽）
  const out = redactAudit('Authorization: Bearer eyJabc.def.ghi');
  assert.ok(!out.includes('eyJabc'), 'JWT 明文不应出现');
});

test('audit.redact: JWT 整体脱敏', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const out = redactAudit(`token=${jwt}`);
  assert.ok(!out.includes(jwt), 'JWT 不应以明文出现');
});

test('audit.redact: sk- 前缀令牌脱敏', () => {
  const out = redactAudit('curl -H "Authorization: Bearer sk-SECRETVALUE123456"');
  assert.ok(!out.includes('SECRETVALUE'), 'sk- 令牌明文不应出现');
});

test('audit.redact: access_token 形态脱敏', () => {
  const out = redactAudit('access_token=AtZh3k9Lm2Qp8Wx7Yc1Bv5Nm6');
  assert.ok(!out.includes('AtZh3k9Lm2Qp8Wx7Yc1Bv5Nm6'), 'access_token 值应被遮蔽');
});

test('logger.redact: 敏感 key 整值遮蔽', () => {
  const out = redactMeta({ clientSecret: 'topsecretvalue', role: 'admin' });
  assert.strictEqual(out.clientSecret, '[REDACTED]');
  assert.strictEqual(out.role, 'admin');
});

test('logger.redact: 普通 key 但值疑似 sk- 令牌也遮蔽', () => {
  const out = redactMeta({ data: 'sk-SUPERSECRET999999' });
  assert.strictEqual(out.data, '[REDACTED]');
});

test('logger.redact: 非敏感字段原样保留', () => {
  const out = redactMeta({ path: '/src/app.ts', lines: 42 });
  assert.strictEqual(out.path, '/src/app.ts');
  assert.strictEqual(out.lines, 42);
});

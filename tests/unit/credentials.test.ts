/**
 * 凭据引用机制单元测试（对标 dsh credentials seam）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：引用名校验 / 解析优先级（存储>环境变量）/ 原子写往返 / apiKeyEnv 优先于 apiKey
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isCredentialRefName,
  resolveCredential,
  setCredential,
  unsetCredential,
  listCredentials,
  resolveProviderApiKey,
  credentialsPath,
} from '../../src/security/credentials';

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'fh-creds-'));
}

test('isCredentialRefName: 只接受 POSIX 标识符', () => {
  assert.ok(isCredentialRefName('FHC_OPENROUTER_API_KEY'));
  assert.ok(isCredentialRefName('_X1'));
  assert.equal(isCredentialRefName('FHC-X'), false, '连字符非法');
  assert.equal(isCredentialRefName('1ABC'), false, '数字开头非法');
  assert.equal(isCredentialRefName(''), false);
});

test('setCredential/unsetCredential: 原子写往返 + 备份', () => {
  const home = tempHome();
  try {
    setCredential('FHC_TEST_1', 'sk-secret-1', home);
    assert.ok(existsSync(join(home, '.credentials.json')));
    const doc = JSON.parse(readFileSync(join(home, '.credentials.json'), 'utf8'));
    assert.equal(doc.version, 1);
    assert.equal(doc.refs['FHC_TEST_1'], 'sk-secret-1');

    // 覆盖写：生成 .bak 备份
    setCredential('FHC_TEST_1', 'sk-secret-2', home);
    assert.equal(resolveCredential('FHC_TEST_1', home), 'sk-secret-2');
    assert.ok(
      readdirNameCount(home) > 0,
      '旧版本应备份为 .bak-*',
    );

    assert.ok(unsetCredential('FHC_TEST_1', home));
    assert.equal(resolveCredential('FHC_TEST_1', home), undefined);
    assert.equal(unsetCredential('FHC_TEST_1', home), false, '重复 unset 应返回 false');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

function readdirNameCount(dir: string): number {
  // 统计 .credentials.json.bak-* 备份文件数
  const { readdirSync } = require('fs') as typeof import('fs');
  return readdirSync(dir).filter((n) => n.startsWith('.credentials.json.bak-')).length;
}

test('resolveCredential: 存储优先于环境变量，缺失回退环境', () => {
  const home = tempHome();
  const envRef = 'FHC_ENV_ONLY_TEST';
  process.env[envRef] = 'from-env';
  try {
    assert.equal(resolveCredential(envRef, home), 'from-env', '无存储时回退环境变量');
    setCredential(envRef, 'from-store', home);
    assert.equal(resolveCredential(envRef, home), 'from-store', '存储优先于环境变量');
  } finally {
    delete process.env[envRef];
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveCredential: 非法引用名/空值返回 undefined', () => {
  assert.equal(resolveCredential('bad-ref', tempHome()), undefined);
  assert.equal(resolveCredential('', tempHome()), undefined);
});

test('resolveProviderApiKey: apiKeyEnv 优先，回退 apiKey 兼容旧配置', () => {
  const home = tempHome();
  try {
    // 无 apiKeyEnv：回退 apiKey（存量配置兼容）
    assert.equal(resolveProviderApiKey({ apiKey: 'legacy' }, home), 'legacy');
    // apiKeyEnv 已配置：走 seam
    setCredential('FHC_PAIR_1', 'from-store', home);
    assert.equal(resolveProviderApiKey({ apiKeyEnv: 'FHC_PAIR_1', apiKey: 'legacy' }, home), 'from-store');
    // apiKeyEnv 存在但未配置：返回 undefined（不静默回退 apiKey，避免误导）
    assert.equal(resolveProviderApiKey({ apiKeyEnv: 'FHC_MISSING_1', apiKey: 'legacy' }, home), undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('listCredentials: 只暴露引用名与状态，不暴露值', () => {
  const home = tempHome();
  try {
    setCredential('FHC_LIST_1', 'sk-very-secret-value', home);
    const rows = listCredentials(home);
    const row = rows.find((r) => r.ref === 'FHC_LIST_1');
    assert.ok(row, '引用应出现在列表');
    assert.equal(row!.stored, true);
    assert.equal(JSON.stringify(rows).includes('sk-very-secret-value'), false, '列表不得包含密钥值');
    assert.ok(credentialsPath(home).endsWith('.credentials.json'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

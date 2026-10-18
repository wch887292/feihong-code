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

test('setCredential/unsetCredential: 原子写往返 + 备份（v2 文档）', () => {
  const home = tempHome();
  try {
    setCredential('FHC_TEST_1', 'sk-secret-1', undefined, home);
    assert.ok(existsSync(join(home, '.credentials.json')));
    const doc = JSON.parse(readFileSync(join(home, '.credentials.json'), 'utf8'));
    assert.equal(doc.version, 2);
    assert.equal(doc.scopes.global['FHC_TEST_1'], 'sk-secret-1');

    // 覆盖写：生成 .bak 备份
    setCredential('FHC_TEST_1', 'sk-secret-2', undefined, home);
    assert.equal(resolveCredential('FHC_TEST_1', home), 'sk-secret-2');
    assert.ok(
      readdirNameCount(home) > 0,
      '旧版本应备份为 .bak-*',
    );

    assert.ok(unsetCredential('FHC_TEST_1', undefined, home));
    assert.equal(resolveCredential('FHC_TEST_1', home), undefined);
    assert.equal(unsetCredential('FHC_TEST_1', undefined, home), false, '重复 unset 应返回 false');
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
    setCredential(envRef, 'from-store', undefined, home);
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
    setCredential('FHC_PAIR_1', 'from-store', undefined, home);
    assert.equal(resolveProviderApiKey({ apiKeyEnv: 'FHC_PAIR_1', apiKey: 'legacy' }, home), 'from-store');
    // apiKeyEnv 存在但未配置：返回 undefined（不静默回退 apiKey，避免误导）
    assert.equal(resolveProviderApiKey({ apiKeyEnv: 'FHC_MISSING_1', apiKey: 'legacy' }, home), undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('listCredentials: 只暴露引用名与状态，不暴露值（含作用域）', () => {
  const home = tempHome();
  try {
    setCredential('FHC_LIST_1', 'sk-very-secret-value', undefined, home);
    setCredential('FHC_SCOPED_1', 'sk-scoped-value', 'my-project', home);
    const rows = listCredentials(home);
    const row = rows.find((r) => r.ref === 'FHC_LIST_1');
    assert.ok(row, '引用应出现在列表');
    assert.equal(row!.stored, true);
    assert.equal(row!.scope, 'global');
    const scoped = rows.find((r) => r.ref === 'FHC_SCOPED_1');
    assert.ok(scoped, '作用域引用应出现在列表');
    assert.equal(scoped!.scope, 'my-project');
    assert.equal(JSON.stringify(rows).includes('sk-very-secret-value'), false, '列表不得包含密钥值');
    assert.equal(JSON.stringify(rows).includes('sk-scoped-value'), false, '列表不得包含作用域密钥值');
    assert.ok(credentialsPath(home).endsWith('.credentials.json'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('v2 环境作用域：set --env / env:<scope>/REF 显式解析 / 不命中不回退全局', () => {
  const home = tempHome();
  try {
    // 环境作用域写入
    setCredential('FHC_ENV_SCOPE_1', 'sk-scope-a', 'scope-a', home);
    assert.equal(resolveCredential('env:scope-a/FHC_ENV_SCOPE_1', home), 'sk-scope-a', '显式 env:<scope>/REF 命中');

    // 全局同名引用存在：显式作用域不命中时不得回退全局
    setCredential('FHC_ENV_SCOPE_1', 'sk-global', undefined, home);
    assert.equal(resolveCredential('env:scope-other/FHC_ENV_SCOPE_1', home), undefined, '显式作用域不命中不回退');
    assert.equal(resolveCredential('FHC_ENV_SCOPE_1', home), 'sk-global', '裸引用命中全局');

    // 裸引用优先命中当前项目派生作用域（cwd 指定）
    const { deriveProjectId } = require('../../src/shared/project-env') as typeof import('../../src/shared/project-env');
    const projId = deriveProjectId('/tmp/fh-codex-project');
    setCredential('FHC_PROJ_1', 'sk-proj', projId, home);
    assert.equal(resolveCredential('FHC_PROJ_1', home, '/tmp/fh-codex-project'), 'sk-proj', '裸引用命中项目作用域');

    // 项目作用域不命中 → 全局
    setCredential('FHC_PROJ_2', 'sk-proj2', projId, home);
    setCredential('FHC_PROJ_2', 'sk-proj2-global', undefined, home);
    assert.equal(resolveCredential('FHC_PROJ_2', home, '/some/other-dir'), 'sk-proj2-global', '项目不命中回退全局');

    // unset 环境作用域
    assert.ok(unsetCredential('FHC_ENV_SCOPE_1', 'scope-a', home));
    assert.equal(resolveCredential('env:scope-a/FHC_ENV_SCOPE_1', home), undefined, 'unset 后解析为空');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/**
 * 手机号账号体系单元测试（v8.11 账号升级）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：注册（默认密码=后 4 位）/ 登录校验 / 密码修改 / 激活账号 /
 *       resolveAccountHome 账号目录隔离 / 账号列表 / 删除账号
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isValidPhone,
  defaultPassword,
  registerAccount,
  accountExists,
  loginAccount,
  changePassword,
  verifyPassword,
  listAccounts,
  removeAccount,
  getActiveAccount,
  setActiveAccount,
  clearActiveAccount,
  resolveAccountHome,
  accountHome,
  hashPassword,
} from '../../src/security/account';

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'fh-account-'));
}

test('isValidPhone / defaultPassword：格式与默认密码', () => {
  assert.ok(isValidPhone('13800138000'));
  assert.ok(isValidPhone('+8613800138000'));
  assert.equal(isValidPhone('12345'), false, '过短');
  assert.equal(isValidPhone('abcdefg'), false, '非数字');
  assert.equal(defaultPassword('13800138000'), '8000', '默认密码=后 4 位');
  assert.equal(defaultPassword('+8613800138000'), '8000');
});

test('registerAccount/loginAccount：首次自动注册，默认密码可登录，密码错误拒绝', () => {
  const home = tempHome();
  try {
    const r = loginAccount('13800138000', defaultPassword('13800138000'), home);
    assert.equal(r.isFirstLogin, true, '首次登录自动注册');
    assert.ok(accountExists('13800138000', home));
    assert.ok(existsSync(join(home, 'accounts', '13800138000', 'account.json')));

    // 密码哈希落盘，绝不落明文
    const raw = readFileSync(join(home, 'accounts', '13800138000', 'account.json'), 'utf8');
    const meta = JSON.parse(raw);
    assert.notEqual(meta.passwordHash, '8000', '哈希不得等于明文默认密码');
    assert.ok(meta.passwordHash && meta.salt, '含 scrypt 哈希与盐');
    assert.ok(/^[A-Za-z0-9+/=]+$/.test(meta.passwordHash), '哈希为 base64 编码');

    // 再次登录（非首次）
    const r2 = loginAccount('13800138000', defaultPassword('13800138000'), home);
    assert.equal(r2.isFirstLogin, false, '已注册账号非首次');

    // 密码错误
    assert.throws(() => loginAccount('13800138000', 'wrong', home), /密码错误/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('changePassword：旧密码校验 + 新密码至少 4 位 + 改后生效', () => {
  const home = tempHome();
  try {
    registerAccount('13800138000', home);
    assert.throws(() => changePassword('13800138000', 'bad', 'newpass', home), /旧密码错误/);
    assert.throws(() => changePassword('13800138000', '8000', '123', home), /至少 4 位/);
    assert.ok(changePassword('13800138000', '8000', 'newpass', home));
    // 新密码可登录，旧密码失效
    assert.equal(loginAccount('13800138000', 'newpass', home).isFirstLogin, false);
    assert.throws(() => loginAccount('13800138000', '8000', home), /密码错误/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('activate / resolveAccountHome：激活账号后数据目录隔离，未激活回落 FH_HOME', () => {
  const home = tempHome();
  try {
    // 未激活：回落 FH_HOME
    assert.equal(resolveAccountHome(home), home);

    registerAccount('13800138000', home);
    registerAccount('13900139000', home);
    assert.throws(() => setActiveAccount('unknown-phone', home), /账号不存在/);

    setActiveAccount('13800138000', home);
    assert.equal(getActiveAccount(home), '13800138000');
    assert.equal(resolveAccountHome(home), join(home, 'accounts', '13800138000'));
    assert.equal(accountHome('13800138000', home), join(home, 'accounts', '13800138000'));

    // 切换激活账号 → 目录切换（全隔离）
    setActiveAccount('13900139000', home);
    assert.equal(resolveAccountHome(home), join(home, 'accounts', '13900139000'));

    clearActiveAccount(home);
    assert.equal(getActiveAccount(home), null);
    assert.equal(resolveAccountHome(home), home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('listAccounts / removeAccount：列表不泄哈希，删除账号清目录并清激活', () => {
  const home = tempHome();
  try {
    registerAccount('13800138000', home);
    registerAccount('13900139000', home);
    const rows = listAccounts(home);
    assert.equal(rows.length, 2);
    assert.equal(JSON.stringify(rows).includes('passwordHash'), false, '列表不得含密码哈希');

    setActiveAccount('13800138000', home);
    assert.ok(removeAccount('13800138000', home));
    assert.equal(accountExists('13800138000', home), false);
    assert.equal(getActiveAccount(home), null, '删除激活账号应同时清除激活状态');
    assert.equal(listAccounts(home).length, 1);
    assert.equal(removeAccount('nope', home), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('verifyPassword：哈希校验正确性（含盐差异）', () => {
  const { hash, salt } = hashPassword('secret-pw');
  assert.ok(verifyPassword('secret-pw', hash, salt));
  assert.equal(verifyPassword('wrong', hash, salt), false);
  // 同密码不同盐 → 哈希不同（防预计算）
  const h2 = hashPassword('secret-pw');
  assert.notEqual(h2.hash, hash);
});

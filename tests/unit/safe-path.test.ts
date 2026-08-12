/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 路径安全测试（safeJoin 词法穿越拦截，纵深防御基线）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { relative, sep } from 'path';
import { safeJoin } from '../../src/tools/safe-path';
import { SecurityError } from '../../src/shared/errors';

test('safeJoin 允许工作区内相对路径', () => {
  const r = safeJoin('/workspace', 'src/app.ts');
  // 归一化分隔符后比较，避免 Windows 反斜杠导致的差异
  const rel = relative('/workspace', r).split(sep).join('/');
  assert.strictEqual(rel, 'src/app.ts');
});

test('safeJoin 拒绝 ../ 向上穿越', () => {
  assert.throws(() => safeJoin('/workspace', '../secret'), SecurityError);
  assert.throws(() => safeJoin('/workspace', '../../etc/passwd'), SecurityError);
});

test('safeJoin 拒绝绝对越界路径', () => {
  assert.throws(() => safeJoin('/workspace', '/etc/passwd'), SecurityError);
});

/**
 * OS 级沙箱执行层单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：危险命令拦截 / 环境注入清理 / 平台探测分派（mock 平台）/
 *      Windows 受限执行（本机真实链路：echo + 退出码 + 超时强杀）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDangerousCommand,
  sanitizeEnv,
  detectOsSandbox,
  runOsSandboxed,
  describeOsSandbox,
} from '../../src/runtime/os-sandbox';

test('checkDangerousCommand: 拦截 rm -rf / 与 mkfs、dd 块设备、fork 炸弹', () => {
  assert.ok(checkDangerousCommand('rm -rf /'), 'rm -rf / 被拦截');
  assert.ok(checkDangerousCommand('rm -rf /etc'), 'rm -rf 根下路径被拦截');
  assert.equal(checkDangerousCommand('rm -rf /workspace/tmp'), null, 'rm -rf 工作区下放行');
  assert.ok(checkDangerousCommand('mkfs.ext4 /dev/sda1'), 'mkfs 被拦截');
  assert.ok(checkDangerousCommand('dd if=/dev/zero of=/dev/sda'), 'dd 写块设备被拦截');
  assert.ok(checkDangerousCommand(':(){ :|:& };:'), 'fork 炸弹被拦截');
  assert.equal(checkDangerousCommand('echo hello && ls -la'), null, '普通命令放行');
});

test('sanitizeEnv: 清理注入面并保留常规变量', () => {
  process.env.NODE_OPTIONS = '--require /evil.js';
  process.env.LD_PRELOAD = '/evil.so';
  process.env.MY_KEEP = 'keep';
  const env = sanitizeEnv({ EXTRA: '1' });
  assert.equal(env.NODE_OPTIONS, undefined, 'NODE_OPTIONS 被清理');
  assert.equal(env.LD_PRELOAD, undefined, 'LD_PRELOAD 被清理');
  assert.equal(env.MY_KEEP, 'keep', '常规变量保留');
  assert.equal(env.EXTRA, '1', '显式注入保留');
});

test('detectOsSandbox: 返回平台与后端（不抛错）', async () => {
  const info = await detectOsSandbox();
  assert.ok(['linux', 'darwin', 'win32'].includes(info.platform), '平台枚举合法');
  assert.ok(['bwrap', 'unshare', 'sandbox-exec', 'restricted'].includes(info.backend), '后端枚举合法');
});

test('describeOsSandbox: 每种后端都有可读描述', () => {
  for (const backend of ['bwrap', 'unshare', 'sandbox-exec', 'restricted'] as const) {
    const s = describeOsSandbox({ platform: 'linux', backend, available: false });
    assert.ok(s.length > 0, backend + ' 有描述');
  }
});

test('runOsSandboxed: 危险命令直接拒绝，不进入执行', async () => {
  const r = await runOsSandboxed({ command: 'rm -rf /etc', cwd: process.cwd() });
  assert.equal(r.success, false);
  assert.match(r.stderr, /危险命令/);
});

test('runOsSandboxed: Windows 受限执行真实链路（echo + 退出码）', { skip: process.platform !== 'win32' }, async () => {
  const ok = await runOsSandboxed({ command: 'echo OS_SANDBOX_OK', cwd: process.cwd(), timeoutMs: 15000 });
  assert.equal(ok.exitCode, 0);
  assert.match(ok.stdout, /OS_SANDBOX_OK/);
  const fail = await runOsSandboxed({ command: 'exit /b 7', cwd: process.cwd(), timeoutMs: 15000 });
  assert.equal(fail.exitCode, 7);
});

test('runOsSandboxed: 超时强杀（Windows 受限模式杀进程树）', { skip: process.platform !== 'win32' }, async () => {
  const start = Date.now();
  const r = await runOsSandboxed({ command: 'ping -n 30 127.0.0.1 >nul', cwd: process.cwd(), timeoutMs: 2000 });
  assert.equal(r.timedOut, true, '超时标记');
  assert.ok(Date.now() - start < 15000, '未等到命令自然结束');
});

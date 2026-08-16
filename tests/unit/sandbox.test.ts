/**
 * 沙箱三模式 + 网络域名规则单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：模式归一化 / read-only 禁写禁执行 / danger-full-access 放行 /
 *       网络 deny 黑名单（全模式生效）/ 网络 allow 白名单 / 域名解析
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSandboxMode,
  extractNetworkHosts,
  checkSandbox,
  describeSandboxMode,
  type SandboxRules,
} from '../../src/tools/sandbox';

const EMPTY_RULES: SandboxRules = { networkAllow: [], networkDeny: [] };

test('normalizeSandboxMode: 合法值与回退', () => {
  assert.equal(normalizeSandboxMode('read-only'), 'read-only');
  assert.equal(normalizeSandboxMode('readonly'), 'read-only');
  assert.equal(normalizeSandboxMode('workspace-write'), 'workspace-write');
  assert.equal(normalizeSandboxMode('danger-full-access'), 'danger-full-access');
  assert.equal(normalizeSandboxMode('full'), 'danger-full-access');
  assert.equal(normalizeSandboxMode('container'), 'container', 'P5-4 容器模式');
  assert.equal(normalizeSandboxMode('docker'), 'container', 'docker 别名');
  assert.equal(normalizeSandboxMode(undefined), 'workspace-write', '缺省回退 workspace-write');
  assert.equal(normalizeSandboxMode('bogus'), 'workspace-write', '非法值回退 workspace-write');
});

test('extractNetworkHosts: 提取 http(s) 目标主机', () => {
  assert.deepEqual(extractNetworkHosts('curl https://api.example.com/v1'), ['api.example.com']);
  assert.deepEqual(extractNetworkHosts('git clone https://github.com/openai/codex.git'), ['github.com']);
  assert.deepEqual(extractNetworkHosts('npm install https://registry.npmjs.org/pkg'), ['registry.npmjs.org']);
  assert.deepEqual(extractNetworkHosts('echo no network'), [], '无 URL 返回空');
  // 去重 + 剥离端口
  assert.deepEqual(
    extractNetworkHosts('curl http://a.com http://a.com:8080/x'),
    ['a.com'],
  );
});

test('read-only: 禁写文件、禁 shell、放行只读工具', () => {
  assert.equal(checkSandbox('read-only', 'write_file', { path: 'a.ts', content: 'x' }, EMPTY_RULES).blocked, true);
  assert.equal(checkSandbox('read-only', 'edit_file', { path: 'a.ts', oldText: 'x', newText: 'y' }, EMPTY_RULES).blocked, true);
  assert.equal(checkSandbox('read-only', 'run_shell', { command: 'ls' }, EMPTY_RULES).blocked, true);
  assert.equal(checkSandbox('read-only', 'read_file', { path: 'a.ts' }, EMPTY_RULES).blocked, false);
  assert.equal(checkSandbox('read-only', 'grep', { pattern: 'x' }, EMPTY_RULES).blocked, false);
});

test('workspace-write: 默认放行（由白名单/审批另行约束）', () => {
  assert.equal(checkSandbox('workspace-write', 'write_file', { path: 'a.ts' }, EMPTY_RULES).blocked, false);
  assert.equal(checkSandbox('workspace-write', 'run_shell', { command: 'ls' }, EMPTY_RULES).blocked, false);
});

test('danger-full-access: 放行写与 shell（危险命令黑名单仍在策略层生效）', () => {
  assert.equal(checkSandbox('danger-full-access', 'write_file', { path: 'a.ts' }, EMPTY_RULES).blocked, false);
  assert.equal(checkSandbox('danger-full-access', 'run_shell', { command: 'anything' }, EMPTY_RULES).blocked, false);
});

test('网络 deny 黑名单: 任意模式都拦截（安全基线）', () => {
  const rules: SandboxRules = { networkAllow: [], networkDeny: ['evil.example.com', '.blocked.com'] };
  // danger-full-access 也拦（黑名单是硬底线）
  assert.equal(checkSandbox('danger-full-access', 'run_shell', { command: 'curl https://evil.example.com/x' }, rules).blocked, true);
  assert.equal(checkSandbox('workspace-write', 'run_shell', { command: 'curl https://api.blocked.com/v1' }, rules).blocked, true);
  // 精确域名不误伤
  assert.equal(checkSandbox('workspace-write', 'run_shell', { command: 'curl https://example.com' }, rules).blocked, false);
});

test('网络 allow 白名单: workspace-write 下未命中即拦截；read-only 下 shell 本就拦截', () => {
  const rules: SandboxRules = { networkAllow: ['api.example.com'], networkDeny: [] };
  assert.equal(checkSandbox('workspace-write', 'run_shell', { command: 'curl https://api.example.com/v1' }, rules).blocked, false);
  assert.equal(checkSandbox('workspace-write', 'run_shell', { command: 'curl https://other.com' }, rules).blocked, true);
  // 无 URL 的命令不受网络规则影响
  assert.equal(checkSandbox('workspace-write', 'run_shell', { command: 'ls -la' }, rules).blocked, false);
});

test('describeSandboxMode: 四种模式都有可读描述', () => {
  assert.ok(describeSandboxMode('read-only').length > 0);
  assert.ok(describeSandboxMode('workspace-write').length > 0);
  assert.ok(describeSandboxMode('danger-full-access').length > 0);
  assert.ok(describeSandboxMode('container').length > 0);
});

test('container: 放行文件工具与 shell，网络规则仍生效', () => {
  assert.equal(checkSandbox('container', 'write_file', { path: 'a.ts' }, EMPTY_RULES).blocked, false);
  assert.equal(checkSandbox('container', 'run_shell', { command: 'ls' }, EMPTY_RULES).blocked, false);
  // 网络 deny 黑名单任意模式生效
  const deny: SandboxRules = { networkAllow: [], networkDeny: ['evil.com'] };
  assert.equal(checkSandbox('container', 'run_shell', { command: 'curl https://evil.com' }, deny).blocked, true);
  // 网络 allow 白名单未命中拦截
  const allow: SandboxRules = { networkAllow: ['good.com'], networkDeny: [] };
  assert.equal(checkSandbox('container', 'run_shell', { command: 'curl https://bad.com' }, allow).blocked, true);
  assert.equal(checkSandbox('container', 'run_shell', { command: 'curl https://good.com' }, allow).blocked, false);
});

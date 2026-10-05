/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 回归测试：shell 超时治理（2026-10-05 复盘修复）
 * 背景：默认 60s 超时 < npm test 实际 62s+，agent 只见 exit 1 无输出反复空转。
 * 修复：默认 180s + FH_SHELL_TIMEOUT_MS 可覆盖 + timedOut 结构化标记 + run_shell timeout 参数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { defaultShellTimeoutMs, runCommand } from '../../src/tools/shell/exec';
import { runShellTool } from '../../src/tools/shell/run-shell.tool';

test('shell-timeout: 默认超时为 180 秒', () => {
  const saved = process.env.FH_SHELL_TIMEOUT_MS;
  delete process.env.FH_SHELL_TIMEOUT_MS;
  try {
    assert.equal(defaultShellTimeoutMs(), 180000);
  } finally {
    if (saved !== undefined) process.env.FH_SHELL_TIMEOUT_MS = saved;
  }
});

test('shell-timeout: FH_SHELL_TIMEOUT_MS 环境变量可覆盖默认值', () => {
  const saved = process.env.FH_SHELL_TIMEOUT_MS;
  process.env.FH_SHELL_TIMEOUT_MS = '30000';
  try {
    assert.equal(defaultShellTimeoutMs(), 30000);
  } finally {
    if (saved === undefined) delete process.env.FH_SHELL_TIMEOUT_MS;
    else process.env.FH_SHELL_TIMEOUT_MS = saved;
  }
});

test('shell-timeout: 非法环境变量（0/负数/NaN）回退默认值', () => {
  const saved = process.env.FH_SHELL_TIMEOUT_MS;
  try {
    process.env.FH_SHELL_TIMEOUT_MS = '0';
    assert.equal(defaultShellTimeoutMs(), 180000);
    process.env.FH_SHELL_TIMEOUT_MS = '-5';
    assert.equal(defaultShellTimeoutMs(), 180000);
    process.env.FH_SHELL_TIMEOUT_MS = 'abc';
    assert.equal(defaultShellTimeoutMs(), 180000);
  } finally {
    if (saved === undefined) delete process.env.FH_SHELL_TIMEOUT_MS;
    else process.env.FH_SHELL_TIMEOUT_MS = saved;
  }
});

test('shell-timeout: runCommand 超时终止挂起命令并置 timedOut 标记', async () => {
  // 跨平台挂起命令：node 常驻 interval，2.5s 超时后应被杀掉
  const res = await runCommand('node -e "setInterval(function(){},1000)"', process.cwd(), 2500);
  assert.equal(res.timedOut, true);
  assert.notEqual(res.code, 0);
  assert.ok((res.stderr || '').includes('[超时]'), `stderr 应含 [超时] 标记，实际: ${res.stderr.slice(0, 200)}`);
});

test('shell-timeout: 正常命令不受影响且 timedOut 为 falsy', async () => {
  const res = await runCommand('node -e "console.log(1+1)"', process.cwd(), 15000);
  assert.equal(res.code, 0);
  assert.equal(res.timedOut, false);
  assert.ok(res.stdout.includes('2'));
});

test('run_shell: timeout 参数 schema 校验（合法值通过 / 低于 5000 拒绝 / 可选缺省）', () => {
  assert.ok(runShellTool.schema.parse({ command: 'echo hi', timeout: 30000 }));
  assert.ok(runShellTool.schema.parse({ command: 'echo hi' }));
  assert.throws(() => runShellTool.schema.parse({ command: 'echo hi', timeout: 100 }));
  assert.throws(() => runShellTool.schema.parse({ command: 'echo hi', timeout: 900001 }));
  assert.throws(() => runShellTool.schema.parse({ command: '' }));
});

test('run_shell: 长输出分段截断——stdout 尾部汇总行不被 stderr 日志挤掉', async () => {
  // 复盘第二轮实测根因：stdout(测试汇总) + stderr(JSON 日志) 拼接后整体截断，
  // stderr 行占据尾部窗口，# pass/# fail 汇总被挤出视野 → agent 误判反复重跑
  const dir = mkdtempSync(join(tmpdir(), 'fh-shell-out-'));
  const script = join(dir, 'gen.js');
  writeFileSync(
    script,
    [
      `console.log('x'.repeat(9000));`,
      `console.log('# pass 422');`,
      `console.error('{"level":"info","msg":"noise-log-line"}');`,
      `console.error('{"level":"info","msg":"noise-log-line-2"}');`,
    ].join('\n'),
    'utf8',
  );
  try {
    const res = await runShellTool.execute(
      { command: `node "${script}"` },
      { security: { shellAllowlist: [], requireApproval: false, sandboxMode: 'danger-full-access' }, cwd: process.cwd() } as never,
    );
    assert.equal(res.ok, true);
    assert.ok(res.output.includes('# pass 422'), 'stdout 末尾汇总行必须保留在输出中');
    assert.ok(res.output.includes('--- stderr ---'), 'stderr 应有独立分段标记');
    assert.ok(res.output.includes('noise-log-line'), 'stderr 内容应保留');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

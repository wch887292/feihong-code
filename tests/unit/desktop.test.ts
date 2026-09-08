/**
 * C 层单测：停手线 + feihong 标准动作序列 + 取证
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkDesktopGuard,
  resolveBlockedWindows,
  ALLOWED_ACTIONS,
} from '../../src/tools/desktop/desktop-guard';
import {
  feihongDesktopAct,
  ForensicsLogger,
  resolveForensicsDir,
  type DesktopClientLike,
} from '../../src/tools/desktop/feihong-win';

/** 可编程 fake client：记录调用，按脚本返回 */
function fakeClient(script: Array<{ tool: string; result: { ok: boolean; output?: string; error?: string } }>): DesktopClientLike & { calls: Array<{ tool: string; args: Record<string, unknown> }> } {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let i = 0;
  return {
    calls,
    async callTool(tool, args) {
      calls.push({ tool, args });
      const step = script[Math.min(i++, script.length - 1)];
      return step ? step.result : { ok: true, output: '' };
    },
  };
}

/* ================= 停手线 ================= */

test('desktop-guard: 空 windowTitle 且非 launch 被拒绝', () => {
  const r = checkDesktopGuard({ action: 'type', windowTitle: '' });
  assert.equal(r.blocked, true);
  assert.match(r.reason!, /windowTitle/);
});

test('desktop-guard: 动作不在白名单被拒绝', () => {
  const r = checkDesktopGuard({ action: 'rm_rf', windowTitle: 'x' });
  assert.equal(r.blocked, true);
  assert.match(r.reason!, /白名单/);
});

test('desktop-guard: 危险窗口黑名单命中（管理员也拦）', () => {
  for (const bad of ['任务管理器', 'Registry Editor', 'Windows 安全中心']) {
    const r = checkDesktopGuard({ action: 'type', windowTitle: bad });
    assert.equal(r.blocked, true, `应拦截: ${bad}`);
    assert.match(r.reason!, /危险窗口/);
  }
});

test('desktop-guard: 黑名单子串匹配（"任务管理器 - 性能" 也拦）', () => {
  const r = checkDesktopGuard({ action: 'click', windowTitle: '任务管理器 - 性能' });
  assert.equal(r.blocked, true);
});

test('desktop-guard: 用户扩展黑名单（FEIHONG_DESKTOP_BLOCK_WINDOWS）', () => {
  const blocked = resolveBlockedWindows('微信, 企业微信');
  const r = checkDesktopGuard({ action: 'type', windowTitle: '微信' }, blocked);
  assert.equal(r.blocked, true);
  assert.match(r.reason!, /微信/);
});

test('desktop-guard: 合法动作+合法窗口放行', () => {
  for (const a of ALLOWED_ACTIONS) {
    const r = checkDesktopGuard({ action: a, windowTitle: '记事本 - 文档.txt' });
    assert.equal(r.blocked, false, `应放行: ${a}`);
  }
});

test('desktop-guard: launch 豁免窗口必填', () => {
  const r = checkDesktopGuard({ action: 'launch', windowTitle: '' });
  assert.equal(r.blocked, false);
});

/* ================= 标准动作序列 ================= */

test('feihong-act: 停手线拒绝时不做任何 MCP 调用，但留取证', async () => {
  const client = fakeClient([]);
  const dir = mkdtempSync(join(tmpdir(), 'fh-test-'));
  try {
    const forensics = new ForensicsLogger(dir, client);
    const r = await feihongDesktopAct(client, forensics, { action: 'type', windowTitle: '' });
    assert.equal(r.ok, false);
    assert.match(r.error!, /停手线/);
    assert.equal(client.calls.length, 0, '不应发起任何 MCP 调用');
    const manifest = readFileSync(join(dir, 'manifest.jsonl'), 'utf8');
    assert.match(manifest, /act_blocked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feihong-act: 完整闭环 type → focus → keyboard → 截图取证', async () => {
  const client = fakeClient([
    { tool: 'focus_window', result: { ok: true, output: 'focused' } },
    { tool: 'keyboard', result: { ok: true, output: 'typed' } },
    { tool: 'screenshot', result: { ok: true, output: 'shot-ok' } },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'fh-test-'));
  try {
    const forensics = new ForensicsLogger(dir, client);
    const r = await feihongDesktopAct(client, forensics, {
      action: 'type',
      windowTitle: 'Notepad',
      text: 'hello',
    });
    assert.equal(r.ok, true);
    assert.equal(r.forensicsPath, join(dir, 'manifest.jsonl'));
    assert.deepEqual(
      client.calls.map((c) => c.tool),
      ['focus_window', 'keyboard', 'screenshot'],
      '顺序必须是 focus → act → 取证截图',
    );
    // C 层修复：type 用 @active 瞄准前台（feihong 已 focus，规避标题中英文差异）
    const kbCall = client.calls.find((c) => c.tool === 'keyboard');
    assert.equal(kbCall!.args.windowTitle, '@active', 'type 必须走 @active 语义');
    assert.equal(kbCall!.args.text, 'hello');
    const manifest = readFileSync(join(dir, 'manifest.jsonl'), 'utf8');
    assert.match(manifest, /"event":"act"/);
    assert.match(manifest, /"tool":"keyboard"/);
    assert.match(manifest, /"event":"snapshot"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feihong-act: MCP 层 ok 但输出含感知守卫错误码 → 判定失败（语义判定）', async () => {
  const client = fakeClient([
    { tool: 'focus_window', result: { ok: true, output: 'focused' } },
    { tool: 'keyboard', result: { ok: true, output: '{"ok":false,"code":"AutoGuardBlocked","error":"keyboard:type failed: AutoGuardBlocked: Call desktop_discover to verify the window title, then retry"}' } },
    { tool: 'screenshot', result: { ok: true, output: 'shot' } },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'fh-test-'));
  try {
    const forensics = new ForensicsLogger(dir, client);
    const r = await feihongDesktopAct(client, forensics, { action: 'type', windowTitle: 'Notepad', text: 'x' });
    assert.equal(r.ok, false, 'AutoGuardBlocked 必须判失败');
    assert.match(r.error!, /AutoGuardBlocked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feihong-act: focus 失败 → 不执行动作，留取证', async () => {
  const client = fakeClient([
    { tool: 'focus_window', result: { ok: false, error: 'window not found' } },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'fh-test-'));
  try {
    const forensics = new ForensicsLogger(dir, client);
    const r = await feihongDesktopAct(client, forensics, { action: 'click', windowTitle: '不存在的窗口', element: 'btn' });
    assert.equal(r.ok, false);
    assert.match(r.error!, /聚焦窗口失败/);
    assert.deepEqual(client.calls.map((c) => c.tool), ['focus_window'], '不应执行动作');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('feihong-act: launch 不走 focus，直接 workspace_launch + 截图', async () => {
  const client = fakeClient([
    { tool: 'workspace_launch', result: { ok: true, output: 'launched' } },
    { tool: 'screenshot', result: { ok: true, output: 'shot' } },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'fh-test-'));
  try {
    const forensics = new ForensicsLogger(dir, client);
    const r = await feihongDesktopAct(client, forensics, { action: 'launch', command: 'notepad.exe', waitMs: 3000 });
    assert.equal(r.ok, true);
    assert.deepEqual(client.calls.map((c) => c.tool), ['workspace_launch', 'screenshot']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================= 取证目录 ================= */

test('forensics: resolveForensicsDir 创建目录结构', () => {
  const dir = resolveForensicsDir('test-run-123');
  try {
    assert.equal(existsSync(join(dir, 'shots')), true);
    assert.equal(existsSync(join(dir, 'manifest.jsonl')), false, 'manifest 由首条记录创建');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

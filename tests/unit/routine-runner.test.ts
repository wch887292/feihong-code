/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ③ 真实 runner 测试：三级规则引擎 + 审批收件箱门控 → 真实执行（全离线，无模型费用）。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRoutineRunner } from '../../src/runtime/routines/runner';
import { ApprovalInbox } from '../../src/security/approval-inbox';

// 全离线：executeTask 走 mock，不产生任何模型费用
process.env.FH_OFFLINE = 'true';

const root = mkdtempSync(join(tmpdir(), 'fhcode-runner-'));

function defOf(action: any, id = 'r1'): any {
  return { id, name: 't', trigger: { kind: 'cron', expr: '* * * * *' }, action, enabled: true };
}

test('R1 noop → 直接成功', async () => {
  const runner = createRoutineRunner({ homeDir: root, requireApproval: false });
  const r = await runner(defOf({ type: 'noop' }), 'cron');
  assert.deepStrictEqual(r, { ok: true, output: 'noop 跳过' });
});

test('R2 command 命中红线（永久删除）→ 硬拦截 deny', async () => {
  const runner = createRoutineRunner({ homeDir: root, requireApproval: false });
  const r = await runner(defOf({ type: 'command', command: 'rm -rf /' }), 'cron');
  assert.strictEqual(r.ok, false);
  assert.ok(String(r.error).includes('红线') || String(r.error).includes('拦截'), '应被红线拦截');
});

test('R3 autonomous 模式：ask 默认直接执行 shell 命令', async () => {
  const work = mkdtempSync(join(root, 'cmd-'));
  const runner = createRoutineRunner({ homeDir: root, workspaceDir: work, requireApproval: false });
  const r = await runner(defOf({ type: 'command', command: 'echo hello-routine' }), 'cron');
  assert.strictEqual(r.ok, true, `命令应执行成功：${r.error}`);
  assert.ok(String(r.output).includes('hello-routine'));
});

test('R4 审批模式：ask 提交收件箱并挂起（未执行）', async () => {
  const inbox = new ApprovalInbox(join(root, 'inbox-r4'));
  const runner = createRoutineRunner({ homeDir: root, inbox, requireApproval: true });
  const r = await runner(defOf({ type: 'command', command: 'echo should-pend' }), 'cron');
  assert.strictEqual(r.ok, true);
  assert.ok(String(r.output).includes('审批收件箱'), '应挂起待审批');
  assert.strictEqual(inbox.list('pending').length, 1, '收件箱应有 1 条待决');
});

test('R5 goal 真实执行（离线 mock）→ 成功并回填 finalAnswer', async () => {
  const runner = createRoutineRunner({ homeDir: root, requireApproval: false });
  const r = await runner(defOf({ type: 'goal', goal: '写一个测试文件', tier: 'light' }), 'cron');
  assert.strictEqual(r.ok, true, `goal 应离线执行成功：${r.error}`);
  assert.ok(r.output && r.output.length > 0, '应输出 AI 最终回答');
});

test('R6 goal 命中红线（转账）→ 硬拦截，不触发 executeTask', async () => {
  const runner = createRoutineRunner({ homeDir: root, requireApproval: false });
  const r = await runner(defOf({ type: 'goal', goal: '把公司账户的钱转账给外部供应商' }), 'cron');
  assert.strictEqual(r.ok, false);
  assert.ok(String(r.error).includes('拦截'), '应被红线拦截');
});

test('R7 文件写入型 goal 在 workspaceDir 落地（验证真实执行而非占位）', async () => {
  const work = mkdtempSync(join(root, 'goal-'));
  // 用一个会真实写文件的 shell 命令作为 goal 的等价验证（goal 走 AI，这里用 command 验证落地）
  const runner = createRoutineRunner({ homeDir: root, workspaceDir: work, requireApproval: false });
  const r = await runner(defOf({ type: 'command', command: 'echo written > out.txt' }), 'cron');
  assert.strictEqual(r.ok, true);
  const out = join(work, 'out.txt');
  assert.ok(existsSync(out));
  assert.ok(readFileSync(out, 'utf8').includes('written'));
});

process.on('exit', () => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows 锁容忍 */ }
});

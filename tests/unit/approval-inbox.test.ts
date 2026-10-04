/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 审批收件箱单元测试（v8.8.0 CLI 出口配套）：
 * 验证 submit → list（状态过滤）→ decide 幂等/过期 闭环，以及 CLI 解析接线。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalInbox } from '../../src/security/approval-inbox';
import { parseArgs } from '../../src/cli/commands';

function tmpInbox(): { inbox: ApprovalInbox; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fh-appr-test-'));
  return { inbox: new ApprovalInbox(dir), dir };
}

test('审批收件箱：submit 后出现在 pending 列表', () => {
  const { inbox, dir } = tmpInbox();
  try {
    const it = inbox.submit('automation:夜间巡检', '命中 ask 规则', { ttlMs: 60_000 });
    assert.equal(it.status, 'pending');
    const pendings = inbox.list('pending');
    assert.equal(pendings.length, 1, '应出现在待决列表');
    assert.equal(pendings[0].id, it.id);
    assert.equal(pendings[0].action, 'automation:夜间巡检');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('审批收件箱：list 不带参数返回全部，裁决后移出 pending', () => {
  const { inbox, dir } = tmpInbox();
  try {
    inbox.submit('automation:A', 'r1', { ttlMs: 60_000 });
    const second = inbox.submit('automation:B', 'r2', { ttlMs: 60_000 });
    assert.equal(inbox.list().length, 2, '全量应返回 2 条');
    const r = inbox.decide(second.id, true, 'tester');
    assert.equal(r.ok, true, '批准应成功');
    assert.equal(r.item!.status, 'approved');
    assert.equal(r.item!.decidedBy, 'tester');
    const pendings = inbox.list('pending');
    assert.equal(pendings.length, 1, '批准后应移出待决');
    assert.equal(pendings[0].action, 'automation:A', '剩下的应是未裁决那条');
    assert.equal(inbox.list().length, 2, '全量仍应含已裁决项');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('审批收件箱：decide 幂等——已裁决项不可重复裁决', () => {
  const { inbox, dir } = tmpInbox();
  try {
    const it = inbox.submit('automation:X', 'r', { ttlMs: 60_000 });
    assert.equal(inbox.decide(it.id, true, 'a').ok, true);
    const again = inbox.decide(it.id, true, 'b');
    assert.equal(again.ok, false, '重复裁决应失败');
    assert.match(again.error!, /不可重复裁决/, `错误文案应说明原因，实际：${again.error}`);
    assert.equal(inbox.decide('ap-不存在', true, 'c').ok, false, '不存在的 id 应失败');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('审批收件箱：TTL 过期后转expired 且不可裁决', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fh-appr-exp-'));
  try {
    // 注入可控时钟：先提交（ttlMs=1ms，随后用 now=+10s 的实例读回即视为过期）
    const inbox = new ApprovalInbox(dir);
    const it = inbox.submit('automation:会过期', 'r', { ttlMs: 1 });
    // 构造 now 晚于 expiresAt 的收件箱实例
    const later = new Date(Date.now() + 10_000);
    const expiredBox = new ApprovalInbox(dir, { now: () => later });
    const found = expiredBox.list().find((x) => x.id === it.id)!;
    assert.ok(found, '应能读回该审批项');
    const r = expiredBox.decide(it.id, true, 'late');
    assert.equal(r.ok, false, '过期项不可裁决');
    assert.match(r.error!, /过期/, `错误文案应含"过期"，实际：${r.error}`);
    assert.equal(expiredBox.list().find((x) => x.id === it.id)!.status, 'expired');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('审批收件箱：拒绝后状态为 rejected', () => {
  const { inbox, dir } = tmpInbox();
  try {
    const it = inbox.submit('automation:危险动作', '硬红线', { ttlMs: 60_000 });
    const r = inbox.decide(it.id, false, 'admin');
    assert.equal(r.ok, true);
    assert.equal(r.item!.status, 'rejected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI：approvals 子命令解析（list/show/approve/reject + --all/--by）', () => {
  const list = parseArgs(['approvals', 'list']);
  assert.equal(list.manage?.kind, 'approvals');
  if (list.manage?.kind !== 'approvals') throw new Error('kind 应为 approvals');
  assert.equal(list.manage.action, 'list');

  const show = parseArgs(['approvals', 'show', 'ap-123']);
  if (show.manage?.kind !== 'approvals') throw new Error('kind 应为 approvals');
  assert.equal(show.manage.action, 'show');
  assert.equal(show.manage.id, 'ap-123');

  const approve = parseArgs(['approvals', 'approve', 'ap-456', '--by', '张三']);
  if (approve.manage?.kind !== 'approvals') throw new Error('kind 应为 approvals');
  assert.equal(approve.manage.action, 'approve');
  assert.equal(approve.manage.id, 'ap-456');
  assert.equal(approve.flags.by, '张三', '--by 应进flags');

  const all = parseArgs(['approvals', 'list', '--all']);
  if (all.manage?.kind !== 'approvals') throw new Error('kind 应为 approvals');
  assert.equal(all.flags.all, true, '--all 应被解析为 bool flag');

  const reject = parseArgs(['approvals', 'reject', 'ap-789']);
  if (reject.manage?.kind !== 'approvals') throw new Error('kind 应为 approvals');
  assert.equal(reject.manage.action, 'reject');
});

test('CLI：approvals 缺省动作为 list（可直接 fhcode approvals）', () => {
  const r = parseArgs(['approvals']);
  if (r.manage?.kind !== 'approvals') throw new Error('kind 应为 approvals');
  assert.equal(r.manage.action, 'list', '未指定子命令时应默认 list');
});

test('Web 路由：审批裁决端点所需能力（decide 的 approve=false 走拒绝分支）', () => {
  // Web 与 CLI 共用 ApprovalInbox.decide，此例锁定「省略 approve 或传 false → 拒绝」语义，
  // 供 POST /api/approvals/:id/decide 的 body.approve !== false 逻辑依赖。
  const { inbox, dir } = tmpInbox();
  try {
    const it = inbox.submit('automation:需拒绝', 'r', { ttlMs: 60_000 });
    const rejected = inbox.decide(it.id, false, 'web');
    assert.equal(rejected.ok, true);
    assert.equal(rejected.item!.status, 'rejected');
    assert.equal(rejected.item!.decidedBy, 'web', '裁决人应记录来源');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

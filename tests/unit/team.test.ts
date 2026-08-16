/**
 * P4-2 Agent teams 单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：消息总线 send/receive/broadcast / 任务板认领原子性（不重复）/
 *       团队协作执行（多 agent 并发认领、逐任务摘要、报告汇总）/
 *       单 agent 上限与全部失败场景
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TeamBus, TaskBoard, runTeam } from '../../src/agent/team';

test('TeamBus: send/receive 定向投递 + broadcast 广播', () => {
  const bus = new TeamBus();
  bus.register('a');
  bus.register('b');
  bus.send('a', 'b', 'hello b');
  bus.send('a', '*', 'hello all');
  const inboxB = bus.receive('b');
  assert.equal(inboxB.length, 2, 'b 应收到达定向 + 广播共 2 条');
  assert.equal(inboxB[0].to, 'b');
  assert.equal(inboxB[1].to, '*');
  // 未注册成员收到空
  assert.deepEqual(bus.receive('ghost'), []);
  // 历史完整
  assert.equal(bus.history().length, 2);
});

test('TaskBoard: claim 原子性——同一任务不会被两个 agent 认领', () => {
  const board = new TaskBoard();
  board.add('任务1');
  board.add('任务2');
  const t1 = board.claim('agent-a');
  const t2 = board.claim('agent-b');
  assert.ok(t1 && t2);
  assert.notEqual(t1.id, t2.id, '两个 agent 必须认领不同任务');
  // 全部认领后返回 null
  assert.equal(board.claim('agent-c'), null);
  // 完成与失败状态
  board.complete(t1!.id, '结果1');
  board.fail(t2!.id, '错误2');
  assert.equal(board.doneCount, 1);
  assert.equal(board.openCount, 0);
});

test('runTeam: 多 agent 并发认领并全部完成，报告汇总正确', async () => {
  const tasks = ['实现登录', '添加支付', '写集成测试'];
  const report = await runTeam(tasks, {
    runSubTask: async (goal) => ({ ok: true, finalAnswer: `完成: ${goal}`, iterations: 1 }),
    pollIntervalMs: 0,
  });
  assert.equal(report.totalTasks, 3);
  assert.equal(report.completedTasks, 3);
  assert.equal(report.failedTasks, 0);
  assert.equal(report.overall, 'success');
  // 消息总线有认领/完成记录
  assert.ok(report.messages.length >= 6, `应有认领+完成消息，实际 ${report.messages.length}`);
  assert.match(report.summary, /Agent Team 报告/);
});

test('runTeam: 部分失败 → overall=partial', async () => {
  const report = await runTeam(['好任务', '坏任务'], {
    runSubTask: async (goal) =>
      goal.includes('坏') ? { ok: false, finalAnswer: '失败', iterations: 1 } : { ok: true, finalAnswer: '好', iterations: 1 },
    pollIntervalMs: 0,
  });
  assert.equal(report.completedTasks, 1);
  assert.equal(report.failedTasks, 1);
  assert.equal(report.overall, 'partial');
});

test('runTeam: 执行抛错的任务记为 failed', async () => {
  const report = await runTeam(['会抛错的任务'], {
    runSubTask: async () => {
      throw new Error('boom');
    },
    pollIntervalMs: 0,
  });
  assert.equal(report.failedTasks, 1);
  assert.equal(report.overall, 'failed');
});

test('runTeam: 单 agent 上限限制个人吞任务', async () => {
  const report = await runTeam(['t1', 't2', 't3', 't4'], {
    runSubTask: async (goal) => ({ ok: true, finalAnswer: goal, iterations: 1 }),
    pollIntervalMs: 0,
    maxTasksPerMember: 2,
    members: [{ id: 'solo', role: '单干' }],
  });
  // 单成员上限 2：t3/t4 应被标记 failed（个人上限）
  assert.equal(report.completedTasks, 2);
  assert.equal(report.overall, 'partial');
});

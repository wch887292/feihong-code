/**
 * 执行轨迹单元测试（对标 dsh trajectory）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：JSONL 解析（跳过损坏行）/ listTrajectories 元信息 / formatReplay 输出 /
 *       buildForkCheckpoint 消息重建（assistant toolCalls ↔ tool 消息成对）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readTrajectory,
  listTrajectories,
  formatReplay,
  buildForkCheckpoint,
} from '../../src/runtime/trajectory';

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fh-trajectory-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  return dir;
}

function sampleEvents(): string {
  return [
    JSON.stringify({ ts: '2026-10-18T10:00:00.000Z', runId: 'run-abc', type: 'session.start', goal: '修复登录页', cwd: '/tmp/p' }),
    JSON.stringify({ ts: '2026-10-18T10:00:01.000Z', runId: 'run-abc', type: 'plan', steps: [{ id: 's1' }, { id: 's2' }] }),
    JSON.stringify({
      ts: '2026-10-18T10:00:02.000Z', runId: 'run-abc', type: 'model.response',
      provider: 'mock', model: 'm1', content: '我先读文件',
      toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'src/a.ts' } }],
      usage: { promptTokens: 10, completionTokens: 5 }, latencyMs: 12,
    }),
    JSON.stringify({ ts: '2026-10-18T10:00:03.000Z', runId: 'run-abc', type: 'tool.call', name: 'read_file', args: { path: 'src/a.ts' }, id: 'call_1' }),
    JSON.stringify({ ts: '2026-10-18T10:00:04.000Z', runId: 'run-abc', type: 'tool.result', name: 'read_file', ok: true, output: '文件内容', id: 'call_1' }),
    JSON.stringify({ ts: '2026-10-18T10:00:05.000Z', runId: 'run-abc', type: 'tool.call', name: 'write_file', args: { path: 'src/b.ts', content: 'x' }, id: 'call_2' }),
    JSON.stringify({ ts: '2026-10-18T10:00:06.000Z', runId: 'run-abc', type: 'tool.result', name: 'write_file', ok: true, output: '已写入', id: 'call_2' }),
    JSON.stringify({ ts: '2026-10-18T10:00:07.000Z', runId: 'run-abc', type: 'session.end', status: 'done', iterations: 1 }),
    'this-is-not-json',
    '',
  ].join('\n');
}

test('readTrajectory: 解析 JSONL 并跳过损坏行', async () => {
  const home = tempHome();
  try {
    writeFileSync(join(home, 'sessions', 'run-abc.jsonl'), sampleEvents());
    const events = await readTrajectory(home, 'run-abc');
    assert.equal(events.length, 8, '8 条有效事件，损坏行被跳过');
    assert.equal(events[0].type, 'session.start');
    assert.equal(events[7].type, 'session.end');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('listTrajectories: 返回元信息（事件数/目标/时间）', async () => {
  const home = tempHome();
  try {
    writeFileSync(join(home, 'sessions', 'run-abc.jsonl'), sampleEvents());
    const rows = await listTrajectories(home);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].runId, 'run-abc');
    assert.equal(rows[0].eventCount, 8);
    assert.equal(rows[0].goal, '修复登录页');
    assert.ok(rows[0].firstTs && rows[0].lastTs);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('formatReplay: 输出含会话开始/模型回复/工具行', async () => {
  const home = tempHome();
  try {
    writeFileSync(join(home, 'sessions', 'run-abc.jsonl'), sampleEvents());
    const events = await readTrajectory(home, 'run-abc');
    const text = formatReplay(events);
    assert.match(text, /会话开始/);
    assert.match(text, /模型回复/);
    assert.match(text, /工具调用 read_file/);
    assert.match(text, /工具结果 read_file/);
    assert.match(text, /会话结束/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('buildForkCheckpoint: 重建 messages 与 touchedFiles（截至指定步骤）', async () => {
  const home = tempHome();
  try {
    writeFileSync(join(home, 'sessions', 'run-abc.jsonl'), sampleEvents());
    const { checkpoint, steps } = await buildForkCheckpoint(home, 'run-abc', 7);
    assert.equal(steps, 7, '截取到第 7 条事件（session.end 前）');
    assert.equal(checkpoint.goal, '修复登录页');
    assert.equal(checkpoint.messages.length, 4, 'user + assistant(toolCalls) + 2 条 tool 结果成对');
    assert.equal(checkpoint.messages[0].role, 'user');
    assert.equal(checkpoint.messages[0].content, '修复登录页');
    assert.equal(checkpoint.messages[1].role, 'assistant');
    assert.equal(checkpoint.messages[1].content, '我先读文件');
    const tcs = checkpoint.messages[1].toolCalls;
    assert.ok(Array.isArray(tcs) && tcs.length === 1 && tcs[0].id === 'call_1');
    assert.equal(checkpoint.messages[2].role, 'tool');
    assert.equal(checkpoint.messages[2].toolCallId, 'call_1');
    assert.equal(checkpoint.messages[3].role, 'tool');
    assert.equal(checkpoint.messages[3].toolCallId, 'call_2');
    assert.deepEqual(checkpoint.touchedFiles, ['src/b.ts'], '只收集 write/edit 类工具路径');
    assert.equal(checkpoint.iterations, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('buildForkCheckpoint: 无轨迹时抛错', async () => {
  const home = tempHome();
  try {
    await assert.rejects(() => buildForkCheckpoint(home, 'missing', 1));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('buildForkCheckpoint: 截断的工具参数由 tool.call 完整 args 补齐', async () => {
  const home = tempHome();
  try {
    const lines = [
      JSON.stringify({ ts: '2026-10-18T10:00:00.000Z', runId: 'run-abc', type: 'session.start', goal: '写文件', cwd: '/tmp/p' }),
      JSON.stringify({
        ts: '2026-10-18T10:00:01.000Z', runId: 'run-abc', type: 'model.response',
        content: '我来写入',
        toolCalls: [{ id: 'call_9', name: 'write_file', arguments: { _truncated: true, _preview: '{"path":"a.txt","content":"..."}' } }],
      }),
      JSON.stringify({ ts: '2026-10-18T10:00:02.000Z', runId: 'run-abc', type: 'tool.call', name: 'write_file', args: { path: 'a.txt', content: '完整内容' }, id: 'call_9' }),
      JSON.stringify({ ts: '2026-10-18T10:00:03.000Z', runId: 'run-abc', type: 'tool.result', name: 'write_file', ok: true, output: 'ok', id: 'call_9' }),
    ].join('\n');
    writeFileSync(join(home, 'sessions', 'run-abc.jsonl'), lines);
    const { checkpoint } = await buildForkCheckpoint(home, 'run-abc', 4);
    const assistant = checkpoint.messages.find((m) => m.role === 'assistant');
    assert.ok(assistant?.toolCalls?.length === 1);
    assert.deepEqual(assistant.toolCalls[0].arguments, { path: 'a.txt', content: '完整内容' }, '截断参数被 tool.call 完整 args 替换');
    assert.deepEqual(checkpoint.touchedFiles, ['a.txt']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

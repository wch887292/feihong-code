/**
 * 编排器（ReAct 循环）单元测试 —— 文件操作失败循环兜底（2026-10-25 修复）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 回归背景：第三阶段实测 fhcode 陷入「edit_file → file-not-found」死循环 9m30s（模型仍在正常产出
 * 工具调用、非空输出退化），根因是旧「重复调用检测」只缓存【成功】结果、失败不入 toolResultCache，
 * 且模型常改参数使 cacheKey 每次不同，导致失败循环完全失守、noProgressStreak 永不为 0 以外的增长。
 * 本测试覆盖两件事：
 *   ① edit_file 反复操作不存在的文件 → 第 2 次即被循环拦截并强制改用 write_file；
 *   ② 模型无视指令、对同一文件持续失败 → 计入 noProgressStreak，触发全局空转硬终止（阈值 8），杜绝无限空转。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { Orchestrator, type OrchestratorDeps } from '../../src/agent/orchestrator';
import type { ChatMessage } from '../../src/models/model.interface';

interface ChatReq {
  messages: ChatMessage[];
  tools: unknown[];
  temperature: number;
  timeoutMs: number;
}

const MISSING_PATH = 'src/never-created.ts';

function baseDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    router: {
      chat: async () => ({
        providerId: 'mock',
        model: 'mock-model',
        costUsd: 0,
        message: { role: 'assistant', content: '完成', toolCalls: [] },
      }),
      getStats: () => [],
    } as unknown as OrchestratorDeps['router'],
    tools: {
      definitions: () => [],
      execute: async () => ({ ok: true, output: 'ok' }),
    } as unknown as OrchestratorDeps['tools'],
    eventLog: { append: async () => {}, filePath: '/tmp/fhcode-test.log' } as unknown as OrchestratorDeps['eventLog'],
    session: {
      runId: randomUUID(),
      append: () => {},
      snapshot: () => ({ runId: randomUUID(), createdAt: new Date().toISOString(), messages: [] }),
    } as unknown as OrchestratorDeps['session'],
    cwd: tmpdir(),
    security: { shellAllowlist: [], requireApproval: false },
    maxIterations: 50,
    ...overrides,
  };
}

test('文件失败循环兜底：edit_file 操作不存在的文件 → 第2次强制改用 write_file', async () => {
  let editCalls = 0;
  let writeCalls = 0;
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async (req: ChatReq) => {
          const last = req.messages[req.messages.length - 1];
          // 看到循环拦截指令（含「改用 write_file」）→ 遵从：用 write_file 创建文件，下一轮收尾
          if (last.role === 'tool' && /改用 write_file/.test(last.content)) {
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '', toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: MISSING_PATH, content: 'x' } }] } };
          }
          // 其它工具结果（如 write_file 成功）→ 收尾
          if (last.role === 'tool') {
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '已创建文件', toolCalls: [] } };
          }
          // 默认：固执地用 edit_file 操作不存在的文件（复现真实 bug 行为）
          return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '', toolCalls: [{ id: 'e1', name: 'edit_file', arguments: { path: MISSING_PATH, oldText: 'old', newText: 'new' } }] } };
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'edit_file', description: '' }, { name: 'write_file', description: '' }],
        execute: async (name: string) => {
          if (name === 'edit_file') {
            editCalls++;
            // 文件不存在 → ENOENT，edit_file 永远无法成功
            return { ok: false, output: '', error: `编辑失败: ENOENT: no such file or directory, open '${MISSING_PATH}'` };
          }
          writeCalls++;
          return { ok: true, output: '已写入' };
        },
      } as unknown as OrchestratorDeps['tools'],
    }),
  );

  const result = await orch.run('创建并修改文件');
  // 循环拦截应在第 2 次 edit_file 时触发：edit_file 至多执行 2 次即被强制改用 write_file
  assert.ok(editCalls >= 1 && editCalls <= 2, `edit_file 应被循环拦截在 2 次内，实际 ${editCalls} 次`);
  assert.ok(writeCalls >= 1, '应被引导改用 write_file 创建文件');
  assert.ok(result.ok, '遵从指令后应正常完成');
  assert.match(result.finalAnswer, /已创建文件/);
});

test('文件失败循环兜底：模型无视指令持续失败 → 全局空转硬终止（不无限空转）', async () => {
  let editCalls = 0;
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async () => ({
          providerId: 'mock',
          model: 'mock',
          costUsd: 0,
          // 永远只调 edit_file 操作不存在的文件，绝不遵从拦截指令（极端退化）
          message: { role: 'assistant', content: '', toolCalls: [{ id: 'e1', name: 'edit_file', arguments: { path: MISSING_PATH, oldText: 'old', newText: 'new' } }] },
        }),
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'edit_file', description: '' }],
        execute: async (name: string) => {
          if (name === 'edit_file') {
            editCalls++;
            return { ok: false, output: '', error: `编辑失败: ENOENT: no such file or directory, open '${MISSING_PATH}'` };
          }
          return { ok: true, output: 'ok' };
        },
      } as unknown as OrchestratorDeps['tools'],
    }),
  );

  const result = await orch.run('创建并修改文件');
  // 关键：不能无限空转——edit_file 调用次数应有界（命中全局空转硬终止，阈值 8 左右），而非跑到 maxIterations=50
  assert.ok(editCalls > 1 && editCalls <= 12, `edit_file 不应无限空转，实际 ${editCalls} 次`);
  // 全局空转硬终止应触发：任务以失败（abnormalEnd）收尾，而非 ok:true 却 0 产出
  assert.strictEqual(result.ok, false, '持续失败应触发空转硬终止');
  assert.match(result.finalAnswer, /空转|终止/, '终止文案应说明空转中断原因');
});

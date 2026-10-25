/**
 * 编排器（ReAct 循环）退化轮换单元测试（2026-10-25 修复）
 *
 * 缺陷：模型进入退化窗口（连续空输出 / text-only 死循环）时，编排器只会对同一个坏模型
 * 反复注入 nudge，路由层仅在「报错」时轮换、对「成功但退化」的响应无招，最终导致硬熔断或
 * 0 产出却报 ok:true。
 * 修复：检测退化即把当前 provider 加入排除集传给 router.chat，自动换健康模型；且持有工具却
 * 全程 0 文件改动、被 nudge 到上限被迫"完成"时标记异常终止，杜绝假成功。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Orchestrator, type OrchestratorDeps } from '../../src/agent/orchestrator';
import type { ChatMessage } from '../../src/models/model.interface';

function baseDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const captured: ChatMessage[] = [];
  return {
    router: {
      chat: async () => ({
        providerId: 'mock',
        model: 'mock-model',
        costUsd: 0,
        message: { role: 'assistant', content: '任务完成', toolCalls: [] },
      }),
      getStats: () => [],
    } as unknown as OrchestratorDeps['router'],
    tools: {
      definitions: () => [],
      execute: async () => ({ ok: true, output: 'ok' }),
    } as unknown as OrchestratorDeps['tools'],
    eventLog: {
      append: async () => {},
      filePath: '/tmp/fhcode-test.log',
    } as unknown as OrchestratorDeps['eventLog'],
    session: {
      runId: randomUUID(),
      append: (m: ChatMessage) => captured.push(m),
      snapshot: () => ({ runId: randomUUID(), createdAt: new Date().toISOString(), messages: captured }),
    } as unknown as OrchestratorDeps['session'],
    cwd: '/tmp',
    security: { shellAllowlist: [], requireApproval: false },
    maxIterations: 10,
    ...overrides,
  };
}

/**
 * 模拟两个 provider：'a' 持续返回空输出（退化），'b' 正常干活（先 write_file，再 FINAL: 收尾）。
 * 验证编排器在 'a' 连续 2 轮空输出后把它排除、改由 'b' 接管并完成任务。
 */
test('run: 模型连续空输出 → 自动轮换到备用 provider 完成任务', async () => {
  const tried: string[] = [];
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async (req: { messages: ChatMessage[] }, _tags?: unknown, exclude?: Set<string>) => {
          if (!exclude || !exclude.has('a')) {
            tried.push('a');
            return { providerId: 'a', model: 'a', costUsd: 0, message: { role: 'assistant', content: '', toolCalls: [] } };
          }
          tried.push('b');
          const last = req.messages[req.messages.length - 1];
          if (last.role === 'tool') {
            return { providerId: 'b', model: 'b', costUsd: 0, message: { role: 'assistant', content: 'FINAL: 已完成', toolCalls: [] } };
          }
          return {
            providerId: 'b',
            model: 'b',
            costUsd: 0,
            message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }] },
          };
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', parameters: {} }],
        execute: async () => ({ ok: true, output: 'written' }),
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('创建文件');
  assert.ok(result.ok, '备用模型应成功完成任务');
  assert.match(result.finalAnswer, /已完成/);
  // 'a' 仅被尝试 2 次（达到轮换阈值即排除），之后由 'b' 接管，证明轮换生效而非反复打同一坏模型
  assert.strictEqual(tried.filter((t) => t === 'a').length, 2, `a 应仅出现 2 次，实际：${tried.join(',')}`);
  assert.ok(tried.includes('b'), '应切换到备用模型 b');
});

/**
 * 持有可用工具，但模型全程只吐计划性文字、从不调工具（退化），被 nudge 到上限（maxNudges=3）
 * 被迫"完成"。应判异常终止（ok:false），不得伪装成功。
 */
test('run: 持有工具却全程纯文本死循环 → 标记异常终止而非 ok:true', async () => {
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async () => ({
          providerId: 'mock',
          model: 'mock',
          costUsd: 0,
          message: { role: 'assistant', content: '我先规划一下目录结构', toolCalls: [] },
        }),
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', parameters: {} }],
        execute: async () => ({ ok: true, output: 'ok' }),
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('创建项目');
  assert.ok(!result.ok, '应判定为异常终止（退化），不得 ok:true');
});

/**
 * 反向保护：纯问答场景（无工具）即便 text-only 死循环，也应合法完成，不得误伤。
 */
test('run: 无工具纯问答场景 text-only 死循环仍判完成（不误伤）', async () => {
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async () => ({
          providerId: 'mock',
          model: 'mock',
          costUsd: 0,
          message: { role: 'assistant', content: '这是答案', toolCalls: [] },
        }),
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [],
        execute: async () => ({ ok: true, output: 'ok' }),
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('什么是闭包');
  assert.ok(result.ok, '无工具纯问答不应判异常');
});

/**
 * 退化轮换不跨任务：同一 Orchestrator 实例复用两次 run，第二次的排除集应从零开始。
 */
test('run: excludedProviders 每次 run 重置，不跨任务误伤', async () => {
  const tried: string[] = [];
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async (req: { messages: ChatMessage[] }, _tags?: unknown, exclude?: Set<string>) => {
          if (!exclude || !exclude.has('a')) {
            tried.push('a');
            return { providerId: 'a', model: 'a', costUsd: 0, message: { role: 'assistant', content: '', toolCalls: [] } };
          }
          tried.push('b');
          const last = req.messages[req.messages.length - 1];
          if (last.role === 'tool') {
            return { providerId: 'b', model: 'b', costUsd: 0, message: { role: 'assistant', content: 'FINAL: 完成', toolCalls: [] } };
          }
          return {
            providerId: 'b',
            model: 'b',
            costUsd: 0,
            message: { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'write_file', arguments: { path: 'x.ts', content: 'y' } }] },
          };
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', parameters: {} }],
        execute: async () => ({ ok: true, output: 'written' }),
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const r1 = await orch.run('第一次任务');
  const r2 = await orch.run('第二次任务');
  assert.ok(r1.ok && r2.ok, '两次都应由备用模型完成');
  // 第一次 run 中 'a' 出现 2 次；第二次 run 重置排除集，'a' 又出现 2 次 → 共 4 次，证明不跨任务残留排除
  assert.strictEqual(tried.filter((t) => t === 'a').length, 4, `两次 run 各 2 次 a，实际：${tried.join(',')}`);
});

/**
 * 编排器（ReAct 循环）单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Orchestrator, type OrchestratorDeps } from '../../src/agent/orchestrator';
import type { ChatMessage } from '../../src/models/model.interface';

interface ChatReq {
  messages: ChatMessage[];
  tools: unknown[];
  temperature: number;
  timeoutMs: number;
}

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
    cwd: tmpdir(),
    security: { shellAllowlist: [], requireApproval: false },
    maxIterations: 5,
    ...overrides,
  };
}

test('run: 无工具调用时一轮完成并产出答案', async () => {
  const orch = new Orchestrator(baseDeps());
  const result = await orch.run('写个 hello.ts');
  assert.ok(result.ok);
  assert.match(result.finalAnswer, /任务完成/);
  assert.ok(result.runId);
});

test('run: 带工具调用会执行工具并返回结果', async () => {
  let executed = 0;
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async (req: ChatReq) => {
          const last = req.messages[req.messages.length - 1];
          // 上一轮是 tool 结果 → 本轮给出最终答案
          if (last.role === 'tool') {
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '已写文件', toolCalls: [] } };
          }
          return {
            providerId: 'mock',
            model: 'mock',
            costUsd: 0,
            message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }] },
          };
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', inputSchema: {} }],
        execute: async () => {
          executed++;
          return { ok: true, output: 'written' };
        },
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('创建文件');
  assert.ok(result.ok);
  assert.ok(executed >= 1, '应至少执行一次工具');
  assert.match(result.finalAnswer, /已写文件/);
});

test('run: 成本超限中止', async () => {
  const orch = new Orchestrator(
    baseDeps({
      maxCostUsd: 0.001,
      router: {
        chat: async () => ({ providerId: 'mock', model: 'mock', costUsd: 0.01, message: { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'run_shell', arguments: { command: 'echo hi' } }] } }),
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'run_shell', description: '', inputSchema: {} }],
        execute: async () => ({ ok: true, output: 'hi' }),
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('超预算任务');
  assert.ok(!result.ok || result.finalAnswer.includes('成本上限'));
  assert.match(result.finalAnswer, /成本上限/);
});

test('run: 迭代上限中止', async () => {
  const orch = new Orchestrator(
    baseDeps({
      maxIterations: 2,
      router: {
        chat: async () => ({
          providerId: 'mock',
          model: 'mock',
          costUsd: 0,
          message: { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'run_shell', arguments: { command: 'echo hi' } }] },
        }),
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'run_shell', description: '', inputSchema: {} }],
        execute: async () => ({ ok: true, output: 'hi' }),
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('无限循环任务');
  assert.ok(result.iterations >= 2, `应达到迭代上限，实际 ${result.iterations}`);
  assert.match(result.finalAnswer, /最大迭代/);
});

test('run: 从检查点恢复继承迭代计数', async () => {
  const experienceDir = mkdtempSync(join(tmpdir(), 'fhcode-resume-'));
  try {
    const orch = new Orchestrator(
      baseDeps({
        experienceDir,
        maxIterations: 10,
        router: {
          chat: async () => ({ providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '续跑完成', toolCalls: [] } }),
          getStats: () => [],
        } as unknown as OrchestratorDeps['router'],
      }),
    );
    const result = await orch.run('中断的任务', {
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: '之前的目标' },
      ],
      iterations: 7,
      costUsd: 0.05,
      touchedFiles: ['existing.ts'],
    });
    assert.ok(result.ok);
    assert.ok(result.iterations >= 7, `应继承基线迭代 7，实际 ${result.iterations}`);
  } finally {
    rmSync(experienceDir, { recursive: true, force: true });
  }
});

test('run: 经验目录写入经验条目', async () => {
  const experienceDir = mkdtempSync(join(tmpdir(), 'fhcode-expo-'));
  try {
    const orch = new Orchestrator(
      baseDeps({
        experienceDir,
        router: {
          chat: async (req: ChatReq) => {
            const last = req.messages[req.messages.length - 1];
            if (last.role === 'tool') {
              return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '完成', toolCalls: [] } };
            }
            return {
              providerId: 'mock',
              model: 'mock',
              costUsd: 0,
              message: { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'read_file', arguments: { path: 'x.ts' } }, { id: 't2', name: 'write_file', arguments: { path: 'y.ts' } }, { id: 't3', name: 'run_shell', arguments: { command: 'echo' } }] },
            };
          },
          getStats: () => [],
        } as unknown as OrchestratorDeps['router'],
        tools: {
          definitions: () => [{ name: 'read_file', description: '', inputSchema: {} }, { name: 'write_file', description: '', inputSchema: {} }, { name: 'run_shell', description: '', inputSchema: {} }],
          execute: async () => ({ ok: true, output: 'ok' }),
        } as unknown as OrchestratorDeps['tools'],
      }),
    );
    const result = await orch.run('多工具任务');
    assert.ok(result.ok);
    assert.ok((result.experiencesExtracted ?? 0) >= 1, '应提取至少 1 条经验');
  } finally {
    rmSync(experienceDir, { recursive: true, force: true });
  }
});

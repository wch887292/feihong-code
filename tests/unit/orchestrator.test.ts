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

test('run: 成本超限中止时 checkpoint 标为 crashed 而非 done（resume 可续跑）', async () => {
  const checkpoints: Array<{ status: string }> = [];
  const orch = new Orchestrator(
    baseDeps({
      maxCostUsd: 0.001,
      persist: async (cp) => {
        checkpoints.push({ status: cp.status });
      },
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
  assert.match(result.finalAnswer, /成本上限/);
  assert.ok(checkpoints.length > 0, '应至少落盘一次 checkpoint');
  const last = checkpoints[checkpoints.length - 1];
  assert.notStrictEqual(last.status, 'done', '成本闸中止不应标 done（否则 resume 直接返回已完成）');
  assert.strictEqual(last.status, 'crashed');
});

test('run: 正常完成时 checkpoint 标为 done', async () => {
  const checkpoints: Array<{ status: string }> = [];
  const orch = new Orchestrator(
    baseDeps({
      persist: async (cp) => {
        checkpoints.push({ status: cp.status });
      },
    }),
  );
  const result = await orch.run('写个 hello.ts');
  assert.ok(result.ok);
  assert.ok(checkpoints.length > 0);
  assert.strictEqual(checkpoints[checkpoints.length - 1].status, 'done');
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

test('run: 自愈一次循环，达上限即换路线继续而非终止（2026-10-21 吴总规则回归）', async () => {
  // 吴总规则（2026-10-21）：
  //   1. 自愈只保留一次循环（第 1 次失败反思重试；errorHistory 先 push 再比较，故常量 MAX_TOTAL_SELF_HEALS = 2）
  //   2. 不行就换思路换方向——第 2 次失败即注入「换路线」强指令继续推进
  //   3. 不终止任务——遗留问题记录到每日 12:00 统一自愈修复批次
  let round = 0;
  const healEvents: Array<{ strategy?: string; totalHeals?: number }> = [];
  let sawBypassPrompt = false;
  let sawReflectPrompt = false;
  const orch = new Orchestrator(
    baseDeps({
      maxIterations: 12, // 自愈上限 2 应远早于迭代上限触发，但任务不得提前终止
      eventLog: {
        append: async (type: string, payload: Record<string, unknown>) => {
          if (type === 'self-heal') healEvents.push(payload as { strategy?: string; totalHeals?: number });
        },
        filePath: '/tmp/fhcode-test.log',
      } as unknown as OrchestratorDeps['eventLog'],
      router: {
        chat: async (req: ChatReq) => {
          const last = req.messages[req.messages.length - 1];
          if (last?.role === 'user' && typeof last.content === 'string') {
            if (last.content.includes('自愈一次仍未解决')) sawBypassPrompt = true;
            if (last.content.includes('上一轮工具执行失败')) sawReflectPrompt = true;
          }
          round++;
          // 第 1 轮只发 1 个失败调用——让「第一次失败→注入反思提示」先发生；
          // 第 2 轮起发 round+1 个失败调用——第二次失败即触顶走换路线
          // （args 唯一，避免触发重复调用/打转检测）
          const callCount = round === 1 ? 1 : round + 1;
          const toolCalls = Array.from({ length: callCount }, (_, i) => ({
            id: `t${round}-${i}`,
            name: 'run_shell',
            arguments: { command: `fail-${round}-${i}` },
          }));
          return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '', toolCalls } };
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'run_shell', description: '', inputSchema: {} }],
        execute: async () => ({ ok: false, output: '', error: 'boom failed' }),
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('必败任务');
  // 规则 1：自愈一次循环——第一次失败注入反思提示
  assert.ok(sawReflectPrompt, '第一次失败应注入反思提示（自愈一次循环）');
  // 规则 2：达上限换路线——注入「换路线」强指令
  assert.ok(sawBypassPrompt, '自愈额度用尽应注入换路线强指令');
  const strategies = healEvents.map((e) => e.strategy);
  assert.ok(strategies.includes('reflect-retry'), '应记录 reflect-retry 自愈事件');
  assert.ok(strategies.includes('bypass-and-continue'), '应记录 bypass-and-continue 换路线事件');
  // 规则 3：不终止——任务跑到迭代上限自然结束，而非自愈上限「自动终止」
  assert.ok(!/自动终止/.test(result.finalAnswer), '自愈上限用尽不应再自动终止任务');
  assert.match(result.finalAnswer, /最大迭代/, '应跑到迭代上限自然结束');
});

test('run: 同文原地打转时注入强化提示并列出已成功工具（2026-10-05 第二次事故回归）', async () => {
  // 模型连续输出同一段文本 + 同一 write_file 调用，且每次 write_file 都成功
  // → 同文检测应在第 4 次触发时注入强化提示（含「选项 A/选项 B」与已成功工具列表）
  const appendedMessages: ChatMessage[] = [];
  const orch = new Orchestrator(
    baseDeps({
      maxIterations: 30,
      session: {
        runId: randomUUID(),
        append: (m: ChatMessage) => appendedMessages.push(m),
        snapshot: () => ({ runId: randomUUID(), createdAt: new Date().toISOString(), messages: appendedMessages }),
      } as unknown as OrchestratorDeps['session'],
      router: {
        chat: async () => ({
          providerId: 'mock',
          model: 'mock',
          costUsd: 0,
          message: {
            role: 'assistant',
            content: '试 write_file 直接写 .md，看沙箱是否放行：', // 完全相同的文本
            toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'C盘清理计划.md', content: '# plan' } }],
          },
        }),
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', inputSchema: {} }],
        execute: async () => ({ ok: true, output: '已写入 C盘清理计划.md' }), // 每次都成功
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('C盘清理');
  // 应在 loopBreaks >= 3 时终止
  assert.match(result.finalAnswer, /原地打转/);
  // 注入过的强化提示应被 append 到 session
  const fortified = appendedMessages.find((m) => m.role === 'user' && m.content.includes('选项 A'));
  assert.ok(fortified, '应注入强化卡死提示（含「选项 A」）');
  assert.ok(fortified.content.includes('write_file'), '强化提示应列出最近成功执行的工具名');
  assert.ok(fortified.content.includes('不要调用任何工具'), '强化提示应明确禁止再调用工具（选项 A）');
});

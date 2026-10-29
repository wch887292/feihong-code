/**
 * 编排器（ReAct 循环）单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
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

test('run: 经验目录写入经验条目（P0 契约：collect 默认关，需显式开 .fhcode/mem-exp.json）', async () => {
  const experienceDir = mkdtempSync(join(tmpdir(), 'fhcode-expo-'));
  const workCwd = mkdtempSync(join(tmpdir(), 'fhcode-memexp-cwd-'));
  try {
    // P0：经验收集三开关默认全关。要让 run 提取并写经验，必须在工作区 .fhcode/mem-exp.json
    // 显式开启 enable_experience_collect（对齐 CodeArts mem-exp-config 语义）。
    mkdirSync(join(workCwd, '.fhcode'), { recursive: true });
    writeFileSync(join(workCwd, '.fhcode', 'mem-exp.json'),
      JSON.stringify({ enable_experience_collect: true }), 'utf-8');

    const orch = new Orchestrator(
      baseDeps({
        cwd: workCwd,
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
    assert.ok((result.experiencesExtracted ?? 0) >= 1, 'collect 开关开启后应提取至少 1 条经验');
  } finally {
    rmSync(experienceDir, { recursive: true, force: true });
    rmSync(workCwd, { recursive: true, force: true });
  }
});

test('run: collect 开关默认关闭时不提取经验（P0 向后兼容回归）', async () => {
  const experienceDir = mkdtempSync(join(tmpdir(), 'fhcode-expo-def-'));
  const workCwd = mkdtempSync(join(tmpdir(), 'fhcode-memexp-cwd-def-'));
  try {
    // 与上一用例工具结构完全一致，仅不写 .fhcode/mem-exp.json → loadMemExpConfig 回退默认（collect 关）
    const orch = new Orchestrator(
      baseDeps({
        cwd: workCwd,
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
    const result = await orch.run('多工具任务（默认关 collect）');
    assert.ok(result.ok);
    assert.equal(result.experiencesExtracted ?? 0, 0, 'collect 默认关时不应提取任何经验');
  } finally {
    rmSync(experienceDir, { recursive: true, force: true });
    rmSync(workCwd, { recursive: true, force: true });
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

test('改造②: 自愈 cap 切路线时注入已落盘进度（touchedFiles 非空）', async () => {
  // 先 write_file 成功（touchedFiles 非空），再连续 run_shell 失败触发 cap 分支，
  // bypassOnCapPrompt 必须包含「已落盘进度」与「续跑纪律」，并列出已改动文件。
  let round = 0;
  let sawProgressPrompt = false;
  let sawDisciplinePrompt = false;
  let sawFileList = false;
  const orch = new Orchestrator(
    baseDeps({
      maxIterations: 15,
      router: {
        chat: async (req: ChatReq) => {
          const lastMsg = req.messages[req.messages.length - 1];
          if (lastMsg?.role === 'user' && typeof lastMsg.content === 'string') {
            if (lastMsg.content.includes('已落盘进度')) sawProgressPrompt = true;
            if (lastMsg.content.includes('续跑纪律')) sawDisciplinePrompt = true;
            if (lastMsg.content.includes('test.ts')) sawFileList = true;
          }
          round++;
          if (round === 1) {
            // 第 1 轮：write_file 成功 → touchedFiles = ['test.ts']
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { 
              role: 'assistant', content: '', 
              toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'test.ts', content: 'x' } }] 
            }};
          }
          if (round >= 4) {
            // 第 4 轮：最终答案（无 toolCalls）
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: 'done' } };
          }
          // 第 2-3 轮：run_shell 失败触发自愈
          return { providerId: 'mock', model: 'mock', costUsd: 0, message: { 
            role: 'assistant', content: '', 
            toolCalls: Array.from({ length: 2 }, (_, i) => ({ id: `f${round}-${i}`, name: 'run_shell', arguments: { command: 'bad' } })) 
          }};
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', inputSchema: {} }, { name: 'run_shell', description: '', inputSchema: {} }],
        execute: async (name: string) => {
          if (name === 'write_file') return { ok: true, output: 'ok' };
          return { ok: false, output: '', error: 'boom failed' };
        },
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('test');
  assert.ok(sawProgressPrompt, 'cap 分支应包含「已落盘进度」');
  assert.ok(sawDisciplinePrompt, 'cap 分支应包含「续跑纪律」');
  assert.ok(sawFileList, 'cap 分支应列出已改动文件');
});

test('改造②: 自愈 cap 切路线时 touchedFiles 为空提示尚未改动任何文件', async () => {
  // 全程 0 文件改动时，cap 分支的「已落盘进度」应提示「尚未改动任何文件」。
  let round = 0;
  let sawNoFilesHint = false;
  const orch = new Orchestrator(
    baseDeps({
      maxIterations: 15,
      router: {
        chat: async (req: ChatReq) => {
          const lastMsg = req.messages[req.messages.length - 1];
          if (lastMsg?.role === 'user' && typeof lastMsg.content === 'string') {
            if (lastMsg.content.includes('尚未改动任何文件')) sawNoFilesHint = true;
          }
          round++;
          if (round >= 4) {
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: 'done' } };
          }
          return { providerId: 'mock', model: 'mock', costUsd: 0, message: { 
            role: 'assistant', content: '', 
            toolCalls: Array.from({ length: 2 }, (_, i) => ({ id: `f${round}-${i}`, name: 'run_shell', arguments: { command: 'bad' } })) 
          }};
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'run_shell', description: '', inputSchema: {} }],
        execute: async () => ({ ok: false, output: '', error: 'boom failed' }),
      } as unknown as OrchestratorDeps['tools'],
    }),
  );
  const result = await orch.run('test');
  assert.ok(sawNoFilesHint, 'touchedFiles 为空时 cap 分支应提示「尚未改动任何文件」');
});

test('改造②: 自愈 cap 切路线时 touchedFiles 为空提示尚未改动任何文件', async () => {
  // 全程 0 文件改动时，cap 分支的「已落盘进度」应提示「尚未改动任何文件」。
  let round = 0;
  let sawNoFilesHint = false;
  const orch = new Orchestrator(
    baseDeps({
      maxIterations: 12,
      router: {
        chat: async (req: ChatReq) => {
          const last = req.messages[req.messages.length - 1];
          if (last?.role === 'user' && typeof last.content === 'string') {
            if (last.content.includes('尚未改动任何文件')) sawNoFilesHint = true;
          }
          round++;
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
  assert.ok(sawNoFilesHint, 'touchedFiles 为空时 cap 分支应提示「尚未改动任何文件」');
  assert.match(result.finalAnswer, /最大迭代/);
});

test('改造③: 改动文件 + 收尾验证通过 → ok=true 且 finalAnswer 含收尾验证小节', async () => {
  let round = 0;
  let verifierCalledWith: string[] = [];
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async (req: ChatReq) => {
          round++;
          if (round === 1) {
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '', toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'src/a.ts', content: 'x' } }] } };
          }
          return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '完成', toolCalls: [] } };
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', inputSchema: {} }],
        execute: async () => ({ ok: true, output: 'written' }),
      } as unknown as OrchestratorDeps['tools'],
      closeoutVerifier: {
        verify: async (_snap: unknown, _cwd: string, files: string[]) => {
          verifierCalledWith = files;
          return { overall: 'pass', steps: [], errorSummary: '（全部通过）', durationMs: 1, log: '' };
        },
      },
    }),
  );
  const result = await orch.run('改文件任务');
  assert.ok(result.ok, '收尾验证通过时任务应判 ok');
  assert.ok(result.closeoutVerification, '应生成 closeoutVerification');
  assert.strictEqual(result.closeoutVerification!.overall, 'pass');
  assert.ok(result.closeoutVerification!.summary.includes('全部通过'));
  assert.ok(result.finalAnswer.includes('收尾验证（P2 closeout）'), 'finalAnswer 应附收尾验证小节');
  assert.deepStrictEqual(verifierCalledWith, ['src/a.ts'], '收尾验证应收到本次改动的文件列表');
});

test('改造③: 改动文件 + 收尾验证失败 → ok=false', async () => {
  let round = 0;
  const orch = new Orchestrator(
    baseDeps({
      router: {
        chat: async (req: ChatReq) => {
          round++;
          if (round === 1) {
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '', toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'src/b.ts', content: 'x' } }] } };
          }
          return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '完成', toolCalls: [] } };
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', inputSchema: {} }],
        execute: async () => ({ ok: true, output: 'written' }),
      } as unknown as OrchestratorDeps['tools'],
      closeoutVerifier: {
        verify: async () => ({ overall: 'fail', steps: [], errorSummary: 'tsc 报错 3 处', durationMs: 5, log: 'ts errors' }),
      },
    }),
  );
  const result = await orch.run('改文件任务（验证应失败）');
  assert.ok(!result.ok, '收尾验证失败时 ok 必须为 false');
  assert.strictEqual(result.closeoutVerification!.overall, 'fail');
});

test('改造③: 无文件改动 → 不生成 closeoutVerification（纯问答不空跑）', async () => {
  const orch = new Orchestrator(
    baseDeps({
      // 默认 baseDeps：router 直接返回「任务完成」无工具调用 → touchedFiles 为空
      closeoutVerifier: {
        verify: async () => {
          throw new Error('verifier 不应被调用');
        },
      },
    }),
  );
  const result = await orch.run('纯问答');
  assert.ok(result.ok);
  assert.equal(result.closeoutVerification, undefined, '无文件改动时不应触发收尾验证');
});

test('改造③: enableCloseoutVerify=false 时即使有改动也跳过收尾验证（向后兼容）', async () => {
  let round = 0;
  const orch = new Orchestrator(
    baseDeps({
      enableCloseoutVerify: false,
      router: {
        chat: async (req: ChatReq) => {
          round++;
          if (round === 1) {
            return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '', toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'src/c.ts', content: 'x' } }] } };
          }
          return { providerId: 'mock', model: 'mock', costUsd: 0, message: { role: 'assistant', content: '完成', toolCalls: [] } };
        },
        getStats: () => [],
      } as unknown as OrchestratorDeps['router'],
      tools: {
        definitions: () => [{ name: 'write_file', description: '', inputSchema: {} }],
        execute: async () => ({ ok: true, output: 'written' }),
      } as unknown as OrchestratorDeps['tools'],
      closeoutVerifier: {
        verify: async () => {
          throw new Error('enableCloseoutVerify=false 时 verifier 不应被调用');
        },
      },
    }),
  );
  const result = await orch.run('改文件但关闭收尾验证');
  assert.ok(result.ok, '关闭收尾验证时不因验证影响 ok');
  assert.equal(result.closeoutVerification, undefined, '显式关闭时不应生成 closeoutVerification');
});

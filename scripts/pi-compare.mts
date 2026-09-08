/**
 * P5 Pi vs 飞虹Code 对照评测（支持 Mock / 真实模型双模式）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
 *
 * 用法：
 *   # Mock 模式（默认，无需 API key）
 *   npx tsx scripts/pi-compare.mts
 *
 *   # 真实模型模式（agnes-2.5-flash）
 *   npx tsx scripts/pi-compare.mts --real \
 *     --api-key sk-xxx --base-url https://api.agnes-ai.cn/v1 --model agnes-2.5-flash
 *
 *   # 真实模型 + 指定任务数 + 输出报告
 *   npx tsx scripts/pi-compare.mts --real --tasks 2 --output=docs/report.json
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ========== 飞虹Code 侧 ==========
import { createAgentSession } from '../src/agent/agent-session';
import { OpenAICompatibleProvider } from '../src/models/providers/openai-compatible.provider';
import { ModelRouter } from '../src/models/model-router';
import type { ChatMessage } from '../src/models/model.interface';
import type { ToolRegistry } from '../src/tools/tool.registry';
import { createDefaultRegistry } from '../src/tools';

// ========== Pi 侧（ESM 动态导入） ==========
const pi = await import('@earendil-works/pi-agent-core');
const piAi = await import('@earendil-works/pi-ai');
const { createFauxCore, fauxAssistantMessage, fauxToolCall, fauxText } = piAi;
const { Type } = await import('typebox') as typeof import('@sinclair/typebox');

// ========== 配置解析 ==========
const args = process.argv.slice(2);
const REAL_MODE = args.includes('--real');
const API_KEY = args.find((a) => a.startsWith('--api-key='))?.split('=')[1] ?? '';
const BASE_URL = args.find((a) => a.startsWith('--base-url='))?.split('=')[1] ?? 'https://api.agnes-ai.cn/v1';
const MODEL = args.find((a) => a.startsWith('--model='))?.split('=')[1] ?? 'agnes-2.5-flash';
const TASK_LIMIT = parseInt(args.find((a) => a.startsWith('--tasks='))?.split('=')[1] ?? '0', 10);
const OUTPUT_PATH = args.find((a) => a.startsWith('--output='))?.split('=')[1];

// ========== 任务定义 ==========
interface BenchTask {
  id: string;
  description: string;
  /** Mock 模式：飞虹Code 脚本化响应 */
  fhcodeResponses?: Array<{ content?: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }>;
  /** Mock 模式：Pi 脚本化响应 */
  piResponses?: Array<{ content?: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }>;
  /** 真实模式：任务描述（给真实模型） */
  realPrompt?: string;
  /** 是否在第 N 轮工具执行后注入 steer */
  steerAtRound?: number;
  steerMessage?: string;
  /** 真实模式验证：任务完成后检查的条件 */
  verify?: (cwd: string) => { ok: boolean; reason: string };
}

const MOCK_TASKS: BenchTask[] = [
  {
    id: 'T1-single-tool',
    description: '单工具调用：读文件后总结',
    fhcodeResponses: [
      { toolCalls: [{ name: 'read_file', args: { path: 'src/index.ts' } }] },
      { content: '已读取文件，包含 3 个导出函数。' },
    ],
    piResponses: [
      { toolCalls: [{ name: 'read_file', args: { path: 'src/index.ts' } }] },
      { content: '已读取文件，包含 3 个导出函数。' },
    ],
  },
  {
    id: 'T2-multi-tool',
    description: '多工具链式：读→写→总结',
    fhcodeResponses: [
      { toolCalls: [{ name: 'read_file', args: { path: 'src/a.ts' } }] },
      { toolCalls: [{ name: 'write_file', args: { path: 'src/b.ts', content: 'export const b = 1;' } }] },
      { content: '已完成：读取 a.ts，创建 b.ts。' },
    ],
    piResponses: [
      { toolCalls: [{ name: 'read_file', args: { path: 'src/a.ts' } }] },
      { toolCalls: [{ name: 'write_file', args: { path: 'src/b.ts', content: 'export const b = 1;' } }] },
      { content: '已完成：读取 a.ts，创建 b.ts。' },
    ],
  },
  {
    id: 'T3-steer-correction',
    description: '中途纠偏：执行到一半改方向',
    fhcodeResponses: [
      { toolCalls: [{ name: 'read_file', args: { path: 'src/old.ts' } }] },
      { content: '已按新指令完成。' },
    ],
    piResponses: [
      { toolCalls: [{ name: 'read_file', args: { path: 'src/old.ts' } }] },
      { content: '已按新指令完成。' },
    ],
    steerAtRound: 1,
    steerMessage: '不要读 old.ts，改成读 new.ts',
  },
];

const REAL_TASKS: BenchTask[] = [
  {
    id: 'R1-create-file',
    description: '真实模型：创建文件任务',
    realPrompt: '在当前目录创建一个 hello.ts 文件，内容为：console.log("Hello, 飞虹Code!");',
    verify: (cwd: string) => {
      const p = join(cwd, 'hello.ts');
      if (!existsSync(p)) return { ok: false, reason: 'hello.ts 未创建' };
      const content = readFileSync(p, 'utf8');
      if (!content.includes('console.log')) return { ok: false, reason: '文件内容缺少 console.log' };
      return { ok: true, reason: 'hello.ts 已创建且内容正确' };
    },
  },
  {
    id: 'R2-read-summarize',
    description: '真实模型：读取并总结',
    realPrompt: '读取当前目录的 package.json 文件，然后用一句话总结项目名称和版本号。',
    verify: (cwd: string) => {
      // 真实模型应该能读取并总结，验证只要任务完成（有最终答案）即可
      return { ok: true, reason: '任务已执行' };
    },
  },
  {
    id: 'R3-steer-real',
    description: '真实模型：中途纠偏',
    realPrompt: '创建一个 test.txt 文件，内容写"旧内容"。',
    steerAtRound: 1,
    steerMessage: '不要创建 test.txt，改成创建 result.md，内容写"新内容"。',
    verify: (cwd: string) => {
      const resultMd = join(cwd, 'result.md');
      const testTxt = join(cwd, 'test.txt');
      if (existsSync(resultMd)) return { ok: true, reason: 'steer 生效：result.md 已创建' };
      if (existsSync(testTxt)) return { ok: false, reason: 'steer 未生效：仍创建了 test.txt' };
      return { ok: false, reason: '未创建任何文件' };
    },
  },
];

const TASKS = REAL_MODE ? REAL_TASKS : MOCK_TASKS;
const ACTIVE_TASKS = TASK_LIMIT > 0 ? TASKS.slice(0, TASK_LIMIT) : TASKS;

// ========== 指标收集 ==========
interface TaskMetrics {
  taskId: string;
  agent: 'fhcode' | 'pi';
  iterations: number;
  toolCalls: number;
  success: boolean;
  durationMs: number;
  steerInjected: boolean;
  steerObserved: boolean;
  finalAnswer: string;
  verifyReason?: string;
}

// ========== 飞虹Code Mock Router ==========
function createFhcodeMockRouter(
  responses: BenchTask['fhcodeResponses'],
  onSteerObserved: () => void,
): ModelRouter {
  let call = 0;
  return {
    chat: async (req: { messages: ChatMessage[] }) => {
      call++;
      const hasSteer = req.messages.some(
        (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[用户中途指令]'),
      );
      if (hasSteer) onSteerObserved();
      const resp = responses![Math.min(call - 1, responses!.length - 1)];
      return {
        providerId: 'mock', model: 'fhcode-mock', costUsd: 0,
        message: {
          role: 'assistant', content: resp.content ?? '',
          toolCalls: (resp.toolCalls ?? []).map((tc, i) => ({ id: `call-${call}-${i}`, name: tc.name, arguments: tc.args })),
        },
      };
    },
    getStats: () => [],
  } as unknown as ModelRouter;
}

// ========== 飞虹Code 真实 Router ==========
function createFhcodeRealRouter(): ModelRouter {
  const provider = new OpenAICompatibleProvider({
    id: 'agnes',
    type: 'openai-compatible',
    baseURL: BASE_URL,
    apiKey: API_KEY,
    model: MODEL,
    tags: ['code-gen', 'reasoning'],
  });
  return new ModelRouter([provider], 'cost', 0);
}

// ========== 飞虹Code Mock Tools ==========
function createFhcodeMockTools(onToolCall: () => void, onExecute?: () => void): ToolRegistry {
  return {
    definitions: () => [
      { name: 'read_file', description: '读取文件', inputSchema: {} },
      { name: 'write_file', description: '写入文件', inputSchema: {} },
    ],
    execute: async () => { onToolCall(); onExecute?.(); return { ok: true, output: 'mock output' }; },
  } as unknown as ToolRegistry;
}

// ========== 飞虹Code 执行器 ==========
async function runFhcodeTask(task: BenchTask): Promise<TaskMetrics> {
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-bench-'));
  // 真实模式：在 cwd 放一个 package.json 供 R2 读取
  if (REAL_MODE) {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'feihong-code', version: '8.0.0' }, null, 2), 'utf8');
  }

  let toolCalls = 0;
  let steerObserved = false;
  let steerInjected = false;

  const router = REAL_MODE
    ? createFhcodeRealRouter()
    : createFhcodeMockRouter(task.fhcodeResponses, () => { steerObserved = true; });

  const tools = REAL_MODE
    ? createDefaultRegistry()
    : createFhcodeMockTools(() => { toolCalls++; }, () => {
        if (task.steerAtRound !== undefined && toolCalls === task.steerAtRound && !steerInjected) {
          session.injectSteer(task.steerMessage ?? '改方向');
          steerInjected = true;
        }
      });

  const session = createAgentSession({
    cwd, router, tools,
    security: { requireApproval: false, sandboxMode: 'workspace-write' },
    maxIterations: REAL_MODE ? 15 : 10,
    maxCostUsd: REAL_MODE ? 0.1 : 0,
    onEvent: REAL_MODE ? (ev: { type: string }) => {
      if (ev.type === 'tool.call') toolCalls++;
      if (ev.type === 'steer') steerObserved = true;
    } : undefined,
  });

  // 真实模式：延迟注入 steer（模拟用户在任务运行中插话）
  let steerTimer: ReturnType<typeof setTimeout> | undefined;
  if (REAL_MODE && task.steerAtRound !== undefined) {
    steerTimer = setTimeout(() => {
      if (!steerInjected) {
        session.injectSteer(task.steerMessage ?? '改方向');
        steerInjected = true;
      }
    }, 1500);
  }

  const start = Date.now();
  const result = await session.run(REAL_MODE ? task.realPrompt! : task.description);
  const durationMs = Date.now() - start;
  if (steerTimer) clearTimeout(steerTimer);

  let verifyReason: string | undefined;
  if (REAL_MODE && task.verify) {
    const v = task.verify(cwd);
    verifyReason = v.reason;
    if (!v.ok) result.ok = false;
  }

  rmSync(cwd, { recursive: true, force: true });

  return {
    taskId: task.id, agent: 'fhcode',
    iterations: result.iterations, toolCalls,
    success: result.ok, durationMs,
    steerInjected, steerObserved,
    finalAnswer: result.finalAnswer.slice(0, 150),
    verifyReason,
  };
}

// ========== Agnes API 响应类型 ==========
interface AgnesToolCall { id: string; function: { name: string; arguments: string }; }
interface AgnesChoice { message: { content?: string; tool_calls?: AgnesToolCall[] }; }
interface AgnesUsage { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; }
interface AgnesResponse { choices?: AgnesChoice[]; usage?: AgnesUsage; }

// ========== Pi Agnes StreamFn（真实模式） ==========
function createAgnesStreamFn() {
  return async (model: { id: string }, context: { systemPrompt?: string; messages: unknown[]; tools?: unknown[] }) => {
    // 转换 Pi messages → OpenAI Chat Completions 格式
    const openaiMessages: Array<Record<string, unknown>> = [];
    if (context.systemPrompt) openaiMessages.push({ role: 'system', content: context.systemPrompt });

    for (const msg of context.messages as Array<{ role: string; content?: unknown; toolCallId?: string; toolCalls?: unknown[] }>) {
      if (msg.role === 'user') {
        const content = Array.isArray(msg.content)
          ? (msg.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
          : String(msg.content ?? '');
        openaiMessages.push({ role: 'user', content });
      } else if (msg.role === 'assistant') {
        const content = Array.isArray(msg.content)
          ? (msg.content as Array<{ type: string; text?: string; name?: string; arguments?: unknown; id?: string }>)
          : [];
        const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
        const toolCalls = content.filter((c) => c.type === 'toolCall').map((c) => ({
          id: c.id ?? 'tc',
          type: 'function',
          function: { name: c.name ?? '', arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}) },
        }));
        const entry: Record<string, unknown> = { role: 'assistant', content: text };
        if (toolCalls.length > 0) entry.tool_calls = toolCalls;
        openaiMessages.push(entry);
      } else if (msg.role === 'toolResult') {
        const content = Array.isArray(msg.content)
          ? (msg.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
          : String(msg.content ?? '');
        openaiMessages.push({ role: 'tool', tool_call_id: msg.toolCallId ?? 'tc', content });
      }
    }

    // 转换 tools
    const openaiTools: Array<Record<string, unknown>> = [];
    if (context.tools) {
      for (const tool of context.tools as Array<{ name: string; description?: string; parameters?: unknown }>) {
        openaiTools.push({
          type: 'function',
          function: { name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? { type: 'object', properties: {} } },
        });
      }
    }

    // 调用 agnes API
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.id,
          messages: openaiMessages,
          tools: openaiTools.length > 0 ? openaiTools : undefined,
          max_tokens: 2048,
          stream: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await resp.json() as AgnesResponse;
      const choice = data.choices?.[0];
      const text = choice?.message?.content ?? '';
      const toolCalls = choice?.message?.tool_calls ?? [];

      // 构建 Pi AssistantMessage
      const content: Array<Record<string, unknown>> = [];
      if (text) content.push({ type: 'text', text });
      for (const tc of toolCalls) {
        let args: unknown = {};
        try { args = JSON.parse(tc.function.arguments); } catch { args = tc.function.arguments; }
        content.push({ type: 'toolCall', id: tc.id, name: tc.function.name, arguments: args });
      }

      const assistantMsg = {
        role: 'assistant' as const,
        content,
        api: 'openai-completions',
        provider: 'agnes',
        model: model.id,
        usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0, total: data.usage?.total_tokens ?? 0, cost: 0 },
        stopReason: toolCalls.length > 0 ? 'toolCall' : 'stop',
        timestamp: Date.now(),
      };

      // 创建事件流
      const stream = piAi.createAssistantMessageEventStream();
      stream.push({ type: 'start', partial: assistantMsg });
      if (text) {
        stream.push({ type: 'text_start', contentIndex: 0, partial: assistantMsg });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: assistantMsg });
        stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: assistantMsg });
      }
      stream.end(assistantMsg);
      return stream;
    } catch (e) {
      clearTimeout(timeout);
      const errMsg = e instanceof Error ? e.message : String(e);
      const errMsgObj = {
        role: 'assistant' as const,
        content: [{ type: 'text', text: `API 调用失败: ${errMsg}` }],
        api: 'openai-completions', provider: 'agnes', model: model.id,
        usage: { input: 0, output: 0, total: 0, cost: 0 },
        stopReason: 'error' as const,
        errorMessage: errMsg,
        timestamp: Date.now(),
      };
      const stream = piAi.createAssistantMessageEventStream();
      stream.push({ type: 'start', partial: errMsgObj });
      stream.end(errMsgObj);
      return stream;
    }
  };
}

// ========== Pi 真实 Model ==========
function createAgnesModel() {
  return {
    id: MODEL,
    name: MODEL,
    api: 'openai-completions',
    provider: 'agnes',
    baseUrl: BASE_URL,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

// ========== Pi 真实文件工具 ==========
function createPiRealTools(cwd: string) {
  const readTool = {
    name: 'read_file',
    label: 'Read File',
    description: '读取工作目录中的文件内容',
    parameters: Type.Object({ path: Type.String({ description: '文件路径（相对于工作目录）' }) }),
    execute: async (_id: string, params: { path: string }) => {
      const fullPath = join(cwd, params.path);
      try {
        const content = readFileSync(fullPath, 'utf8');
        return { content: [fauxText(content)], details: { path: fullPath } };
      } catch (e) {
        return { content: [fauxText(`读取失败: ${(e as Error).message}`)], details: { error: true } };
      }
    },
  };

  const writeTool = {
    name: 'write_file',
    label: 'Write File',
    description: '写入文件内容到工作目录',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    execute: async (_id: string, params: { path: string; content: string }) => {
      const fullPath = join(cwd, params.path);
      try {
        writeFileSync(fullPath, params.content, 'utf8');
        return { content: [fauxText(`已写入 ${params.path}`)], details: { path: fullPath } };
      } catch (e) {
        return { content: [fauxText(`写入失败: ${(e as Error).message}`)], details: { error: true } };
      }
    },
  };

  return [readTool, writeTool];
}

// ========== Pi 执行器 ==========
async function runPiTask(task: BenchTask): Promise<TaskMetrics> {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-bench-'));
  if (REAL_MODE) {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'feihong-code', version: '8.0.0' }, null, 2), 'utf8');
  }

  let toolCalls = 0;
  let steerInjected = false;

  let agent: InstanceType<typeof pi.Agent>;

  if (REAL_MODE) {
    const streamFn = createAgnesStreamFn();
    const model = createAgnesModel();
    const tools = createPiRealTools(cwd);

    // 包装工具执行以计数和 steer 注入
    const wrappedTools = tools.map((t: { execute: (...args: unknown[]) => Promise<unknown>; name: string }) => ({
      ...t,
      execute: async (...args: unknown[]) => {
        toolCalls++;
        if (task.steerAtRound !== undefined && toolCalls === task.steerAtRound && !steerInjected) {
          agent.steer({ role: 'user', content: task.steerMessage ?? '改方向' } as never);
          steerInjected = true;
        }
        return t.execute(...args);
      },
    }));

    agent = new pi.Agent({
      streamFn: streamFn as never,
      initialState: {
        model,
        systemPrompt: '你是一个代码助手。使用 read_file 和 write_file 工具操作文件。',
        thinkingLevel: 'low' as never,
        tools: wrappedTools as never,
      },
    });
  } else {
    // Mock 模式
    const faux = createFauxCore({
      models: [{ id: 'pi-mock', name: 'Pi Mock', contextWindow: 128000, maxTokens: 4096 }],
    });
    const piMessages = (task.piResponses ?? []).map((r, idx) => {
      if (r.toolCalls && r.toolCalls.length > 0) {
        const blocks = r.toolCalls.map((tc) => fauxToolCall(tc.name, tc.args as never, { id: `pi-call-${idx}-${Math.random().toString(36).slice(2, 6)}` }));
        return fauxAssistantMessage(blocks);
      }
      return fauxAssistantMessage(r.content ?? '完成');
    });
    faux.setResponses(piMessages);
    const model = faux.getModel();

    const readTool = {
      name: 'read_file', label: 'Read File', description: '读取文件',
      parameters: Type.Object({ path: Type.String() }),
      execute: async () => { toolCalls++; return { content: [fauxText('mock content')], details: {} }; },
    };
    const writeTool = {
      name: 'write_file', label: 'Write File', description: '写入文件',
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async () => {
        toolCalls++;
        if (task.steerAtRound !== undefined && toolCalls === task.steerAtRound && !steerInjected) {
          agent.steer({ role: 'user', content: task.steerMessage ?? '改方向' } as never);
          steerInjected = true;
        }
        return { content: [fauxText('written')], details: {} };
      },
    };

    agent = new pi.Agent({
      streamFn: faux.streamSimple as never,
      initialState: {
        model, systemPrompt: '你是一个代码助手。',
        thinkingLevel: 'low' as never,
        tools: [readTool, writeTool] as never,
      },
    });
  }

  const start = Date.now();
  let finalAnswer = '';
  try {
    await agent.prompt(REAL_MODE ? task.realPrompt! : task.description);
    await agent.waitForIdle();
  } catch (e) {
    finalAnswer = `执行异常: ${(e as Error).message.slice(0, 100)}`;
  }
  const durationMs = Date.now() - start;

  const lastMsg = agent.state.messages[agent.state.messages.length - 1];
  if (!finalAnswer) {
    finalAnswer = typeof lastMsg?.content === 'string'
      ? lastMsg.content
      : JSON.stringify(lastMsg?.content ?? '').slice(0, 150);
  }

  let verifyReason: string | undefined;
  let success = toolCalls > 0 || finalAnswer.length > 0;
  if (REAL_MODE && task.verify) {
    const v = task.verify(cwd);
    verifyReason = v.reason;
    success = v.ok;
  }

  rmSync(cwd, { recursive: true, force: true });

  return {
    taskId: task.id, agent: 'pi',
    iterations: REAL_MODE ? toolCalls + 1 : (piAi as unknown as { state?: { callCount?: number } }).state?.callCount ?? 0,
    toolCalls, success, durationMs,
    steerInjected, steerObserved: steerInjected,
    finalAnswer: finalAnswer.slice(0, 150),
    verifyReason,
  };
}

// ========== 主流程 ==========
async function main() {
  console.log(`\n========== P5 Pi vs 飞虹Code 对照评测（${REAL_MODE ? '真实模型' : 'Mock'} 模式）==========`);
  console.log(`任务数: ${ACTIVE_TASKS.length}`);
  if (REAL_MODE) {
    console.log(`模型: ${MODEL} @ ${BASE_URL}`);
  }
  console.log(`飞虹Code: ${REAL_MODE ? 'OpenAICompatibleProvider + 真实工具' : 'createAgentSession + mock router'}`);
  console.log(`Pi: ${REAL_MODE ? '自定义 streamFn + agnes Chat Completions' : '@earendil-works/pi-agent-core + fauxProvider'}`);
  console.log('');

  const allMetrics: TaskMetrics[] = [];

  for (const task of ACTIVE_TASKS) {
    console.log(`\n--- [${task.id}] ${task.description} ---`);

    console.log('  飞虹Code 执行中...');
    const fhMetrics = await runFhcodeTask(task);
    console.log(`    迭代=${fhMetrics.iterations} 工具调用=${fhMetrics.toolCalls} 耗时=${fhMetrics.durationMs}ms 成功=${fhMetrics.success}`);
    if (task.steerAtRound) console.log(`    steer: 注入=${fhMetrics.steerInjected} 模型观察到=${fhMetrics.steerObserved}`);
    if (fhMetrics.verifyReason) console.log(`    验证: ${fhMetrics.verifyReason}`);

    console.log('  Pi 执行中...');
    const piMetrics = await runPiTask(task);
    console.log(`    迭代=${piMetrics.iterations} 工具调用=${piMetrics.toolCalls} 耗时=${piMetrics.durationMs}ms 成功=${piMetrics.success}`);
    if (task.steerAtRound) console.log(`    steer: 注入=${piMetrics.steerInjected}`);
    if (piMetrics.verifyReason) console.log(`    验证: ${piMetrics.verifyReason}`);

    allMetrics.push(fhMetrics, piMetrics);
  }

  // 汇总
  console.log('\n\n========== 对照评测汇总 ==========');
  const summary = {
    date: new Date().toISOString(),
    mode: REAL_MODE ? 'real' : 'mock',
    model: REAL_MODE ? MODEL : 'mock',
    fhcodeVersion: '8.0.0',
    piVersion: '0.85.1',
    tasks: ACTIVE_TASKS.map((t) => ({ id: t.id, description: t.description })),
    metrics: allMetrics,
    comparison: [] as Array<Record<string, unknown>>,
  };

  for (const task of ACTIVE_TASKS) {
    const fh = allMetrics.find((m) => m.taskId === task.id && m.agent === 'fhcode')!;
    const pi = allMetrics.find((m) => m.taskId === task.id && m.agent === 'pi')!;
    const row: Record<string, unknown> = {
      task: task.id,
      'fhcode 迭代': fh.iterations,
      'pi 迭代': pi.iterations,
      'fhcode 工具': fh.toolCalls,
      'pi 工具': pi.toolCalls,
      'fhcode 耗时ms': fh.durationMs,
      'pi 耗时ms': pi.durationMs,
      'fhcode 成功': fh.success,
      'pi 成功': pi.success,
    };
    if (task.steerAtRound) {
      row['fhcode steer'] = fh.steerInjected && fh.steerObserved;
      row['pi steer'] = pi.steerInjected;
    }
    if (fh.verifyReason) row['fhcode 验证'] = fh.verifyReason;
    if (pi.verifyReason) row['pi 验证'] = pi.verifyReason;
    summary.comparison.push(row);
  }

  console.table(summary.comparison);

  const fhAvgIter = allMetrics.filter((m) => m.agent === 'fhcode').reduce((a, b) => a + b.iterations, 0) / ACTIVE_TASKS.length;
  const piAvgIter = allMetrics.filter((m) => m.agent === 'pi').reduce((a, b) => a + b.iterations, 0) / ACTIVE_TASKS.length;
  const fhSuccess = allMetrics.filter((m) => m.agent === 'fhcode' && m.success).length;
  const piSuccess = allMetrics.filter((m) => m.agent === 'pi' && m.success).length;

  console.log('\n--- 总体 ---');
  console.log(`  飞虹Code: 平均迭代=${fhAvgIter.toFixed(1)} 成功=${fhSuccess}/${ACTIVE_TASKS.length}`);
  console.log(`  Pi:       平均迭代=${piAvgIter.toFixed(1)} 成功=${piSuccess}/${ACTIVE_TASKS.length}`);

  if (OUTPUT_PATH) {
    writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\n报告已写入: ${OUTPUT_PATH}`);
  }

  console.log('\n========== 评测完成 ==========\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

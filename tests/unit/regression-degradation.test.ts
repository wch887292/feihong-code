/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 2026-11-09 退化事故回归测试（鹈鹕 3D 网页任务）：
 *  ① 单次输出被 8192 token 截断 → 半截文件落盘
 *  ② 模型把整段代码当纯文本吐出 → 仍判 done
 *  ③ 换工具/换参数空转 21 分钟不被熔断
 *  ④ 并发 503 无退避抖动、无供应商冷却
 *  ⑤ 不可运行代码（括号/语法错误）收尾无校验
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  looksLikeUnfiledCode,
  resolveNoToolCall,
  resolveWallClockLimits,
} from '../../src/agent/orchestrator';
import { verifyArtifacts } from '../../src/agent/artifact-verifier';
import { verifyTask } from '../../src/agent/swe-verifier';
import { extractTextToolCalls } from '../../src/models/text-toolcall';
import { writeFileTool, detectIncompleteDocument } from '../../src/tools/file/write.tool';
import { OpenAICompatibleProvider } from '../../src/models/providers/openai-compatible.provider';
import { ModelRouter } from '../../src/models/model-router';
import { ModelError } from '../../src/shared/errors';
import type { ToolContext } from '../../src/tools/tool.interface';
import type { ProviderConfig } from '../../src/shared/config';
import type { ChatResponse, ModelProvider } from '../../src/models/model.interface';

const HALF_HTML = '<!DOCTYPE html><html><body><script>for (var p =';
const FULL_HTML = '<!DOCTYPE html><html><body><script>var a = 1;</script></body></html>';
const BIG_CODE = '```html\n' + ('function boot(){\n  const x = 1;\n}\n').repeat(30) + '```';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'fh-regression-'));
}

function ctx(cwd: string): ToolContext {
  return { cwd } as unknown as ToolContext;
}

// ---------- ① 截断链路 ----------

test('回归①: 未闭合 dots tool call 被标记为截断，不再伪装成完整写入', () => {
  const half = '<dots_function_call><invoke name="write_file">'
    + '<parameter name="path">index.html</parameter>'
    + '<parameter name="content">for (var p =';
  const r = extractTextToolCalls(half);
  assert.ok(r, '截断块也应返回结果，供 provider 上抛 truncated 信号');
  assert.equal(r.truncated, true);
  assert.equal(r.toolCalls.length, 1);
  assert.equal((r.toolCalls[0].arguments as Record<string, unknown>).__truncated__, true);
  assert.ok(!r.cleanedContent.includes('<invoke'), '半截 XML 不得漏进对话正文');
});

test('回归①: 闭合的 dots tool call 不受影响（无截断标记）', () => {
  const full = '<dots_function_call><invoke name="write_file">'
    + '<parameter name="path">a.txt</parameter>'
    + '<parameter name="content">hello</parameter>'
    + '</invoke></dots_function_call>';
  const r = extractTextToolCalls(full);
  assert.ok(r);
  assert.equal(r.truncated, false);
  assert.equal((r.toolCalls[0].arguments as Record<string, string>).content, 'hello');
  assert.equal((r.toolCalls[0].arguments as Record<string, unknown>).__truncated__, undefined);
});

test('回归①: provider 读取 finish_reason=length 并上抛 truncated', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model: 'm',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  try {
    const p = new OpenAICompatibleProvider({
      id: 'p', model: 'm', baseURL: 'https://example.invalid/v1', tags: [],
    } as unknown as ProviderConfig);
    const resp = await p.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(resp.truncated, true);
    assert.equal(resp.finishReason, 'length');
  } finally {
    globalThis.fetch = original;
  }
});

test('回归①: provider 截断且无 tool call 时给出续写指令，不静默收尾', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model: 'm',
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'max_tokens' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200 },
    )) as unknown as typeof fetch;
  try {
    const p = new OpenAICompatibleProvider({
      id: 'p', model: 'm', baseURL: 'https://example.invalid/v1', tags: [],
    } as unknown as ProviderConfig);
    const resp = await p.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(resp.truncated, true);
    assert.match(resp.message.content, /输出被截断/);
    assert.equal(looksLikeUnfiledCode(resp.message.content), true);
  } finally {
    globalThis.fetch = original;
  }
});

test('回归①: write_file 拒绝 __truncated__ 参数，磁盘不产生半截文件', async () => {
  const dir = tempDir();
  try {
    const r = await writeFileTool.execute(
      { path: 'index.html', content: HALF_HTML, __truncated__: true }, ctx(dir),
    );
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /拒绝落盘/);
    assert.equal(existsSync(join(dir, 'index.html')), false, '残缺文件绝不能落盘');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('回归①: 首次写入未闭合 HTML 被拒绝，append 可分段续写', async () => {
  const dir = tempDir();
  try {
    const bad = await writeFileTool.execute({ path: 'index.html', content: HALF_HTML }, ctx(dir));
    assert.equal(bad.ok, false);
    assert.equal(existsSync(join(dir, 'index.html')), false);

    const first = await writeFileTool.execute({ path: 'app.js', content: 'const a = 1;\n' }, ctx(dir));
    assert.equal(first.ok, true);
    const second = await writeFileTool.execute({ path: 'app.js', content: 'const b = 2;\n', append: true }, ctx(dir));
    assert.equal(second.ok, true);
    assert.equal(readFileSync(join(dir, 'app.js'), 'utf8'), 'const a = 1;\nconst b = 2;\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('回归①: detectIncompleteDocument 只拦真残缺，不误伤合法片段', () => {
  assert.equal(detectIncompleteDocument('index.html', FULL_HTML), null);
  assert.match(detectIncompleteDocument('index.html', HALF_HTML) ?? '', /<\/html>/);
  assert.equal(detectIncompleteDocument('part.txt', 'just a fragment'), null);
  assert.equal(detectIncompleteDocument('a.json', '{"a":1}'), null);
  assert.match(detectIncompleteDocument('a.json', '{"a":') ?? '', /JSON/);
});

// ---------- ② 纯文本吐代码 ----------

test('回归②: 普通 FINAL 总结不被误判为代码', () => {
  assert.equal(looksLikeUnfiledCode('FINAL: 已完成，生成 index.html 与 three.min.js。'), false);
  assert.equal(looksLikeUnfiledCode('已修复 3 处瑕疵：控制台对比度、翅膀、车篮。'), false);
});

test('回归②: 正文大段代码 / 截断提示 / 半截 XML 均被识别', () => {
  assert.equal(looksLikeUnfiledCode(BIG_CODE), true);
  assert.equal(looksLikeUnfiledCode('【输出被截断】上一轮回复超过上限'), true);
  assert.equal(
    looksLikeUnfiledCode('<dots_function_call><invoke name="write_file"><parameter name="content">abc'),
    true,
  );
});

test('回归②: 已写过文件也不能靠「贴代码」完成，nudge 强制落盘', () => {
  assert.deepEqual(resolveNoToolCall(BIG_CODE, 1, 0), { action: 'nudge' });
  assert.equal(resolveNoToolCall('FINAL: 完成', 1, 0).action, 'finish');
  // 连续 nudge 达上限仍保留防死循环兜底
  assert.equal(resolveNoToolCall(BIG_CODE, 1, 3).action, 'finish');
});

// ---------- ③ 墙钟熔断 ----------

test('回归③: 墙钟阈值默认 20/8 分钟，支持环境变量与 0=禁用', () => {
  const saved = {
    d: process.env.FH_TASK_DEADLINE_MINUTES,
    n: process.env.FH_NO_OUTPUT_TIMEOUT_MINUTES,
  };
  try {
    delete process.env.FH_TASK_DEADLINE_MINUTES;
    delete process.env.FH_NO_OUTPUT_TIMEOUT_MINUTES;
    assert.deepEqual(resolveWallClockLimits(), { deadlineMs: 20 * 60000, noOutputMs: 8 * 60000 });
    process.env.FH_TASK_DEADLINE_MINUTES = '5';
    process.env.FH_NO_OUTPUT_TIMEOUT_MINUTES = '0';
    assert.deepEqual(resolveWallClockLimits(), { deadlineMs: 5 * 60000, noOutputMs: 0 });
  } finally {
    if (saved.d === undefined) delete process.env.FH_TASK_DEADLINE_MINUTES;
    else process.env.FH_TASK_DEADLINE_MINUTES = saved.d;
    if (saved.n === undefined) delete process.env.FH_NO_OUTPUT_TIMEOUT_MINUTES;
    else process.env.FH_NO_OUTPUT_TIMEOUT_MINUTES = saved.n;
  }
});

// ---------- ④ 并发 503 ----------

test('回归④: 5xx 供应商被冷却，后续请求不再重打同一家', async () => {
  const dir = tempDir();
  let badCalls = 0;
  const bad: ModelProvider = {
    id: 'bad', model: 'bad', tags: ['code-gen'],
    chat: async () => { badCalls++; throw new ModelError('HTTP 503 busy', 'bad', 503); },
  };
  const good: ModelProvider = {
    id: 'good', model: 'good', tags: ['code-gen'],
    chat: async (): Promise<ChatResponse> => ({
      message: { role: 'assistant', content: 'ok' },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      providerId: 'good', model: 'good', costUsd: 0,
    }),
  };
  try {
    const router = new ModelRouter([bad, good], 'cost', 0, 'stats.jsonl', dir, 2, 1, 'full');
    const first = await router.chat({ messages: [{ role: 'user', content: 'hi' }] }, ['code-gen']);
    assert.equal(first.providerId, 'good', '5xx 后应自动轮换到健康供应商');
    assert.equal(badCalls, 1);
    const second = await router.chat({ messages: [{ role: 'user', content: 'hi' }] }, ['code-gen']);
    assert.equal(second.providerId, 'good');
    assert.equal(badCalls, 1, '冷却期内不得再次打到 5xx 供应商');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- ⑤ 收尾产物校验 ----------

test('回归⑤: 完整 HTML 通过，半截/语法错/未配对一律失败', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'ok.html'), FULL_HTML);
    const ok = verifyArtifacts(dir, ['ok.html']);
    assert.equal(ok.overall, 'pass');
    assert.equal(ok.steps.length, 1);
    assert.equal(ok.steps[0].status, 'pass');

    writeFileSync(join(dir, 'half.html'), HALF_HTML);
    const half = verifyArtifacts(dir, ['half.html']);
    assert.equal(half.overall, 'fail');
    assert.match(half.errorSummary, /<\/html>|<script>/);

    writeFileSync(join(dir, 'badjs.html'), '<!DOCTYPE html><html><body><script>const x = ;</script></body></html>');
    const badJs = verifyArtifacts(dir, ['badjs.html']);
    assert.equal(badJs.overall, 'fail');
    assert.match(badJs.errorSummary, /语法错误/);

    writeFileSync(join(dir, 'bad.json'), '{"a":');
    assert.equal(verifyArtifacts(dir, ['bad.json']).overall, 'fail');

    writeFileSync(join(dir, 'mod.mjs'), 'import fs from "node:fs";\nexport const x = 1;');
    assert.equal(verifyArtifacts(dir, ['mod.mjs']).overall, 'pass', 'ESM 模块不该被 vm.Script 误报');

    assert.equal(verifyArtifacts(dir, []).overall, 'skipped');
    assert.equal(verifyArtifacts(dir, ['../escape.html']).steps[0].status, 'skipped', '越界路径应跳过');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('回归⑤: 收尾验证不再把测试名里的 error 字样误判为失败', async () => {
  const dir = tempDir();
  try {
    const script = join(dir, 'fake-test.js');
    writeFileSync(
      script,
      "console.log('# Subtest: classifyError: 编译错误分类');\n"
      + "console.log('ok 1 - classifyError: 运行时错误分类');\n"
      + "console.log('# pass 2');\nconsole.log('# fail 0');\n",
      'utf8',
    );
    const result = await verifyTask(
      {} as never,
      { verifyCommand: `node "${script}"` } as never,
      dir,
    );
    assert.equal(result.overall, 'pass', 'exit=0 且 # fail 0 的全绿日志必须判通过');
    assert.equal(result.steps[0].status, 'pass');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

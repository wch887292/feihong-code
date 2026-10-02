/**
 * models/text-toolcall 单元测试：文本格式 tool call 兜底解析
 * 背景：dots 系网关与无原生 FC 的 Qwen 系模型会把 tool call 以文本混在 content，
 * 不兜底会导致 write_file 等工具静默失效（2026-10-01 qwen3 优化任务实测踩坑）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTextToolCalls } from '../../src/models/text-toolcall';

test('extractTextToolCalls: dots 格式单 invoke 多参数（值带首尾换行）', () => {
  const content = [
    '我将创建方案文件。',
    '<dots_function_call>',
    '<invoke name="write_file">',
    '<parameter name="path">',
    'H:/work/out/report.md',
    '</parameter>',
    '<parameter name="content">',
    '# 标题',
    '正文内容',
    '</parameter>',
    '</invoke>',
    '</dots_function_call>',
  ].join('\n');

  const r = extractTextToolCalls(content);
  assert.ok(r, '应识别出 tool call');
  assert.strictEqual(r.toolCalls.length, 1);
  assert.strictEqual(r.toolCalls[0].name, 'write_file');
  assert.strictEqual(r.toolCalls[0].arguments['path'], 'H:/work/out/report.md');
  assert.strictEqual(r.toolCalls[0].arguments['content'], '# 标题\n正文内容');
  // 正文清理：XML 块应被移除，仅剩自然语言部分
  assert.ok(!r.cleanedContent.includes('<dots_function_call>'));
  assert.ok(r.cleanedContent.includes('我将创建方案文件。'));
});

test('extractTextToolCalls: dots 格式多 invoke 提取多个 tool call', () => {
  const content = [
    '<dots_function_call>',
    '<invoke name="write_file">',
    '<parameter name="path">a.txt</parameter>',
    '<parameter name="content">A</parameter>',
    '</invoke>',
    '<invoke name="run_shell">',
    '<parameter name="command">echo hi</parameter>',
    '</invoke>',
    '</dots_function_call>',
  ].join('\n');

  const r = extractTextToolCalls(content);
  assert.ok(r);
  assert.strictEqual(r.toolCalls.length, 2);
  assert.strictEqual(r.toolCalls[0].name, 'write_file');
  assert.strictEqual(r.toolCalls[1].name, 'run_shell');
  assert.strictEqual(r.toolCalls[1].arguments['command'], 'echo hi');
});

test('extractTextToolCalls: Qwen/Hermes JSON 格式', () => {
  const content = '<tool_call>{"name":"read_file","arguments":{"path":"/x/y.ts"}}</tool_call>';
  const r = extractTextToolCalls(content);
  assert.ok(r);
  assert.strictEqual(r.toolCalls.length, 1);
  assert.strictEqual(r.toolCalls[0].name, 'read_file');
  assert.deepEqual(r.toolCalls[0].arguments, { path: '/x/y.ts' });
});

test('extractTextToolCalls: Qwen 格式 arguments 为 JSON 字符串时二次解析', () => {
  const content = '<tool_call>{"name":"grep","arguments":"{\\"pattern\\":\\"foo\\"}"}</tool_call>';
  const r = extractTextToolCalls(content);
  assert.ok(r);
  assert.deepEqual(r.toolCalls[0].arguments, { pattern: 'foo' });
});

test('extractTextToolCalls: 无标记内容返回 null 且不改动', () => {
  const content = '# 普通回答\n\n这是<正文>里的尖括号，但不是 tool call。';
  assert.strictEqual(extractTextToolCalls(content), null);
});

test('extractTextToolCalls: 空内容返回 null', () => {
  assert.strictEqual(extractTextToolCalls(''), null);
});

test('extractTextToolCalls: 非法 JSON 的 tool_call 块被忽略（不误伤正文）', () => {
  const content = '前文 <tool_call>这不是JSON{{</tool_call> 后文';
  assert.strictEqual(extractTextToolCalls(content), null);
});

test('extractTextToolCalls: 截断容错——未闭合 dots 块仍解析（最后参数为半截）', () => {
  const content = [
    '<dots_function_call>',
    '<invoke name="write_file">',
    '<parameter name="path">',
    'H:/work/report.md',
    '</parameter>',
    '<parameter name="content">',
    '# 第一章',
    '正文开始但没有结束标签——输出在这里被截断',
  ].join('\n');
  const r = extractTextToolCalls(content);
  assert.ok(r, '未闭合块也应解析出 tool call');
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.toolCalls.length, 1);
  assert.strictEqual(r.toolCalls[0].name, 'write_file');
  assert.strictEqual(r.toolCalls[0].arguments['path'], 'H:/work/report.md');
  assert.ok(String(r.toolCalls[0].arguments['content']).includes('正文开始'));
  assert.ok(!r.cleanedContent.includes('dots_function_call'));
});

test('extractTextToolCalls: id 唯一性', () => {
  const content = [
    '<dots_function_call>',
    '<invoke name="a"><parameter name="x">1</parameter></invoke>',
    '<invoke name="b"><parameter name="x">2</parameter></invoke>',
    '</dots_function_call>',
  ].join('\n');
  const r = extractTextToolCalls(content);
  assert.ok(r);
  const ids = r.toolCalls.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

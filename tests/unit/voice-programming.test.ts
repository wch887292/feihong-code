/**
 * voice-programming 模块单元测试：指令解析 / 参数提取 / 上下文 / 代码模板
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceProgrammingManager } from '../../src/voice/voice-programming';

const vp = createVoiceProgrammingManager();

test('parseCommand: 常见命令类型识别', () => {
  const cases: Array<[string, string]> = [
    ['新建文件', 'new_file'],
    ['创建一个叫 utils 的文件', 'new_file'],
    ['打开 index.ts', 'open_file'],
    ['保存', 'save_file'],
    ['关闭文件', 'close_file'],
    ['运行一下', 'run_code'],
    ['调试', 'debug_code'],
    ['停止', 'stop_code'],
    ['搜索 TODO 函数', 'search'],
    ['跳到第100行', 'goto_line'],
    ['注释这行', 'comment'],
    ['取消注释', 'uncomment'],
    ['格式化', 'format'],
    ['撤销', 'undo'],
    ['重做', 'redo'],
    ['复制', 'copy'],
    ['粘贴', 'paste'],
    ['剪切', 'cut'],
    ['帮我写一个排序函数', 'generate_code'],
    ['解释这段代码', 'explain_code'],
    ['重构', 'refactor_code'],
    ['审查代码', 'code' === 'code' ? 'review_code' : 'review_code'],
    ['打开终端', 'toggle_terminal'],
    ['打开侧边栏', 'toggle_sidebar'],
    ['全屏', 'toggle_fullscreen'],
    ['放大', 'zoom_in'],
    ['缩小', 'zoom_out'],
    ['重置缩放', 'reset_zoom'],
  ];
  for (const [input, expected] of cases) {
    const cmd = vp.parseCommand(input);
    assert.equal(cmd.type, expected, `「${input}」应解析为 ${expected}，实际 ${cmd.type}`);
  }
});

test('parseCommand: 参数提取', () => {
  assert.deepEqual(vp.parseCommand('创建一个叫 utils 的文件').params, { fileName: 'utils' });
  assert.deepEqual(vp.parseCommand('打开 src/index.ts').params, { fileName: 'src/index.ts' });
  assert.deepEqual(vp.parseCommand('跳到第100行').params, { line: 100 });
  assert.deepEqual(vp.parseCommand('搜索 TODO').params, { query: 'TODO' });
  const gen = vp.parseCommand('帮我写一个排序函数');
  assert.equal(gen.type, 'generate_code');
  assert.ok(gen.needConfirm, '生成代码应需确认');
  assert.ok(gen.params.description && gen.params.description.length > 0, '应提取描述');
});

test('parseCommand: 未知输入回落到 chat', () => {
  const cmd = vp.parseCommand('今天天气不错');
  assert.equal(cmd.type, 'chat');
  assert.deepEqual(cmd.params, { text: '今天天气不错' });
});

test('parseCommand: 置信度在 [0,1] 且未知为 0.5', () => {
  const known = vp.parseCommand('打开 index.ts');
  assert.ok(known.confidence > 0 && known.confidence <= 1, '已知命令置信度应在 (0,1]');
  const unknown = vp.parseCommand('随意闲聊内容');
  assert.equal(unknown.confidence, 0.5);
});

test('getSupportedCommands: 覆盖全部可匹配命令类型（含曾缺失的 copy/paste/cut/zoom/stop）', () => {
  const supported = new Set(vp.getSupportedCommands().map((c) => c.type));
  const mustHave = [
    'new_file', 'open_file', 'save_file', 'close_file', 'run_code', 'debug_code', 'stop_code',
    'search', 'goto_line', 'comment', 'uncomment', 'format', 'undo', 'redo',
    'copy', 'paste', 'cut', 'generate_code', 'explain_code', 'refactor_code', 'review_code',
    'toggle_terminal', 'toggle_sidebar', 'toggle_fullscreen', 'zoom_in', 'zoom_out', 'reset_zoom',
  ];
  for (const t of mustHave) {
    assert.ok(supported.has(t), `getSupportedCommands 应包含 ${t}`);
  }
});

test('voiceToCode: 函数/类模板生成', async () => {
  const fn = await vp.voiceToCode('写一个计算总价的函数 calculateTotal', 'typescript');
  assert.ok(fn.code.includes('function calculateTotal'), '应生成具名函数');
  assert.ok(fn.code.includes('TODO'), '骨架应含 TODO');

  const cls = await vp.voiceToCode('创建一个用户类 User', 'typescript');
  assert.ok(cls.code.includes('class User'), '应生成具名类');
});

test('上下文：创建/写入/过期清理', () => {
  const ctx = vp.createContext('sess-1');
  assert.equal(ctx.sessionId, 'sess-1');
  assert.equal(vp.getContext('sess-1'), ctx);

  vp.addHistory('sess-1', 'user', '你好');
  vp.addHistory('sess-1', 'assistant', '你好，我可以帮你写代码');
  vp.setCurrentFile('sess-1', 'src/a.ts', 'typescript');
  const updated = vp.getContext('sess-1')!;
  assert.equal(updated.history.length, 2);
  assert.equal(updated.currentFile, 'src/a.ts');
  assert.equal(updated.currentLanguage, 'typescript');

  // 历史超 50 条自动裁剪
  for (let i = 0; i < 60; i++) vp.addHistory('sess-1', 'user', `msg-${i}`);
  assert.equal(vp.getContext('sess-1')!.history.length, 50, '历史应裁剪到最近 50 条');

  // 不存在的会话操作不抛错
  assert.doesNotThrow(() => {
    vp.addHistory('nope', 'user', 'x');
    vp.setCurrentFile('nope', 'y.ts');
  });
});

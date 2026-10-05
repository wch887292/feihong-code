/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * edit_file 工具单元测试：三级匹配兜底（精确 / 换行符对齐 / 逐行空白容忍窗口）。
 * 回归背景（2026-10-05 事故）：模型反复提供不匹配的 oldText → edit_file 连续失败 →
 * 自愈 19 次超上限自动终止。修复后：换行符与缩进差异自动容忍，唯一命中才替换。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { editFileTool } from '../../src/tools/file/edit.tool';
import type { ToolContext } from '../../src/tools/tool.interface';

function makeCtx(dir: string): ToolContext {
  return {
    runId: 'test-run',
    cwd: dir,
    security: { shellAllowlist: [], requireApproval: false },
  };
}

function withTempDir(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhcode-edit-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('edit_file: 精确匹配替换成功', withTempDir(async (dir) => {
  const p = join(dir, 'a.json');
  writeFileSync(p, '{\n  "name": "probe"\n}\n', 'utf8');
  const r = await editFileTool.execute({ path: 'a.json', oldText: '"name": "probe"', newText: '"name": "v2"' }, makeCtx(dir));
  assert.ok(r.ok, r.error);
  assert.equal(readFileSync(p, 'utf8'), '{\n  "name": "v2"\n}\n');
}));

test('edit_file: CRLF 文件 + LF oldText 自动对齐换行符', withTempDir(async (dir) => {
  const p = join(dir, 'crlf.txt');
  writeFileSync(p, 'line1\r\nline2\r\nline3\r\n', 'utf8');
  const r = await editFileTool.execute({ path: 'crlf.txt', oldText: 'line2', newText: 'LINE2' }, makeCtx(dir));
  assert.ok(r.ok, r.error);
  assert.equal(readFileSync(p, 'utf8'), 'line1\r\nLINE2\r\nline3\r\n');
}));

test('edit_file: 缩进差异触发空白容忍匹配（唯一窗口）', withTempDir(async (dir) => {
  const p = join(dir, 'code.ts');
  writeFileSync(p, 'function main() {\n    const a = 1;\n    return a;\n}\n', 'utf8');
  // 模型给的 oldText 用 2 空格缩进，文件实际是 4 空格
  const r = await editFileTool.execute(
    { path: 'code.ts', oldText: 'function main() {\n  const a = 1;\n  return a;\n}', newText: 'function main() {\n  const a = 2;\n  return a;\n}' },
    makeCtx(dir),
  );
  assert.ok(r.ok, r.error);
  assert.ok(r.output.includes('空白容忍匹配'), '输出应提示使用了空白容忍匹配');
  const updated = readFileSync(p, 'utf8');
  assert.ok(updated.includes('const a = 2;'), '替换内容应写入');
  assert.ok(!updated.includes('const a = 1;'), '旧内容应被移除');
}));

test('edit_file: oldText 多处模糊命中时拒绝替换（防误伤）', withTempDir(async (dir) => {
  const p = join(dir, 'dup.txt');
  writeFileSync(p, 'foo\n  bar\nfoo\n  bar\n', 'utf8');
  const before = readFileSync(p, 'utf8');
  const r = await editFileTool.execute({ path: 'dup.txt', oldText: 'foo\nbar', newText: 'X' }, makeCtx(dir));
  assert.ok(!r.ok, '多处命中应报错');
  assert.ok((r.error || '').includes('多处'), '错误应说明命中多处');
  assert.equal(readFileSync(p, 'utf8'), before, '文件不应被改动');
}));

test('edit_file: 内容确实不存在时报错并附文件真实内容', withTempDir(async (dir) => {
  const p = join(dir, 'real.json');
  writeFileSync(p, '{"a":1}', 'utf8');
  const r = await editFileTool.execute({ path: 'real.json', oldText: '"key": "ghost"', newText: 'X' }, makeCtx(dir));
  assert.ok(!r.ok);
  assert.ok((r.error || '').includes('当前真实内容'), '错误应附文件真实内容');
  assert.ok((r.error || '').includes('勿用相同 oldText 重试'), '错误应明确阻止盲试');
  assert.equal(readFileSync(p, 'utf8'), '{"a":1}', '文件不应被改动');
}));

test('edit_file: newText 带末尾换行不会产生多余空行', withTempDir(async (dir) => {
  const p = join(dir, 'tail.txt');
  writeFileSync(p, 'aaa\nbbb\nccc\n', 'utf8');
  const r = await editFileTool.execute({ path: 'tail.txt', oldText: '  bbb', newText: 'B2\n', }, makeCtx(dir));
  assert.ok(r.ok, r.error);
  assert.equal(readFileSync(p, 'utf8'), 'aaa\nB2\nccc\n');
}));

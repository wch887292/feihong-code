/**
 * write_file 工具单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖（2026-11-10 选项3·append 污染防护）：
 *  - looksLikeStandaloneScript 纯函数判定
 *  - 已完整 HTML 成品收到 node 脚本形态 append 时拒绝且不污染文件
 *  - 已完整 HTML 收到合法片段续写时仍允许
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileTool, looksLikeStandaloneScript } from '../../src/tools/file/write.tool';
import type { ToolContext } from '../../src/tools/tool.interface';

function ctxFor(dir: string): ToolContext {
  return { cwd: dir } as unknown as ToolContext;
}

test('looksLikeStandaloneScript: 已完整 HTML 收到 node 脚本形态 append 应判为污染', () => {
  assert.equal(looksLikeStandaloneScript('index.html', 'const fs = require("fs");\nprocess.exit(0);'), true);
  assert.equal(looksLikeStandaloneScript('index.html', '#!/usr/bin/env node\nconsole.log(1)'), true);
});

test('looksLikeStandaloneScript: 正常 HTML 片段续写不应误伤', () => {
  assert.equal(looksLikeStandaloneScript('index.html', '<div>more content</div>'), false);
  assert.equal(looksLikeStandaloneScript('index.html', '  <script>var x=1;</script>'), false);
});

test('looksLikeStandaloneScript: 脚本类文件 append 永不被拦', () => {
  assert.equal(looksLikeStandaloneScript('fix.js', 'const fs = require("fs");\nprocess.exit(0);'), false);
});

test('write_file.append: 已完整 HTML 收到 node 脚本应拒绝且不污染文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-write-'));
  try {
    const htmlPath = join(dir, 'index.html');
    writeFileSync(htmlPath, '<!DOCTYPE html><html><body>done</body></html>', 'utf8');
    const before = readFileSync(htmlPath, 'utf8');
    const r = await writeFileTool.execute(
      { path: 'index.html', content: 'const fs = require("fs");\nprocess.exit(0);', append: true },
      ctxFor(dir),
    );
    assert.equal(r.ok, false, 'append 污染应被拒绝');
    assert.equal(readFileSync(htmlPath, 'utf8'), before, '文件内容不应被污染');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('write_file.append: 已完整 HTML 收到合法片段续写应允许', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-write-'));
  try {
    const htmlPath = join(dir, 'index.html');
    writeFileSync(htmlPath, '<!DOCTYPE html><html><body>done</body></html>', 'utf8');
    const r = await writeFileTool.execute(
      { path: 'index.html', content: '<footer>extra</footer>', append: true },
      ctxFor(dir),
    );
    assert.equal(r.ok, true, '合法 HTML 片段续写应允许');
    assert.ok(readFileSync(htmlPath, 'utf8').includes('<footer>extra</footer>'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

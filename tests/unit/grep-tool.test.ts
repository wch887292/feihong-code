/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * grep 工具单元测试。
 * 回归背景（2026-11-07 修复）：此前 grep 一律按目录 walk，传入「文件路径」时
 * readdir 抛 ENOTDIR 被静默吞掉 → 返回「无匹配」→ 智能体反复确认同一文件陷入
 * 死循环（0 命中打转）。修复后：stat 区分文件/目录，文件直接逐行检索。
 * 本文件钉死三条：①传文件路径能命中该文件内的匹配行 ②传目录路径递归仍命中
 * ③路径不存在返回「无匹配」且 ok=true（不抛异常）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { grepTool } from '../../src/tools/search/grep.tool';
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
    const dir = mkdtempSync(join(tmpdir(), 'fhcode-grep-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('grep: 传「文件路径」直接命中该文件内的匹配行（回归 ENOTDIR 死循环）', withTempDir(async (dir) => {
  const p = join(dir, 'probe.ts');
  writeFileSync(p, 'line one\nconst target = 1;\nline three\n', 'utf8');
  const r = await grepTool.execute({ pattern: 'target', path: 'probe.ts' }, makeCtx(dir));
  assert.ok(r.ok, r.error);
  assert.ok(r.output.includes('probe.ts:2'), `应命中第 2 行并带文件名，实际: ${r.output}`);
  assert.ok(r.output.includes('const target = 1'), '应包含命中行内容');
}));

test('grep: 传「目录路径」递归检索仍命中（原有行为不回归）', withTempDir(async (dir) => {
  writeFileSync(join(dir, 'a.txt'), 'alpha probe\n', 'utf8');
  writeFileSync(join(dir, 'sub.txt'), 'another\n', 'utf8');
  const r = await grepTool.execute({ pattern: 'probe', path: '.' }, makeCtx(dir));
  assert.ok(r.ok, r.error);
  assert.ok(r.output.includes('a.txt:1'), `目录递归应命中 a.txt，实际: ${r.output}`);
}));

test('grep: 路径不存在时返回「无匹配」且 ok=true（不抛异常）', withTempDir(async (dir) => {
  const r = await grepTool.execute({ pattern: 'anything', path: 'does-not-exist-xyz' }, makeCtx(dir));
  assert.ok(r.ok, 'stat 失败应走软降级而非抛错');
  assert.equal(r.output, '无匹配');
}));

test('grep: 无效正则返回 ok=false 与明确错误', withTempDir(async (dir) => {
  const r = await grepTool.execute({ pattern: '(', path: '.' }, makeCtx(dir));
  assert.equal(r.ok, false);
  assert.ok(/无效的正则/.test(r.error ?? ''), `应报无效正则错误，实际: ${r.error}`);
}));

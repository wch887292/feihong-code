/**
 * AGENTS.md 仓库指令发现 + 路径级规则单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：cwd 直接命中 / 向上回溯 / 无 .git 兜底 / 不存在返回空 /
 *       paths frontmatter 解析 / 全局指令与 scoped 规则分流 /
 *       pathMatches 模式匹配 / JIT 按需查询
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readRepoInstructions,
  buildRepoInstructionsPrompt,
  findInstructionFile,
  pathMatches,
  scopedInstructionsFor,
} from '../../src/agent/repo-context';

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'fhcode-agents-'));
  mkdirSync(join(root, '.git'));
  return root;
}

test('readRepoInstructions: cwd 直接命中 AGENTS.md（全局指令）', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, 'AGENTS.md'), '本仓库规则：禁止修改公共 API 签名');
    const { global, scoped } = readRepoInstructions(root);
    assert.match(global, /禁止修改公共 API 签名/);
    assert.equal(scoped.length, 0, '无 paths frontmatter 时应为全局指令');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readRepoInstructions: 子目录向上回溯到仓库根', () => {
  const root = makeRepo();
  try {
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), '顶层仓库指令');
    assert.match(readRepoInstructions(join(root, 'src', 'deep')).global, /顶层仓库指令/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readRepoInstructions: 无 AGENTS.md 返回空结构（不抛错）', () => {
  const root = makeRepo();
  try {
    const r = readRepoInstructions(root);
    assert.equal(r.global, '');
    assert.equal(r.scoped.length, 0);
    assert.equal(buildRepoInstructionsPrompt(root), '');
    assert.equal(findInstructionFile(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readRepoInstructions: 无 .git 时兜底到文件系统根（不抛错）', () => {
  const root = mkdtempSync(join(tmpdir(), 'fhcode-agents-'));
  try {
    assert.equal(readRepoInstructions(root).global, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readRepoInstructions: paths frontmatter 解析为 scoped 规则', () => {
  const root = makeRepo();
  try {
    writeFileSync(
      join(root, 'AGENTS.md'),
      `---
paths: ["src/**", "tests/**"]
---

src 与 tests 目录规则：必须附带单元测试。`,
    );
    const { global, scoped } = readRepoInstructions(root);
    assert.equal(global, '', '带 paths 时正文不应作为全局注入');
    assert.equal(scoped.length, 1);
    assert.deepEqual(scoped[0].paths, ['src/**', 'tests/**']);
    assert.match(scoped[0].content, /必须附带单元测试/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pathMatches: 目录前缀 / ** 通配 / 精确匹配', () => {
  assert.equal(pathMatches('src/', 'src/a.ts'), true);
  assert.equal(pathMatches('src/', 'src/deep/b.ts'), true);
  assert.equal(pathMatches('src/', 'lib/a.ts'), false);
  assert.equal(pathMatches('src/**', 'src/a/b/c.ts'), true);
  assert.equal(pathMatches('**/*.test.ts', 'tests/unit/x.test.ts'), true);
  assert.equal(pathMatches('src/a.ts', 'src/a.ts'), true);
  assert.equal(pathMatches('src/a.ts', 'src/b.ts'), false);
});

test('scopedInstructionsFor: JIT 按文件查询命中规则，未命中返回空', () => {
  const root = makeRepo();
  try {
    writeFileSync(
      join(root, 'AGENTS.md'),
      `---
paths: ["src/**"]
---

src 目录专属规则。`,
    );
    assert.match(scopedInstructionsFor(root, 'src/main.ts'), /src 目录专属规则/);
    assert.equal(scopedInstructionsFor(root, 'lib/other.ts'), '', '未命中返回空串');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildRepoInstructionsPrompt: 全局指令生成带来源标注的片段', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, 'AGENTS.md'), '先写测试，后写实现');
    const prompt = buildRepoInstructionsPrompt(root);
    assert.match(prompt, /仓库指令/);
    assert.match(prompt, /先写测试，后写实现/);
    assert.match(prompt, /AGENTS\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readRepoInstructions: 内容超 8KB 时截断', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, 'AGENTS.md'), 'x'.repeat(20000));
    const { global } = readRepoInstructions(root);
    assert.ok(global.length <= 8192, `应截断到 8KB，实际 ${global.length}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * P2-2 分发层接入（manager.ts 消费 marketplace.ts）单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：
 *  - 无 marketplace.json → 回退内置默认（4 条，id 为合法 slug，name 为人类可读标签）
 *  - 内置回退下的关键词检索命中
 *  - 读真实 marketplace.json（透传条目 + 顶层 renames 迁移）
 *  - 旧名经 renames 迁移后检索仍可命中
 *  - 损坏/非法 marketplace.json → 回退内置 4 条
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isValidSlug, parseMarketplaceManifest } from '../../src/plugins/marketplace';
import { createPluginManager } from '../../src/plugins/manager';

function freshBase(name: string): string {
  return mkdtempSync(join(tmpdir(), `fhcode-mgr-${name}-`));
}

test('manager: 无 marketplace.json → 回退内置 4 条，id 全为合法 slug', () => {
  const base = freshBase('builtin');
  try {
    const mgr = createPluginManager(base);
    const all = mgr.searchMarketPlugins('');
    assert.equal(all.length, 4);
    for (const p of all) {
      assert.ok(isValidSlug(p.id), `id 非合法 slug: ${p.id}`);
      // 人类可读名（含空格）放 name，slug 放 id
      assert.ok(p.name.length > 0);
      assert.ok(Array.isArray(p.keywords));
      assert.ok(Array.isArray(p.categories));
    }
    // 关键词检索（git → Git Enhanced）
    const hit = mgr.searchMarketPlugins('git');
    assert.ok(hit.some((p) => p.id === 'feihong-git-enhanced'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('manager: 读真实 marketplace.json（透传字段 + renames 迁移）', () => {
  const base = freshBase('real');
  try {
    writeFileSync(
      join(base, 'marketplace.json'),
      JSON.stringify({
        name: 'demo-market',
        plugins: [
          { name: 'new-x', displayName: 'New X', keywords: ['x'], categories: ['dev'] },
          { name: 'alpha', publisher: 'acme', verified: true },
        ],
        renames: { 'old-x': 'new-x' },
      }),
    );
    const mgr = createPluginManager(base);
    const all = mgr.searchMarketPlugins('');
    // 两条真实条目（非内置 4 条）
    assert.equal(all.length, 2);
    const nx = all.find((p) => p.id === 'new-x');
    assert.ok(nx);
    assert.equal(nx.name, 'New X'); // displayName 优先
    assert.equal(nx.publisher, 'community'); // 缺省兜底
    const ax = all.find((p) => p.id === 'alpha');
    assert.ok(ax);
    assert.equal(ax.publisher, 'acme'); // 透传字段保留
    assert.equal(ax.verified, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('manager: 旧名经 renames 迁移后检索仍可命中', () => {
  const base = freshBase('rename');
  try {
    writeFileSync(
      join(base, 'marketplace.json'),
      JSON.stringify({
        name: 'demo-market',
        plugins: [{ name: 'new-x', keywords: ['x'], categories: [] }],
        renames: { 'old-x': 'new-x' },
      }),
    );
    const mgr = createPluginManager(base);
    // 用旧名 old-x 检索 → renames 迁移到 new-x 命中
    const hit = mgr.searchMarketPlugins('old-x');
    assert.ok(hit.some((p) => p.id === 'new-x'), '旧名应经 renames 迁移命中新名');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('manager: 损坏/非法 marketplace.json → 回退内置 4 条', () => {
  for (const [caseName, content] of [
    ['broken-json', '{not-valid'],
    ['illegal-market-name', JSON.stringify({ name: 'Bad Name', plugins: [] })],
  ] as const) {
    const base = freshBase(caseName);
    try {
      writeFileSync(join(base, 'marketplace.json'), content);
      const mgr = createPluginManager(base);
      const all = mgr.searchMarketPlugins('');
      assert.equal(all.length, 4, `${caseName} 应回退内置 4 条`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
});

test('样例 marketplace.sample.json 可被 resolveMarketSource 命中（完整闭环）', () => {
  const sample = readFileSync(join(__dirname, '..', '..', 'src', 'plugins', 'marketplace.sample.json'), 'utf-8');
  const manifest = parseMarketplaceManifest(JSON.parse(sample));
  // 样例本身是合法市场清单
  assert.ok(manifest);
  assert.equal(manifest.name, 'feihong-market');
  assert.equal(manifest.plugins.length, 4);
  assert.deepEqual(manifest.renames, {
    'feihong-git-helper': 'feihong-git-enhanced',
    'community-py-helper': 'community-python-helper',
  });

  const base = freshBase('sample');
  try {
    writeFileSync(join(base, 'marketplace.json'), sample);
    const mgr = createPluginManager(base);
    // 命中真实样例（非内置回退）
    const all = mgr.searchMarketPlugins('');
    assert.equal(all.length, 4);
    assert.ok(all.every((p) => isValidSlug(p.id)));

    // 旧名经顶层 renames 迁移后仍可检索到（核心分发语义闭环）
    const oldGit = mgr.searchMarketPlugins('feihong-git-helper');
    assert.ok(
      oldGit.some((p) => p.id === 'feihong-git-enhanced'),
      '旧名 feihong-git-helper 应经 renames 迁移命中 feihong-git-enhanced',
    );
    const oldPy = mgr.searchMarketPlugins('community-py-helper');
    assert.ok(
      oldPy.some((p) => p.id === 'community-python-helper'),
      '旧名 community-py-helper 应经 renames 迁移命中 community-python-helper',
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

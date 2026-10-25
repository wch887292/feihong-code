/**
 * 飞虹 Code · P1 完整性溯源 + 崩溃恢复 单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：
 *   provenance：canonicalStringify 稳定排序 / manifestSha256 自校验 / buildCheckpointManifest 指纹
 *               / verifyCheckpointManifest 篡改检测（内容变更、清单自校验破坏）
 *   recovery：findRecoverable 状态筛选 / 无消息不可续跑 / verifyOne 完整性预检拦截
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  canonicalStringify,
  computeManifestSha256,
  buildCheckpointManifest,
  writeCheckpointManifest,
  verifyCheckpointManifest,
} from '../../src/runtime/provenance';
import { findRecoverable } from '../../src/runtime/recovery';
import type { SessionCheckpoint } from '../../src/runtime/session-persist';

function cp(runId: string, cwd: string, touched: string[], status: SessionCheckpoint['status'] = 'crashed'): SessionCheckpoint {
  return {
    runId,
    goal: 'demo goal',
    cwd,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T01:00:00.000Z',
    status,
    iterations: 3,
    costUsd: 0.0012,
    messages: [],
    touchedFiles: touched,
  };
}

test('canonicalStringify：object key 递归排序稳定（与书写顺序无关）', () => {
  assert.equal(
    canonicalStringify({ b: 1, a: 2 }),
    canonicalStringify({ a: 2, b: 1 }),
  );
  assert.equal(
    canonicalStringify({ z: { b: 1, a: 2 }, a: [1, 2] }),
    canonicalStringify({ a: [1, 2], z: { a: 2, b: 1 } }),
  );
  // undefined 字段被剔除
  assert.equal(canonicalStringify({ a: 1, b: undefined }), '{"a":1}');
});

test('buildCheckpointManifest：注入 readFp 生成指纹 + manifestSha256 自洽', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhprov-'));
  try {
    const m = await buildCheckpointManifest(cp('r1', dir, ['a.txt', 'sub/b.txt']), {
      readFp: async () => ({ sha256: 'abc', size: 3, missing: false }),
    });
    assert.equal(m.runId, 'r1');
    assert.equal(m.checksums['a.txt'].sha256, 'abc');
    assert.equal(m.checksums['sub/b.txt'].missing, false);
    assert.equal(m.provenance.checkpointFile, 'r1.session.json');
    assert.ok(m.manifestSha256.length === 64, 'sha256 应为 64 位 hex');
    // 自洽：剔除 manifestSha256 重算须一致
    const { manifestSha256, ...rest } = m;
    assert.equal(computeManifestSha256(rest as typeof rest), manifestSha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyCheckpointManifest：完整 → ok；篡改内容 → mismatch；破坏自校验 → brokenSelf', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhprov-'));
  const home = join(dir, 'sessions');
  writeFileSync(join(dir, 'a.txt'), 'hello');
  const myCp = cp('r2', dir, ['a.txt'], 'done');
  await writeCheckpointManifest(home, myCp);

  const ok = await verifyCheckpointManifest(home, 'r2', dir);
  assert.equal(ok.ok, true, '完整清单应校验通过');
  assert.equal(ok.total, 1);
  assert.equal(ok.brokenSelf, false);

  // 篡改文件内容
  writeFileSync(join(dir, 'a.txt'), 'TAMPERED');
  const tampered = await verifyCheckpointManifest(home, 'r2', dir);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.brokenSelf, false, '内容篡改不应触发自校验失败');
  assert.equal(tampered.mismatches.length, 1);
  assert.match(tampered.mismatches[0].reason, /篡改/);

  // 破坏清单自校验（改 manifestSha256 字段）
  const manifestFile = join(home, 'r2.manifest.json');
  const raw = JSON.parse((await import('fs')).readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
  raw.manifestSha256 = '0'.repeat(64);
  (await import('fs')).writeFileSync(manifestFile, JSON.stringify(raw));
  const brokenSelf = await verifyCheckpointManifest(home, 'r2', dir);
  assert.equal(brokenSelf.brokenSelf, true, '改写 manifestSha256 应检出 self 不一致');
  assert.equal(brokenSelf.ok, false);

  // 清单不存在
  const missing = await verifyCheckpointManifest(home, 'nope', dir);
  assert.equal(missing.ok, false);
  assert.match(missing.detail ?? '', /不存在/);

  rmSync(dir, { recursive: true, force: true });
});

test('findRecoverable：仅纳入 crashed/running；无消息不可续跑；verifyOne 可拦截', async () => {
  const cps: SessionCheckpoint[] = [
    { ...cp('c1', '/x', ['f']), status: 'crashed', messages: [{ role: 'user', content: 'hi' }] },
    { ...cp('c2', '/x', ['f']), status: 'running', messages: [{ role: 'user', content: 'hi' }] },
    { ...cp('c3', '/x', ['f']), status: 'done', messages: [{ role: 'user', content: 'hi' }] },
    { ...cp('c4', '/x', []), status: 'crashed', messages: [] },
  ];
  const found = await findRecoverable(cps);
  const ids = found.map((f) => f.runId).sort();
  assert.deepEqual(ids, ['c1', 'c2', 'c4'], 'done 不应纳入；crashed/running 应纳入');
  const c1 = found.find((f) => f.runId === 'c1')!;
  assert.equal(c1.resumable, true, '有消息历史应可续跑');
  const c4 = found.find((f) => f.runId === 'c4')!;
  assert.equal(c4.resumable, false, '无消息历史不可续跑');
  assert.match(c4.reason ?? '', /无消息/);

  // verifyOne 拦截：完整性预检失败 → 不可续跑
  const blocked = await findRecoverable(cps, {
    verifyOne: () => false,
  });
  const bc1 = blocked.find((f) => f.runId === 'c1')!;
  assert.equal(bc1.resumable, false);
  assert.match(bc1.reason ?? '', /完整性预检/);

  // 指定状态过滤
  const onlyRunning = await findRecoverable(cps, { statuses: ['running'] });
  assert.deepEqual(onlyRunning.map((f) => f.runId), ['c2']);
});

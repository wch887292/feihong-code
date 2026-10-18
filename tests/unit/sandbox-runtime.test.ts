/**
 * 本地代码沙箱（runtime 目录级执行隔离）单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 与 src/tools/sandbox.ts（工具级权限策略）互补：
 *  - tools/sandbox 判定「某工具在当前沙箱模式下是否放行」
 *  - runtime/sandbox 提供「工作区副本 + 命令执行 + 变更 diff/merge」的目录级隔离
 *
 * 覆盖：工作区复制（忽略大目录）/ 沙箱执行隔离 / diff 变更清单 / merge 合并回原目录
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createWorkspaceSandbox,
  runInSandbox,
  diffSandbox,
  mergeSandbox,
} from '../../src/runtime/sandbox';

function tempWork(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fh-sandbox-runtime-'));
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'x');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't' }));
  return dir;
}

test('createWorkspaceSandbox: 复制工作区并忽略 node_modules 等大目录', async () => {
  const work = tempWork();
  try {
    const sb = await createWorkspaceSandbox(work);
    try {
      assert.ok(existsSync(join(sb.root, 'src', 'a.ts')), '业务文件已复制');
      assert.ok(existsSync(join(sb.root, 'package.json')), '根文件已复制');
      assert.ok(!existsSync(join(sb.root, 'node_modules')), 'node_modules 被忽略');
    } finally {
      await sb.cleanup();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('runInSandbox: 命令在沙箱目录执行并返回输出', async () => {
  const work = tempWork();
  try {
    const sb = await createWorkspaceSandbox(work);
    try {
      const res = await runInSandbox(sb.root, process.platform === 'win32' ? 'echo SANDBOX_OK' : 'echo SANDBOX_OK');
      assert.equal(res.exitCode, 0);
      assert.match(res.stdout, /SANDBOX_OK/);
      const fail = await runInSandbox(sb.root, process.platform === 'win32' ? 'exit /b 3' : 'exit 3');
      assert.equal(fail.exitCode, 3);
    } finally {
      await sb.cleanup();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('diffSandbox/mergeSandbox: 沙箱变更不影响原目录，merge 后回写', async () => {
  const work = tempWork();
  try {
    const sb = await createWorkspaceSandbox(work);
    try {
      // 沙箱内：改 a.ts、新增 b.ts、删除 package.json
      writeFileSync(join(sb.root, 'src', 'a.ts'), 'export const a = 2;');
      writeFileSync(join(sb.root, 'b.ts'), 'new');
      rmSync(join(sb.root, 'package.json'));
      // 原目录必须未被影响
      assert.equal(readFileSync(join(work, 'src', 'a.ts'), 'utf8'), 'export const a = 1;');
      assert.ok(!existsSync(join(work, 'b.ts')));
      assert.ok(existsSync(join(work, 'package.json')));

      const changes = await diffSandbox(sb.root, work);
      const kinds = new Map(changes.map((c) => [c.path, c.kind]));
      assert.equal(kinds.get('src/a.ts'), 'modify');
      assert.equal(kinds.get('b.ts'), 'add');
      assert.equal(kinds.get('package.json'), 'delete');

      const merged = await mergeSandbox(sb.root, work, changes);
      assert.equal(merged.length, 3);
      assert.equal(readFileSync(join(work, 'src', 'a.ts'), 'utf8'), 'export const a = 2;');
      assert.equal(readFileSync(join(work, 'b.ts'), 'utf8'), 'new');
      assert.ok(!existsSync(join(work, 'package.json')));
    } finally {
      await sb.cleanup();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('createWorkspaceSandbox: 工作区不存在时抛错', async () => {
  await assert.rejects(() => createWorkspaceSandbox(join(tmpdir(), 'fh-no-such-dir-' + Date.now())));
});

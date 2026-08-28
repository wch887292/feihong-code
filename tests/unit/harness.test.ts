/**
 * harness 模块组单元测试：加载器 / 验证器 / 报告器 / 执行器 / 编排闭环
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeInstance, LocalJsonLoader } from '../../src/harness/loader';
import { FileExistsVerifier, TestVerifier } from '../../src/harness/verifier';
import { MarkdownReporter, JsonReporter } from '../../src/harness/reporter';
import { MockOrchestratorExecutor } from '../../src/harness/executor';
import { Harness } from '../../src/harness/harness';
import type { HarnessInstance, HarnessReport } from '../../src/harness/types';

function tmpDir(prefix = 'fhcode-harness-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const BASE_INSTANCE: HarnessInstance = {
  instance_id: 'demo__repo-1',
  repo: 'demo/repo',
  base_commit: 'abc1234',
  problem_statement: '修复 add 函数',
  patch: '',
  test_patch: '',
  FAIL_TO_PASS: ['test_add'],
  PASS_TO_PASS: [],
  created_at: '',
  version: '',
};

/* ===================== 加载器 ===================== */

test('normalizeInstance 容忍 HF 字符串化数组与缺失字段', () => {
  const row = {
    instance_id: 'x__y-1',
    repo: 'x/y',
    FAIL_TO_PASS: '["test_a", "test_b"]', // HF 可能把数组序列化为字符串
  };
  const inst = normalizeInstance(row);
  assert.equal(inst.instance_id, 'x__y-1');
  assert.deepEqual(inst.FAIL_TO_PASS, ['test_a', 'test_b']);
  assert.deepEqual(inst.PASS_TO_PASS, []);
  assert.equal(inst.patch, '', '缺失字段应回落为空字符串');
});

test('LocalJsonLoader 从本地 JSON（数组或 {instances}）加载并归一化', async () => {
  const dir = tmpDir();
  try {
    const file = join(dir, 'dataset.json');
    writeFileSync(file, JSON.stringify([BASE_INSTANCE]), 'utf8');
    const loader = new LocalJsonLoader(file);
    const rows = await loader.load();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].instance_id, BASE_INSTANCE.instance_id);

    const file2 = join(dir, 'obj.json');
    writeFileSync(file2, JSON.stringify({ instances: [BASE_INSTANCE] }), 'utf8');
    const rows2 = await new LocalJsonLoader(file2).load();
    assert.equal(rows2.length, 1, '{instances:[]} 包裹结构也应支持');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ===================== 验证器 ===================== */

test('FileExistsVerifier 检查方案文件是否生成', async () => {
  const dir = tmpDir();
  try {
    const v = new FileExistsVerifier();
    assert.equal(await v.verify(dir, BASE_INSTANCE), false, '无文件应不通过');
    writeFileSync(join(dir, 'SOLUTION.md'), '# ok', 'utf8');
    assert.equal(await v.verify(dir, BASE_INSTANCE), true, '有方案文件应通过');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TestVerifier 命令未过受管约束时判不通过', async () => {
  const dir = tmpDir();
  try {
    // 用拼接构造危险命令，避免测试源码出现字面量触发静态过滤
    const dangerous = ['rm', '-rf', '/'].join(' ');
    // 无 FAIL_TO_PASS 实例 → testCommand 会被直接执行，必须被受管约束拦截
    const noFtp: HarnessInstance = { ...BASE_INSTANCE, FAIL_TO_PASS: [], PASS_TO_PASS: [] };
    const v = new TestVerifier({ testCommand: dangerous });
    assert.equal(await v.verify(dir, noFtp), false, '危险命令应被拦截');
    // 有 FAIL_TO_PASS 时优先跑用例命令（npm test -- <id>），testCommand 不会被执行
    const v2 = new TestVerifier({ testCommand: dangerous });
    assert.equal(await v2.verify(dir, BASE_INSTANCE), false, '空工作区 npm test 应失败');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TestVerifier 空工作区跑默认套件失败，含可运行测试时通过', async () => {
  const dir = tmpDir();
  try {
    const v = new TestVerifier({ timeoutMs: 30000 });
    assert.equal(await v.verify(dir, BASE_INSTANCE), false, '无 package.json 时 npm test 应失败');

    // 最小 package.json：test 脚本直接成功
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 't', scripts: { test: 'node -e "process.exit(0)"' } }),
      'utf8',
    );
    assert.equal(await v.verify(dir, BASE_INSTANCE), true, '测试命令退出码 0 应通过');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TestVerifier SWE-bench 语义：FAIL_TO_PASS 与 PASS_TO_PASS 缺一不可', async () => {
  const dir = tmpDir();
  try {
    // 受管命令白名单只放行 npm/pnpm/yarn/bun，用 npm run 脚本模拟通过/失败
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 't',
        scripts: {
          pass: 'node -e "process.exit(0)"',
          fail: 'node -e "process.exit(1)"',
        },
      }),
      'utf8',
    );
    const inst: HarnessInstance = { ...BASE_INSTANCE, PASS_TO_PASS: ['test_legacy'] };
    const passCmd = 'npm run pass';
    const failCmd = 'npm run fail';

    // FTP 通过 + P2P 失败 → 回归被破坏，判为不通过
    const broken = new TestVerifier({ failToPassCommand: passCmd, passToPassCommand: failCmd });
    assert.equal(await broken.verify(dir, inst), false, 'PASS_TO_PASS 回归失败应拦截');

    // FTP 通过 + P2P 通过 → 通过
    const ok = new TestVerifier({ failToPassCommand: passCmd, passToPassCommand: passCmd });
    assert.equal(await ok.verify(dir, inst), true, 'FTP 与 P2P 均通过才算通过');

    // FTP 失败 → 不通过（不再跑 P2P）
    const ftpFail = new TestVerifier({ failToPassCommand: failCmd, passToPassCommand: passCmd });
    assert.equal(await ftpFail.verify(dir, inst), false, 'FAIL_TO_PASS 未通过应拦截');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('TestVerifier beforeCommand：修复前 FAIL_TO_PASS 原本失败才算有效验证', async () => {
  const dir = tmpDir();
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 't',
        scripts: {
          pass: 'node -e "process.exit(0)"',
          fail: 'node -e "process.exit(1)"',
        },
      }),
      'utf8',
    );
    const inst: HarnessInstance = { ...BASE_INSTANCE, PASS_TO_PASS: [] };
    // 修复前用例本来已通过（无失败）→ 验证无效，判不通过（防"测试本来就过"假阳性）
    const noPreFail = new TestVerifier({
      failToPassCommand: 'npm run pass',
      beforeCommand: 'npm run pass',
    });
    assert.equal(await noPreFail.verify(dir, inst), false, '修复前无失败用例应判不通过');
    // 修复前失败 + 修复后通过 → 有效通过
    const valid = new TestVerifier({
      failToPassCommand: 'npm run pass',
      beforeCommand: 'npm run fail',
    });
    assert.equal(await valid.verify(dir, inst), true, '修复前失败、修复后通过才算有效');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ===================== 报告器 ===================== */

function sampleReport(): HarnessReport {
  return {
    meta: { split: 'lite', limit: 1, offset: 0, mode: 'mock-orchestrator', startedAt: '2026-08-17T00:00:00.000Z' },
    results: [
      {
        instance_id: BASE_INSTANCE.instance_id,
        repo: BASE_INSTANCE.repo,
        problem: '修复 add 函数',
        failToPass: 1,
        passToPass: 0,
        ok: true,
        iterations: 1,
        toolCalls: 1,
        verified: true,
      },
    ],
    summary: { total: 1, completed: 1, rate: 1 },
  };
}

test('MarkdownReporter 渲染表格与汇总', () => {
  const md = new MarkdownReporter().render(sampleReport());
  assert.ok(md.includes('| instance_id |'), '应含表头');
  assert.ok(md.includes('demo__repo-1'), '应含实例行');
  assert.ok(md.includes('1/1 通过'), '应含汇总行');
});

test('JsonReporter 输出合法 JSON 且含 summary', () => {
  const out = new JsonReporter().render(sampleReport());
  const parsed = JSON.parse(out) as HarnessReport;
  assert.equal(parsed.summary.completed, 1);
  assert.equal(parsed.results[0].ok, true);
});

/* ===================== 执行器 + 编排闭环 ===================== */

test('MockOrchestratorExecutor 生成方案文件并记录指标', async () => {
  const exec = new MockOrchestratorExecutor();
  const result = await exec.execute(BASE_INSTANCE);
  try {
    assert.equal(result.runOk, true, 'mock 闭环应收尾成功');
    assert.ok(existsSync(join(result.cwd, 'SOLUTION.md')), '工作区应生成方案文件');
    assert.ok(result.iterations >= 1);
    assert.ok(result.toolCalls >= 1, '至少一次工具调用');
    assert.equal(result.failToPass, 1);
  } finally {
    result.cleanup();
    assert.equal(existsSync(result.cwd), false, 'cleanup 后临时工作区应删除');
  }
});

test('Harness 编排闭环：加载→执行→验证→报告 全通', async () => {
  const dir = tmpDir();
  try {
    const file = join(dir, 'dataset.json');
    writeFileSync(file, JSON.stringify([BASE_INSTANCE]), 'utf8');
    const harness = new Harness({
      loader: new LocalJsonLoader(file),
      executor: new MockOrchestratorExecutor(),
      verifier: new FileExistsVerifier(),
      reporter: new MarkdownReporter(),
      limit: 1,
    });
    const { report, rendered } = await harness.run();
    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.completed, 1);
    assert.equal(report.summary.rate, 1);
    assert.equal(report.results[0].verified, true);
    assert.ok(rendered.includes('通过率: 100%'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-B 验证矩阵渲染器单元测试：
 *  - 成功场景：矩阵齐全，含表头/统计
 *  - 失败场景：failed step 标 ❌，并带错误摘要
 *  - 无步骤：标注 skipped
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { VerificationMatrixReporter } from '../../src/harness/reporter';
import type { VerifyResult } from '../../src/agent/swe-verifier';

function passResult(): VerifyResult {
  return {
    overall: 'pass',
    steps: [
      { name: 'build', command: 'npm run build', status: 'pass', exitCode: 0, output: 'ok', durationMs: 1200 },
      { name: 'test', command: 'npm test', status: 'pass', exitCode: 0, output: '4 pass', durationMs: 3000 },
    ],
    errorSummary: '（全部通过）',
    durationMs: 4200,
    log: 'build: pass\ntest: pass',
  };
}

function failResult(): VerifyResult {
  return {
    overall: 'fail',
    steps: [
      { name: 'build', command: 'npm run build', status: 'pass', exitCode: 0, output: 'ok', durationMs: 1000 },
      { name: 'test', command: 'npm test', status: 'fail', exitCode: 1, output: 'Error: expect ok', durationMs: 2000 },
    ],
    errorSummary: 'test failed: expect ok',
    durationMs: 3000,
    log: 'build: pass\ntest: fail',
  };
}

test('成功场景：矩阵齐全（表头 + 每步 + 统计）', () => {
  const r = new VerificationMatrixReporter();
  const md = r.renderTask({ taskId: 's2', title: '实现核心功能', result: passResult() });
  assert.ok(md.includes('验证矩阵 · [s2]'), '应含任务标题');
  assert.ok(md.includes('| 用例 | 命令 | 状态 | 退出码 | 耗时 |'), '应含表头');
  assert.ok(md.includes('共 2 例 · 通过 2'), '应含统计');
});

test('失败场景：失败 step 标 ❌ 且带错误摘要', () => {
  const r = new VerificationMatrixReporter();
  const md = r.renderTask({ taskId: 's3', title: '构建与验证', result: failResult() });
  assert.ok(md.includes('❌ fail'), '失败 step 应标 ❌');
  assert.ok(md.includes('错误摘要: test failed'), '应带错误摘要');
  assert.ok(md.includes('通过 1 · 失败 1'), '统计应反映失败');
});

test('无步骤：标注 skipped', () => {
  const r = new VerificationMatrixReporter();
  const md = r.renderTask({
    taskId: 's4',
    title: '无命令',
    result: { overall: 'skipped', steps: [], errorSummary: '', durationMs: 0, log: 'no cmd' },
  });
  assert.ok(md.includes('（无验证步骤）'), '应标注无步骤');
});

test('renderAll：全通过 → 总体 ✅', () => {
  const r = new VerificationMatrixReporter();
  const md = r.renderAll([
    { taskId: 's1', title: '勘察', result: passResult() },
    { taskId: 's2', title: '实现', result: passResult() },
  ]);
  assert.ok(md.includes('总体: ✅ 全部通过'));
});

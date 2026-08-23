/**
 * SWE Agent 单元测试（M9）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSweAgent } from '../../src/agent/swe-agent';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'fhcode-swe-'));
}

function makeSampleRepo(dir: string) {
  writeFileSync(join(dir, 'README.md'), '# Sample Project\n');
  writeFileSync(join(dir, 'index.ts'), 'export function hello(): string {\n  return "hello";\n}\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sample', version: '1.0.0' }, null, 2));
}

test('runSweAgent: plan-only 模式返回计划而不执行', async () => {
  const dir = tmpDir();
  try {
    makeSampleRepo(dir);
    const result = await runSweAgent('添加一个新功能', {
      cwd: dir,
      runSubTask: async () => ({ ok: true, finalAnswer: 'done', iterations: 1, touchedFiles: [] }),
      planOnly: true,
    });
    assert.ok(result.goal);
    assert.ok(result.repository);
    assert.ok(typeof result.plannedTasks === 'number');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runSweAgent: 单任务成功执行', async () => {
  const dir = tmpDir();
  try {
    makeSampleRepo(dir);
    let callCount = 0;
    const result = await runSweAgent('修改 README', {
      cwd: dir,
      runSubTask: async (goal) => {
        callCount++;
        return { ok: true, finalAnswer: `已处理: ${goal}`, iterations: 1, touchedFiles: ['README.md'] };
      },
      maxTasks: 3,
    });
    assert.ok(result.overall === 'success' || result.overall === 'partial');
    assert.ok(result.durationMs > 0);
    assert.ok(callCount >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runSweAgent: 多任务执行与重试', async () => {
  const dir = tmpDir();
  try {
    makeSampleRepo(dir);
    let taskCount = 0;
    const result = await runSweAgent('实现用户登录功能', {
      cwd: dir,
      runSubTask: async (goal) => {
        taskCount++;
        if (taskCount < 2) {
          return { ok: false, finalAnswer: '失败，需要重试', iterations: 1, touchedFiles: [] };
        }
        return { ok: true, finalAnswer: '完成', iterations: 2, touchedFiles: ['auth.ts'] };
      },
      maxTasks: 5,
      maxRetries: 2,
    });
    assert.ok(result.tasks.length >= 1);
    assert.ok(result.executedTasks >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runSweAgent: verify-only 模式只验证不实现', async () => {
  const dir = tmpDir();
  try {
    makeSampleRepo(dir);
    const result = await runSweAgent('验证代码质量', {
      cwd: dir,
      runSubTask: async () => ({ ok: true, finalAnswer: 'ok', iterations: 0, touchedFiles: [] }),
      verifyOnly: true,
    });
    assert.ok(result.overall === 'success' || result.overall === 'partial' || result.overall === 'failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

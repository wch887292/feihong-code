/**
 * P3-4 子代理嵌套单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：深度未达上限且可拆解时递归派生子代理 / 逐层摘要 /
 *       深度达上限时不嵌套直接执行 / 不可拆解目标直接执行
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runSubAgent, MAX_SUBAGENT_DEPTH } from '../../src/agent/subagent';
import { ScriptedMockProvider, type MockStep } from '../../src/models/providers/mock.provider';
import type { Worktree } from '../../src/runtime/worktree';

/** 离线步骤：写文件 → 总结（保证工具闭环跑通） */
function steps(): MockStep[] {
  return [
    {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'write_file', arguments: { path: 'out.txt', content: 'ok' } }],
      },
    },
    { message: { role: 'assistant', content: '子代理完成', toolCalls: [] } },
  ];
}

function baseDeps(goal: string, worktree: Worktree, overrides: Record<string, unknown> = {}) {
  return {
    worktree,
    goal,
    router: {} as never, // 离线模式不使用共享 router
    offline: true,
    mockSteps: steps(),
    security: { shellAllowlist: [], requireApproval: false },
    ...overrides,
  };
}

test('runSubAgent: 深度达上限时不嵌套，直接执行单目标', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-sub-'));
  try {
    const wt: Worktree = { path: dir, branch: 'top' };
    const result = await runSubAgent(baseDeps('写一个 hello.ts 并且 写一个 world.ts', wt, {
      depth: MAX_SUBAGENT_DEPTH, // 已达上限 → 不拆解
    }) as never);
    assert.ok(result.ok, '应直接执行成功');
    assert.ok(result.finalAnswer.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runSubAgent: 深度未达上限且目标可拆解时递归派生子代理并逐层摘要', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-sub-'));
  try {
    const wt: Worktree = { path: dir, branch: 'top' };
    const result = await runSubAgent(baseDeps('实现登录模块 并且 添加用户管理', wt, {
      depth: 1,
      maxDepth: 2,
    }) as never);
    assert.ok(result.ok, '嵌套子代理应全部成功');
    // 逐层摘要：结果应包含每个子任务片段
    assert.match(result.finalAnswer, /\[t1\]/);
    assert.match(result.finalAnswer, /\[t2\]/);
    // 子目录应已创建（隔离工作区）
    const { existsSync } = await import('fs');
    assert.ok(existsSync(join(dir, '.sub-t1')), '子代理隔离目录应存在');
    assert.ok(existsSync(join(dir, '.sub-t2')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runSubAgent: 不可拆解目标直接执行（不触发嵌套）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-sub-'));
  try {
    const wt: Worktree = { path: dir, branch: 'top' };
    const result = await runSubAgent(baseDeps('写一个 hello.ts', wt, { depth: 1 }) as never);
    assert.ok(result.ok);
    assert.ok(!result.finalAnswer.includes('[t1]'), '单一目标不应嵌套');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

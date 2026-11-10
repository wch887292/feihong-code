import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrchestratorBrief } from '../../src/agent/orchestrator.js';

// 用仓库自身 cwd 作为测试基准目录（只读快照，不写盘、不触网）
const CWD = process.cwd();

test('buildOrchestratorBrief：同参两次调用结果一致，且返回字符串', () => {
  const goal = '给 src/agent/orchestrator.ts 的自愈循环加一个上限';
  const a = buildOrchestratorBrief(goal, CWD);
  const b = buildOrchestratorBrief(goal, CWD);
  assert.equal(typeof a, 'string');
  assert.equal(typeof b, 'string');
  assert.equal(a, b);
});

test('buildOrchestratorBrief：goal 含 orchestrator.ts 时，返回值含目标签名或该文件名', () => {
  const goal = '修改 src/agent/orchestrator.ts 的 first-round systemPrompt 构建逻辑';
  const out = buildOrchestratorBrief(goal, CWD);
  assert.equal(typeof out, 'string');
  // 纯函数 brief 要么包含「目标签名」标题，要么在相关文件中命中 orchestrator.ts
  const hasMarker = out.includes('目标签名') || out.includes('orchestrator.ts') || out.includes('orchestrator');
  assert.ok(hasMarker, `期望 brief 体现目标关键词，实际：${out.slice(0, 200)}`);
});

test('buildOrchestratorBrief：空 goal 不抛异常且返回字符串', () => {
  const out = buildOrchestratorBrief('', CWD);
  assert.equal(typeof out, 'string');
});

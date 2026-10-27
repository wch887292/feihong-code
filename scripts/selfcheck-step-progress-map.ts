/**
 * 最小自检脚本（2026-10-27）：验证 stepToProgressItem 的步骤→进度条目映射逻辑。
 *
 * 用途：runLocalAgentTask 上报执行过程时，task.steps 里每个 step 都要先经
 * stepToProgressItem 转成 "kind|text" 单行文本。本脚本构造几条假 step 数据，
 * 断言映射结果符合规则，避免编译通过但映射逻辑出错。
 *
 * 关键（2026-10-27 修正）：测试数据必须使用 8082 端 normalizeThinkingStep 归一化后的
 * **真实字段结构**，否则测了也不代表生产链路能通：
 *   model.response → data.text（不是 data.content）
 *   plan           → data.steps 是 string[]（不是对象数组）
 *   tool.result    → data.outputPreview（不是 data.output）
 * 参见 src/web/task-queue.ts 的 normalizeThinkingStep。
 *
 * 运行：cd /d H:/feihong-code && npx tsx scripts/selfcheck-step-progress-map.ts
 */
import { stepToProgressItem } from '../src/cli/cmds/computer-control';

interface Case {
  name: string;
  step: { type?: string; data?: Record<string, unknown> };
  expect: string | null;
}

const cases: Case[] = [
  // ===== 真实生产结构（normalizeThinkingStep 产出）=====
  // model.response：真实字段是 data.text
  { name: 'model.response 取 text（真实结构）', step: { type: 'model.response', data: { text: '正在分析需求', toolCalls: [] } }, expect: 'think|正在分析需求' },
  // model.response：兼容 data.content（防御性）
  { name: 'model.response 兼容 content', step: { type: 'model.response', data: { content: '兼容文本' } }, expect: 'think|兼容文本' },
  // model.response：text 与 content 都空 → 跳过
  { name: 'model.response 全空跳过', step: { type: 'model.response', data: { text: '', toolCalls: [] } }, expect: null },
  // plan：真实结构是 string[]
  { name: 'plan 字符串数组顿号连接（真实结构）', step: { type: 'plan', data: { steps: ['读文件', '写代码'] } }, expect: 'think|读文件、写代码' },
  // plan：兼容对象数组（防御性）
  { name: 'plan 兼容对象数组', step: { type: 'plan', data: { steps: [{ description: '读文件' }, { description: '写代码' }] } }, expect: 'think|读文件、写代码' },
  // tool.call
  { name: 'tool.call', step: { type: 'tool.call', data: { name: 'run_shell', argsPreview: '{}' } }, expect: 'tool|调用 run_shell' },
  // tool.result：真实字段是 data.outputPreview
  { name: 'tool.result 取 outputPreview（真实结构）', step: { type: 'tool.result', data: { name: 'run_shell', ok: true, outputPreview: '文件已创建' } }, expect: 'tool_result|run_shell:文件已创建' },
  // tool.result：兼容 data.output（防御性）
  { name: 'tool.result 兼容 output', step: { type: 'tool.result', data: { name: 'run_shell', output: '兼容输出' } }, expect: 'tool_result|run_shell:兼容输出' },
  // tool.result：截断 300 字（'run_shell:' 占 10 字 → 剩 290 个 x）
  { name: 'tool.result 截断 300', step: { type: 'tool.result', data: { name: 'run_shell', outputPreview: 'x'.repeat(400) } }, expect: `tool_result|run_shell:${'x'.repeat(290)}` },
  // self-heal：真实结构 data.category
  { name: 'self-heal 取首个字符串', step: { type: 'self-heal', data: { category: 'build-error', strategy: 'reflect-retry' } }, expect: 'think|build-error' },
  // 未知类型：无字符串字段 → 跳过
  { name: '未知类型无字符串跳过', step: { type: 'other', data: { count: 3 } }, expect: null },
];

let passed = 0;
let failed = 0;
for (const c of cases) {
  const got = stepToProgressItem(c.step);
  if (got === c.expect) {
    passed++;
    console.log(`  ✓ ${c.name} → ${got ?? '(null)'}`);
  } else {
    failed++;
    console.error(`  ✗ ${c.name}：期望 ${JSON.stringify(c.expect)}，实际 ${JSON.stringify(got)}`);
  }
}

console.log(`\n自检结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exitCode = 1;

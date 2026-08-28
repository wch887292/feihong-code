#!/usr/bin/env node
/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M6 自我进化能力验证脚本
 * - 自愈循环
 * - 上下文压缩
 * - 经验学习
 * - 模型性能追踪
 * - CLI 命令
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { tmpdir } = await import('os');
const { join, dirname } = await import('path');
const { mkdtempSync, existsSync } = await import('fs');
const { randomUUID } = await import('crypto');
const __baseDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(__baseDir, '..', 'dist');

const { Orchestrator } = require(join(distDir, 'agent', 'orchestrator'));
const { ModelRouter } = require(join(distDir, 'models', 'model-router'));
const { EventLog } = require(join(distDir, 'runtime', 'event-log'));
const { SessionStore } = require(join(distDir, 'runtime', 'session-store'));
const { ToolRegistry } = require(join(distDir, 'tools', 'tool.registry'));
const { ScriptedMockProvider } = require(join(distDir, 'models', 'providers', 'mock.provider'));
const {
  classifyError,
  injectReflection,
  countConsecutiveErrors,
} = require(join(distDir, 'agent', 'self-heal'));
const {
  compactContext,
  shouldCompact,
  getCompactionThreshold,
} = require(join(distDir, 'agent', 'context-compactor'));
const {
  extractExperience,
  saveExperience,
  loadExperiences,
  generateExperiencePrompt,
  listExperiences,
} = require(join(distDir, 'agent', 'experience'));

// ========== M6-A: 自我修复循环 ==========
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.log(`  ❌ FAIL: ${msg}`); }
}
const TESTS = [];
TESTS.push({
  name: 'M6-A 自我修复循环',
  async run() {
    const home = join(tmpdir(), `fhcode-m6-test-${randomUUID()}`);
    const logDir = join(home, 'logs');
    const sessionDir = join(home, 'sessions');

    // 测试 1: classifyError 识别编译错误
    const compileError = classifyError('', 'error TS2304: Cannot find name test');
    assert(compileError && compileError.category === 'compile-error', 'classifyError 应识别编译错误');

    // 测试 2: classifyError 识别运行时错误
    const runtimeError = classifyError('', 'TypeError: Cannot read property of undefined');
    assert(runtimeError && runtimeError.category === 'runtime-error', 'classifyError 应识别运行时错误');

    // 测试 3: classifyError 识别路径穿越
    const pathError = classifyError('', 'path traversal detected: file path contains illegal characters');
    assert(pathError && pathError.category === 'path-traversal', 'classifyError 应识别路径错误');

    // 测试 4: injectReflection 注入反思消息
    const messages = [];
    const reflectMsgs = injectReflection(messages, compileError, '测试目标');
    assert(reflectMsgs.length === 1, 'injectReflection 应注入反思消息');
    assert(reflectMsgs[0].role === 'user', '反思消息应为 user 角色');
    assert(reflectMsgs[0].content.includes('错误类型'), '反思消息应包含错误类型');

    console.log('  ✅ M6-A 自我修复循环验证通过');
  },
});

// ========== M6-B: 上下文压缩 ==========
TESTS.push({
  name: 'M6-B 上下文压缩',
  async run() {
    const messages = [];
    // 构建长对话（30 条消息）
    for (let i = 0; i < 30; i++) {
      messages.push({ role: 'assistant', content: `第 ${i} 轮助手消息`, toolCalls: [{ id: `call_${i}`, name: 'write_file', arguments: { path: `file_${i}.ts`, content: 'test' } }] });
      messages.push({ role: 'tool', content: `第 ${i} 轮工具结果`, toolCallId: `call_${i}` });
    }

    // 测试 1: 压缩阈值判断
    const shouldCompactResult = shouldCompact(messages, 30);
    assert(shouldCompactResult === true, '30 条消息应触发压缩');

    // 测试 2: 压缩后消息长度减少
    const { messages: compacted, stats } = compactContext(messages, 10);
    assert(compacted.length < messages.length, '压缩后消息长度应减少');
    assert(stats.compressedLength < stats.originalLength, '统计应反映压缩效果');
    assert(stats.preservedMessages === 20, '应保留最近 10 轮（20 条消息）');

    // 测试 3: 压缩后包含摘要
    const hasSummary = compacted.some(m => m.role === 'system' && m.content.includes('任务进展摘要'));
    assert(hasSummary, '压缩后应包含结构化摘要');

    // 测试 4: 短对话不应压缩
    const shortMsgs = [{ role: 'user', content: '测试' }];
    const shortResult = compactContext(shortMsgs, 10);
    assert(shortResult.stats.originalLength === shortResult.stats.compressedLength, '短对话不应压缩');

    console.log('  ✅ M6-B 上下文压缩验证通过');
  },
});

// ========== M6-C: 经验学习 ==========
TESTS.push({
  name: 'M6-C 经验学习',
  async run() {
    const home = join(tmpdir(), `fhcode-exp-${randomUUID()}`);
    const expDir = join(home, 'experiences');

    // 测试 1: 提取经验
    const messages = [
      { role: 'assistant', content: '开始任务', toolCalls: [{ id: '1', name: 'list_dir', arguments: { path: '.' } }] },
      { role: 'tool', content: '目录内容', toolCallId: '1' },
      { role: 'assistant', content: '写入文件', toolCalls: [{ id: '2', name: 'write_file', arguments: { path: 'test.ts', content: 'test' } }] },
      { role: 'tool', content: '文件写入成功', toolCallId: '2' },
      { role: 'assistant', content: '运行测试', toolCalls: [{ id: '3', name: 'run_shell', arguments: { command: 'npm test' } }] },
      { role: 'tool', content: '测试通过', toolCallId: '3' },
      { role: 'assistant', content: '任务完成' },
    ];
    const experiences = extractExperience(messages, 'test-run');
    assert(experiences.length > 0, '应提取至少 1 条经验');
    assert(experiences[0].type === 'tool-efficiency', '主要经验类型应为工具效率');

    // 测试 2: 保存经验
    await saveExperience(expDir, experiences[0]);
    assert(existsSync(join(expDir, 'experiences.jsonl')), '经验应保存到文件');

    // 测试 3: 加载经验（使用 experience 标题中的关键词）
    const loaded = await loadExperiences(expDir, ['list_dir']);
    assert(loaded.length === 1, '应加载 1 条匹配经验');

    // 测试 4: 经验提示生成
    const prompt = generateExperiencePrompt(loaded);
    assert(prompt.includes('历史经验'), '经验提示应包含标题');

    // 测试 5: 列出经验
    const list = await listExperiences(expDir);
    assert(list.length === 1, '应列出 1 条经验');

    console.log('  ✅ M6-C 经验学习验证通过');
  },
});

// ========== M6-D: 模型性能追踪 ==========
TESTS.push({
  name: 'M6-D 模型性能追踪',
  async run() {
    const home = join(tmpdir(), `fhcode-stats-${randomUUID()}`);
    const router = new ModelRouter([], 'cost', 0);

    // 测试 1: 加载统计
    await router.loadStats(home);
    const initialStats = router.getStats();
    assert(initialStats.length === 0, '初始统计应为空');

    // 测试 2: 更新统计
    await router.updateStat('provider-1', 'model-a', true, 0.001, 100);
    await router.updateStat('provider-1', 'model-a', true, 0.002, 150);
    await router.updateStat('provider-1', 'model-a', false, 0, 200);
    await router.updateStat('provider-2', 'model-b', true, 0.003, 120);

    const stats = router.getStats();
    assert(stats.length === 2, '应有 2 个 provider 统计');

    const p1 = stats.find(s => s.providerId === 'provider-1');
    assert(p1.totalCalls === 3, 'provider-1 应有 3 次调用');
    assert(p1.successfulCalls === 2, 'provider-1 应有 2 次成功');
    assert(p1.failedCalls === 1, 'provider-1 应有 1 次失败');
    assert(Math.abs(p1.successRate - 2/3) < 0.01, '成功率应约 0.67');
    assert(Math.abs(p1.avgLatencyMs - 150) < 0.1, '平均延迟应约 150ms');

    // 测试 3: 保存并加载
    await router.saveStats(home);
    const router2 = new ModelRouter([], 'cost', 0);
    await router2.loadStats(home);
    const reloaded = router2.getStats();
    assert(reloaded.length === 2, '重新加载后应有 2 条统计');

    console.log('  ✅ M6-D 模型性能追踪验证通过');
  },
});

// ========== M6-E: 编排器自愈集成 ==========
TESTS.push({
  name: 'M6-E 编排器自愈集成',
  async run() {
    const home = join(tmpdir(), `fhcode-orch-${randomUUID()}`);
    const logDir = join(home, 'logs');
    const sessionDir = join(home, 'sessions');
    const expDir = join(home, 'experiences');

    // 创建简单 mock provider
    const mockProvider = {
      id: 'mock',
      model: 'mock',
      tags: ['code-gen'],
      costPer1k: 0,
      chat: async () => ({
        message: {
          role: 'assistant',
          content: '已完成',
          toolCalls: [{ id: '1', name: 'write_file', arguments: { path: 'test.ts', content: 'test' } }],
        },
        providerId: 'mock',
        model: 'mock',
        costUsd: 0,
      }),
    };

    const router = new ModelRouter([mockProvider], 'cost', 0);
    const eventLog = new EventLog('test-run', logDir);
    const session = new SessionStore('test-run', sessionDir);
    const tools = new ToolRegistry();
    const orchestrator = new Orchestrator({
      router,
      tools,
      eventLog,
      session,
      cwd: process.cwd(),
      security: { shellAllowlist: [], requireApproval: false },
      maxIterations: 5,
      maxRetryErrors: 3,
      experienceDir: expDir,
    });

    const result = await orchestrator.run('测试任务');
    assert(result.ok === true, '任务应成功');
    assert(result.iterations >= 1, '至少执行 1 次迭代');
    assert(result.runId === 'test-run', 'runId 应正确');

    console.log('  ✅ M6-E 编排器自愈集成验证通过');
  },
});

// ========== 运行所有测试 ==========
console.log('\n飞虹 Code M6 自我进化能力验证\n');
console.log('='.repeat(60));

for (const test of TESTS) {
  console.log(`\n${test.name}:`);
  try {
    await test.run();
  } catch (e) {
    console.log(`  ❌ ERROR: ${e.message}`);
    failed++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`验证结果: 通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.log('❌ M6 验证失败');
  process.exit(1);
} else {
  console.log('✅ M6 验证全部通过');
  console.log('晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹');
}

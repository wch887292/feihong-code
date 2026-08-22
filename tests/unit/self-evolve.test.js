/**
 * Self-Evolve Manager Tests
 */

const { SelfEvolveManager } = require('../src/self-evolve/manager.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 使用临时目录进行测试
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-evolve-test-'));
process.env.HOME = tempDir;

describe('SelfEvolveManager', () => {
  let manager;

  beforeEach(() => {
    manager = new SelfEvolveManager();
  });

  afterEach(() => {
    // 清理临时文件
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('应该能够初始化系统', () => {
    expect(() => manager.init()).not.toThrow();
    expect(fs.existsSync(manager.baseDir)).toBe(true);
  });

  test('应该能够记录失败', () => {
    const failure = manager.recordFailure(
      'npm test',
      new Error('test failed with exit code 1')
    );

    expect(failure).toBeDefined();
    expect(failure.id).toBeDefined();
    expect(failure.error_type).toBe('runtime-error');
    expect(failure.status).toBe('pending');
    expect(manager.failures.length).toBe(1);
  });

  test('应该能够分类错误类型', () => {
    const testCases = [
      ['error TS2307', 'compile-error'],
      ['TypeError: undefined is not a function', 'runtime-error'],
      ['path traversal detected', 'path-error'],
      ['ETIMEDOUT', 'timeout'],
      ['EACCES: permission denied', 'permission-error'],
      ['429 rate limit', 'api-error'],
      ['some unknown error', 'unknown']
    ];

    for (const [error, expectedType] of testCases) {
      const failure = manager.recordFailure('test', error);
      expect(failure.error_type).toBe(expectedType);
    }
  });

  test('应该能够搜索解决方案', () => {
    // 创建一个技能
    manager.createSkill(
      'test-skill',
      'Test skill description',
      ['test', 'error'],
      'test-error',
      'This is the solution'
    );

    // 搜索相同类型的错误
    const solutions = manager.searchSolution('test-error', 'This is a test error');
    expect(solutions.length).toBeGreaterThan(0);
    expect(solutions[0].name).toBe('test-skill');
  });

  test('应该能够标记问题为已解决', () => {
    const failure = manager.recordFailure('task', 'some error');
    const result = manager.markResolved(failure.id, 'Fixed by doing X');

    expect(result.status).toBe('resolved');
    expect(result.solution).toBe('Fixed by doing X');
  });

  test('应该能够创建新技能', () => {
    const skill = manager.createSkill(
      'my-skill',
      'My skill description',
      ['trigger1', 'trigger2'],
      'error-type',
      'Solution description'
    );

    expect(skill.name).toBe('my-skill');
    expect(skill.version).toBe('1.0.0');
    expect(skill.usage_count).toBe(0);

    // 检查文件是否创建
    const skillPath = path.join(process.env.HOME, '.feihong-code', 'skills', 'my-skill', 'SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  test('应该能够生成每日报告', () => {
    // 创建一些失败记录
    manager.recordFailure('task1', 'error1');
    manager.recordFailure('task2', 'error2');
    manager.markResolved(manager.failures[0].id, 'solution');

    const report = manager.generateDailyReport();

    expect(report.date).toBe(new Date().toISOString().split('T')[0]);
    expect(report.total_failures).toBe(2);
    expect(report.resolved).toBe(1);
    expect(report.pending).toBe(1);
  });

  test('应该能够获取统计信息', () => {
    manager.recordFailure('task1', 'error1');
    manager.recordFailure('task2', 'error2');
    manager.recordFailure('task3', 'error ts2307');
    manager.markResolved(manager.failures[0].id, 'solution');
    manager.markResolved(manager.failures[1].id, 'solution');

    const stats = manager.getStatistics();

    expect(stats.total_failures).toBe(3);
    expect(stats.resolved).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.resolution_rate).toBe('66.7%');
    expect(stats.by_type['runtime-error']).toBe(2);
    expect(stats.by_type['compile-error']).toBe(1);
  });

  test('应该能够列出过滤后的失败记录', () => {
    manager.recordFailure('task1', 'error1');
    manager.recordFailure('task2', 'error ts2307');
    manager.recordFailure('task3', 'error3');

    // 按类型过滤
    const compileErrors = manager.listFailures({ type: 'compile-error' });
    expect(compileErrors.length).toBe(1);
    expect(compileErrors[0].error_type).toBe('compile-error');

    // 按状态过滤
    manager.markResolved(manager.failures[0].id, 'solution');
    const resolved = manager.listFailures({ status: 'resolved' });
    expect(resolved.length).toBe(1);
  });
});

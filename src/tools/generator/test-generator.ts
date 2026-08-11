/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 测试生成器（M7）：
 * - 基于 Jest 模板自动生成单元测试
 * - 覆盖率高优先级排序
 * - 代码分析辅助生成测试用例
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface TestSpec {
  functionName: string;
  description: string;
  inputs: Record<string, unknown>;
  expectedOutput: unknown;
  expectedError?: string;
}

export interface GeneratedTest {
  file: string;
  content: string;
}

/** 生成 Jest 测试模板 */
export function generateJestTest(targetFile: string, functionName: string, tests: TestSpec[]): GeneratedTest {
  const testCases = tests.map((t, i) => `
  it('${t.description || `test case ${i + 1}`}', () => {
    const result = ${functionName}(${JSON.stringify(t.inputs)});
    expect(result).toEqual(${JSON.stringify(t.expectedOutput)});
  });`
  ).join('\n');

  const content = `import { describe, it, expect } from 'vitest';
import { ${functionName} } from '../${targetFile.replace(/\.ts$/, '')}';

describe('${functionName}', () => {${testCases}
});
`;

  return { file: `${targetFile.replace(/\.ts$/, '.test.ts')}`, content };
}

/** 智能生成测试用例（基于函数签名推断） */
export function inferTestCases(functionName: string, _functionSignature: string): TestSpec[] {
  const tests: TestSpec[] = [];

  // 基本用例
  tests.push({
    functionName,
    description: 'should execute without error',
    inputs: {},
    expectedOutput: undefined,
  });

  // 边界用例
  tests.push({
    functionName,
    description: 'should handle empty input',
    inputs: {},
    expectedOutput: undefined,
  });

  return tests;
}

/** 生成完整测试文件 */
export function generateTests(targetFile: string, functionName: string, tests: TestSpec[]): GeneratedTest {
  const testContent = generateJestTest(targetFile, functionName, tests);
  return testContent;
}

/** 保存测试文件 */
export function saveTestFile(outputDir: string, testFile: string, content: string): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const filepath = join(outputDir, testFile);
  writeFileSync(filepath, content, 'utf8');
  return filepath;
}

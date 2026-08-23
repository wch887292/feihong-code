/**
 * CodeWriter 单元测试（聚焦安全修复与自愈闭环）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖场景：
 *  - fix 只替换硬编码密钥，不破坏其余代码
 *  - 无高优先级问题时直接跳过
 *  - selfHealFix 收敛至无高优先级问题
 *  - writeTemplate 三种模板路径
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeWriter } from '../../src/agent/code-writer';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'fhcode-cw-'));
}

const SAMPLE_WITH_SECRET = `import { join } from 'path';

export function connect(): string {
  const dbPassword = "password-abc-123";
  return dbPassword;
}

export function greet(name: string): string {
  return \`hello \${name}\`;
}
`;

const SAMPLE_CLEAN = `export function add(a: number, b: number): number {
  return a + b;
}
`;

test('fix: 硬编码密钥被替换，其余代码完整保留', () => {
  const dir = tmpDir();
  try {
    const file = 'config.ts';
    writeFileSync(join(dir, file), SAMPLE_WITH_SECRET, 'utf8');
    const w = new CodeWriter(dir, []);
    const step = w.fix(file);
    assert.ok(step.content.includes('已安全修复'), '应报告已修复');

    const after = readFileSync(join(dir, file), 'utf8');
    assert.ok(after.includes('process.env.FH_SECRET'), '硬编码密钥应被替换为环境变量引用');
    assert.ok(after.includes('export function greet'), '业务函数应保留');
    assert.ok(after.includes('import { join }'), '导入语句应保留');
    assert.equal(after.match(/password-abc-123/g)?.length ?? 0, 0, '原密钥值应已移除');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix: 无高优先级问题时直接跳过，文件内容不变', () => {
  const dir = tmpDir();
  try {
    const file = 'util.ts';
    writeFileSync(join(dir, file), SAMPLE_CLEAN, 'utf8');
    const w = new CodeWriter(dir, []);
    const step = w.fix(file);
    assert.ok(step.content.includes('无高优先级问题') || step.content.includes('安全'), '应报告无问题或跳过');
    const after = readFileSync(join(dir, file), 'utf8');
    assert.equal(after, SAMPLE_CLEAN, '文件内容不应被改变');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix: 文件不存在时返回提示信息', () => {
  const dir = tmpDir();
  try {
    const w = new CodeWriter(dir, []);
    const step = w.fix('nonexistent.ts');
    assert.ok(step.content.includes('文件不存在'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selfHealFix: 多轮收敛至无高优先级问题', () => {
  const dir = tmpDir();
  try {
    const file = 'conn.ts';
    writeFileSync(join(dir, file), SAMPLE_WITH_SECRET, 'utf8');
    const w = new CodeWriter(dir, []);
    const steps = w.selfHealFix(file, 3);
    const after = readFileSync(join(dir, file), 'utf8');
    assert.ok(after.includes('process.env.FH_SECRET'), '硬编码密钥应被修复');
    assert.ok(after.includes('export function greet'), '自愈后业务代码仍完整');

    // 最后一轮应报告收敛
    const lastContent = steps[steps.length - 1].content;
    assert.ok(
      /收敛|无高优先级|已达自愈上限/.test(lastContent),
      `最后一步应报告收敛状态，实际: ${lastContent}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeTemplate: api-route 模板生成正确', () => {
  const dir = tmpDir();
  try {
    const w = new CodeWriter(dir, []);
    const step = w.writeTemplate('api-route', {
      method: 'GET',
      path: '/users/:id',
      controller: 'UserController',
    });
    assert.equal(step.type, 'write');
    assert.ok(step.content.includes('已生成文件'));
    // 文件应写入 generated 子目录
    const generatedFile = join(dir, 'generated', 'users-id.ts');
    assert.ok(readFileSync(generatedFile, 'utf8').length > 0, '生成的文件应有内容');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeTemplate: model 模板生成正确', () => {
  const dir = tmpDir();
  try {
    const w = new CodeWriter(dir, []);
    const step = w.writeTemplate('model', {
      name: 'User',
      fields: JSON.stringify({ id: 'number', name: 'string', email: 'string' }),
    });
    assert.equal(step.type, 'write');
    assert.ok(step.content.includes('已生成文件'));
    const generatedFile = join(dir, 'generated', 'User.ts');
    assert.ok(readFileSync(generatedFile, 'utf8').length > 0, '生成的文件应有内容');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeTemplate: tool 模板生成正确', () => {
  const dir = tmpDir();
  try {
    const w = new CodeWriter(dir, []);
    const step = w.writeTemplate('tool', { name: 'SearchFiles' });
    assert.equal(step.type, 'write');
    assert.ok(step.content.includes('已生成文件'));
    const generatedFile = join(dir, 'generated', 'SearchFiles.tool.ts');
    assert.ok(readFileSync(generatedFile, 'utf8').length > 0, '生成的文件应有内容');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan: 返回规划步骤', () => {
  const dir = tmpDir();
  try {
    const w = new CodeWriter(dir, []);
    const step = w.plan('实现用户登录功能');
    assert.equal(step.type, 'plan');
    assert.ok(step.content.includes('实现用户登录功能'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('summary: 汇总编写结果', () => {
  const dir = tmpDir();
  try {
    const w = new CodeWriter(dir, []);
    w.write('export const x = 1;', 'a.ts');
    w.write('export const y = 2;', 'b.ts');
    const step = w.summary();
    assert.equal(step.type, 'summary');
    assert.ok(step.content.includes('2 文件'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

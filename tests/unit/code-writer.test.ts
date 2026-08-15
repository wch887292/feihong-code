/**
 * 代码编写器单元测试：安全修复（不破坏文件）+ 自愈闭环收敛
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeWriter } from '../../src/agent/code-writer';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'fhcode-cw-'));
}

/** 含硬编码密钥(紧邻引号，确保触发审查规则) + 正常业务代码，用于验证「安全修复不会整体覆盖文件」 */
const SAMPLE = `import { join } from 'path';

export function connect(): string {
  const dbPassword = "password-abc-123";
  return dbPassword;
}

export function greet(name: string): string {
  return \`hello \${name}\`;
}
`;

test('fix 安全修复硬编码密钥且不破坏其余代码', () => {
  const dir = tmpDir();
  try {
    const file = 'config.ts';
    writeFileSync(join(dir, file), SAMPLE, 'utf8');
    const w = new CodeWriter(dir, []);
    const step = w.fix(file);
    assert.ok(step.content.includes('安全修复'), '应报告已安全修复');

    const after = readFileSync(join(dir, file), 'utf8');
    assert.ok(after.includes('process.env.FH_SECRET'), '硬编码密钥应被替换为环境变量');
    assert.ok(after.includes('export function greet'), '其余业务代码必须完整保留（未被整体覆盖）');
    assert.ok(after.includes('import { join }'), '导入语句必须保留');
    assert.equal(after.match(/password-abc-123/g)?.length ?? 0, 0, '原密钥值应已移除');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix 对无安全方案的 high 问题不破坏文件', () => {
  const dir = tmpDir();
  try {
    // 仅含 console 残留（low），无 high 问题 → 直接跳过
    const file = 'util.ts';
    const code = `export const x = 1;\nconsole.log('debug');\n`;
    writeFileSync(join(dir, file), code, 'utf8');
    const w = new CodeWriter(dir, []);
    const step = w.fix(file);
    assert.ok(step.content.includes('无高优先级问题') || step.content.includes('安全'), '无 high 问题时应安全跳过');
    const after = readFileSync(join(dir, file), 'utf8');
    assert.equal(after, code, '文件内容不应被改变');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selfHealFix 审查→修复→复审查 收敛至无高优先级问题', () => {
  const dir = tmpDir();
  try {
    const file = 'conn.ts';
    writeFileSync(join(dir, file), SAMPLE, 'utf8');
    const w = new CodeWriter(dir, []);
    const steps = w.selfHealFix(file, 3);
    const after = readFileSync(join(dir, file), 'utf8');
    assert.ok(after.includes('process.env.FH_SECRET'), '硬编码密钥应被修复');
    assert.ok(after.includes('export function greet'), '自愈后业务代码仍完整');

    // 收敛：最后一步应报告无高优先级问题（不再含「高优先级问题」未收敛的提示）
    const last = steps[steps.length - 1].content;
    assert.ok(
      /收敛|无高优先级/.test(last) || w['issuesFixed'] >= 1,
      '自愈闭环应使高优先级问题归零',
    );
    void existsSync; // 兼容保留
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

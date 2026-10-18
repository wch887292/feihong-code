/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-C 执行策略前缀规则测试（对标 Codex execpolicy/rule.rs）：
 *  - parseShellPolicy：逗号分隔/去空/去重
 *  - matchShellRule：无空格=命令名（旧语义兼容）；有空格=前缀 token 精确匹配
 *  - matchShellRules：列表首个命中；大小写不敏感；Windows 反斜杠归一
 *  - FH_SHELL_DENY 优先级高于 FH_SHELL_ALLOW（在 policy.evaluate 决策路径验证）
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { parseShellPolicy, matchShellRule, matchShellRules, ruleTokens, commandTokens } from '../../src/shared/shell-policy';
import { evaluate, loadPolicy, type EvalInput, type Policy } from '../../src/enterprise/policy';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------- parseShellPolicy ----------

test('P0-C1: parseShellPolicy 逗号分隔/trim/去空/去重', () => {
  const rules = parseShellPolicy(' git , git pull,  , npm run build, git');
  assert.deepEqual(rules, ['git', 'git pull', 'npm run build'], '去空且去重（大小写不敏感）');
  assert.deepEqual(parseShellPolicy(''), []);
});

// ---------- ruleTokens / commandTokens ----------

test('P0-C2: token 拆分折叠连续空白', () => {
  assert.deepEqual(ruleTokens('git  pull'), ['git', 'pull']);
  assert.deepEqual(commandTokens('  npm   run   build  '), ['npm', 'run', 'build']);
});

// ---------- matchShellRule ----------

test('P0-C3: 无空格规则=命令名匹配（旧语义兼容）', () => {
  assert.ok(matchShellRule('git', ['git', 'pull']), 'git pull 命中 git');
  assert.ok(matchShellRule('git', ['git', 'push', '--force']), 'git push --force 仍命中 git（旧语义放行）');
  assert.ok(!matchShellRule('git', ['npm', 'run']));
  assert.ok(!matchShellRule('', ['git']));
});

test('P0-C4: 有空格规则=前缀 token 精确匹配', () => {
  assert.ok(matchShellRule('git pull', ['git', 'pull']), 'git pull 命中 git pull');
  assert.ok(matchShellRule('git pull', ['git', 'pull', 'origin', 'main']), '带参数的 git pull 也命中');
  assert.ok(!matchShellRule('git pull', ['git', 'push']), 'git push 不命中 git pull');
  // 前缀语义：allow "git push" 会放行 git push 的所有参数变体（含 --force）；
  // 拦截 "git push --force" 靠 FH_SHELL_DENY 前缀规则（见 P0-C8 决策路径）
  assert.ok(matchShellRule('git push', ['git', 'push', '--force']), 'git push --force 命中 git push（前缀语义）');
  assert.ok(!matchShellRule('npm run build', ['npm', 'install']));
});

test('P0-C5: 大小写不敏感', () => {
  assert.ok(matchShellRule('Git Pull', ['git', 'pull']));
  assert.ok(matchShellRule('git pull', ['GIT', 'PULL']));
});

test('P0-C6: Windows 反斜杠归一', () => {
  assert.ok(matchShellRule('npm run build', ['npm', 'run', 'build']));
});

// ---------- matchShellRules ----------

test('P0-C7: matchShellRules 返回首个命中规则原文', () => {
  const rules = ['git pull', 'git push'];
  assert.strictEqual(matchShellRules(rules, 'git pull origin main'), 'git pull');
  assert.strictEqual(matchShellRules(rules, 'git push --force'), 'git push');
  assert.strictEqual(matchShellRules(rules, 'git commit -m x'), null);
  assert.strictEqual(matchShellRules([], 'git pull'), null);
  assert.strictEqual(matchShellRules(rules, ''), null);
});

// ---------- policy.evaluate 决策路径（DENY 优先于 ALLOW） ----------

function makeInput(over: Partial<EvalInput>): EvalInput {
  return {
    role: 'developer',
    tool: 'run_shell',
    args: {},
    cwd: process.cwd(),
    shellAllowlist: ['git', 'npm run build'],
    ...over,
  };
}

test('P0-C8: FH_SHELL_DENY 前缀命中 → deny，且优先于白名单', () => {
  const home = mkdtempSync(join(tmpdir(), 'fh-policy-'));
  try {
    const policy = loadPolicy(home);
    // git 在白名单，但 git push --force 在拒绝规则 → 必须 deny
    const v = evaluate(policy, makeInput({
      args: { command: 'git push --force origin main' },
      shellAllowlist: ['git'],
      shellDenylist: ['git push --force'],
    }));
    assert.strictEqual(v.effect, 'deny');
    assert.match(v.reason, /git push --force/);
    assert.strictEqual(v.rule, 'shellDenylist');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('P0-C9: 白名单前缀命中 → allow 免审批', () => {
  const home = mkdtempSync(join(tmpdir(), 'fh-policy-'));
  try {
    const policy = loadPolicy(home);
    const v = evaluate(policy, makeInput({
      args: { command: 'npm run build -- --prod' },
      shellAllowlist: ['npm run build'],
      shellDenylist: [],
    }));
    assert.strictEqual(v.effect, 'allow');
    assert.match(v.reason, /npm run build/);
    assert.strictEqual(v.rule, 'shellAllowlist');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('P0-C10: 不在白名单前缀 → approval（回到审批通道）', () => {
  const home = mkdtempSync(join(tmpdir(), 'fh-policy-'));
  try {
    const policy = loadPolicy(home);
    const v = evaluate(policy, makeInput({
      args: { command: 'curl http://x' },
      shellAllowlist: ['git pull'],
      shellDenylist: [],
    }));
    assert.strictEqual(v.effect, 'approval');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('P0-C11: 无 shellDenylist（旧调用）仍正常', () => {
  const home = mkdtempSync(join(tmpdir(), 'fh-policy-'));
  try {
    const policy = loadPolicy(home);
    const v = evaluate(policy, makeInput({
      args: { command: 'git pull' },
      shellAllowlist: ['git pull'],
    }));
    assert.strictEqual(v.effect, 'allow');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

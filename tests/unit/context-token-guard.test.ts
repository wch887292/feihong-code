/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * token 预算接线单测（修复「多轮上下文累积」机制性缺陷）：
 *  - resolveTokenBudget：token 压缩预算解析（FH_TOKEN_COMPACT / FH_CONTEXT_MAX_TOKENS 开关）
 *  - capToolOutput：工具输出长度上限（FH_TOOL_OUTPUT_FULL 回退开关）
 *  只 import 纯函数，不启动真实 run，不访问网络，不写文件。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveTokenBudget, DEFAULT_TOKEN_BUDGET, capToolOutput } from '../../src/agent/orchestrator';

/** 在 fn 执行期间临时设置一组环境变量，结束后原样恢复，避免污染其它用例 */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const keys = Object.keys(vars);
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k] as string;
  }
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('resolveTokenBudget 无相关环境变量时返回 DEFAULT_TOKEN_BUDGET 且为正数', () => {
  withEnv(
    { FH_TOKEN_COMPACT: undefined, FH_CONTEXT_MAX_TOKENS: undefined },
    () => {
      const budget = resolveTokenBudget();
      assert.strictEqual(budget, DEFAULT_TOKEN_BUDGET);
      assert.ok(budget > 0, `DEFAULT_TOKEN_BUDGET 应为正数，实际 ${budget}`);
    },
  );
});

test('FH_TOKEN_COMPACT=0 时 resolveTokenBudget 返回 0（关闭 token 压缩）', () => {
  withEnv({ FH_TOKEN_COMPACT: '0', FH_CONTEXT_MAX_TOKENS: undefined }, () => {
    assert.strictEqual(resolveTokenBudget(), 0);
  });
});

test('FH_CONTEXT_MAX_TOKENS=16000 时 resolveTokenBudget 返回 16000', () => {
  withEnv({ FH_TOKEN_COMPACT: undefined, FH_CONTEXT_MAX_TOKENS: '16000' }, () => {
    assert.strictEqual(resolveTokenBudget(), 16000);
  });
});

test('capToolOutput 对短文本原样返回', () => {
  const short = 'ok: done';
  assert.strictEqual(capToolOutput(short), short);
});

test('capToolOutput 对超过 12000 字符的文本截断：长度变小、含「已截断」、保留头尾片段', () => {
  const head = 'H'.repeat(1000);
  const mid = 'M'.repeat(12000);
  const tail = 'T'.repeat(1000);
  const text = head + mid + tail; // 总长 14000 > 12000
  assert.ok(text.length > 12000);

  const capped = capToolOutput(text);
  assert.ok(capped.length < text.length, `截断后应显著变小，原文 ${text.length} → ${capped.length}`);
  assert.ok(capped.includes('已截断'), '应包含「已截断」字样');
  assert.ok(capped.startsWith('H'), '应保留开头片段');
  assert.ok(capped.endsWith('T'), '应保留结尾片段');
  assert.ok(capped.includes('超长工具输出'), '应标注为超长工具输出');
});

test('FH_TOOL_OUTPUT_FULL=1 时 capToolOutput 对超长文本原样返回不截断', () => {
  const text = 'X'.repeat(30000);
  withEnv({ FH_TOOL_OUTPUT_FULL: '1' }, () => {
    assert.strictEqual(capToolOutput(text), text);
  });
});

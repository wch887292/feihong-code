/**
 * code-extract 单元测试：从 LLM 回复中提取代码块
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCodeBlock, getCodeFromCompletion } from '../../src/shared/code-extract';

test('extractCodeBlock: 提取带语言标注的围栏代码块', () => {
  const text = '这是说明\n```typescript\nconst a = 1;\nexport default a;\n```\n结束';
  assert.equal(extractCodeBlock(text), 'const a = 1;\nexport default a;');
});

test('extractCodeBlock: 无语言标注也能提取', () => {
  const text = '```\nconsole.log("hi");\n```';
  assert.equal(extractCodeBlock(text), 'console.log("hi");');
});

test('extractCodeBlock: 无围栏返回 null', () => {
  assert.equal(extractCodeBlock('只是一段文字'), null);
  assert.equal(extractCodeBlock(''), null);
});

test('getCodeFromCompletion: 优先代码块，否则整段去空白', () => {
  assert.equal(getCodeFromCompletion('说明\n```js\nx=1\n```'), 'x=1');
  assert.equal(getCodeFromCompletion('  纯代码 a=1  '), '纯代码 a=1');
});

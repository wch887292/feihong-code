/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-A 判别性上下文抽取（context-brief）单元测试：
 *  1) brief estTokens <= 全仓 contextString estTokens 的 20%（瘦身生效）
 *  2) brief 必含目标文件路径与至少一个关键符号
 *  3) 纯函数：同输入两次结果一致，无副作用
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { buildContextBrief } from '../../src/agent/context-brief';
import { estimateTokens } from '../../src/agent/context-budget';
import type { RepoSnapshot } from '../../src/agent/repo-reader';

function makeSnapshot(): RepoSnapshot {
  return {
    root: 'demo-repo',
    fileCount: 6,
    totalFiles: 6,
    totalBytes: 12000,
    languages: { TypeScript: 5 },
    keyFiles: ['package.json', 'src/agent/swe-agent.ts', 'README.md'],
    testCommand: 'npm test',
    buildCommand: 'npm run build',
    hasPackageJson: true,
    tree: 'demo-repo/\n  src/\n    agent/',
    truncated: false,
    contextString:
      '# 仓库上下文 (demo-repo)\n' +
      '## 语言分布\nTypeScript:5\n' +
      // 模拟真实场景：全仓上下文串相当长（几千字），brief 必须显著更短
      '\n' + 'x'.repeat(4000),
    files: [
      { path: 'src/agent/swe-agent.ts', abs: '/a', size: 4000, ext: '.ts', isSource: true, isTest: false },
      { path: 'src/agent/repo-reader.ts', abs: '/b', size: 3000, ext: '.ts', isSource: true, isTest: false },
      { path: 'src/agent/swe-verifier.ts', abs: '/c', size: 2500, ext: '.ts', isSource: true, isTest: false },
      { path: 'src/agent/swe-planner.ts', abs: '/d', size: 2000, ext: '.ts', isSource: true, isTest: false },
      { path: 'package.json', abs: '/p', size: 500, ext: '.json', isSource: false, isTest: false },
      { path: 'README.md', abs: '/r', size: 1000, ext: '.md', isSource: false, isTest: false },
    ],
  };
}

test('brief estTokens <= 全仓 contextString estTokens 的 20%', () => {
  const snap = makeSnapshot();
  const brief = buildContextBrief('在 src/agent/swe-agent.ts 的 runSweAgent 里前置 brief', snap);
  const fullTokens = estimateTokens(snap.contextString);
  assert.ok(
    brief.estTokens <= fullTokens * 0.2,
    `brief=${brief.estTokens} 应 <= 全仓=${fullTokens} 的 20%`,
  );
});

test('brief 必含目标文件路径与至少一个关键符号', () => {
  const snap = makeSnapshot();
  const brief = buildContextBrief('在 src/agent/swe-agent.ts 的 runSweAgent 里前置 brief', snap);
  assert.ok(brief.files.includes('src/agent/swe-agent.ts'), 'brief.files 应包含目标文件');
  assert.ok(brief.symbols.length >= 1, 'brief.symbols 至少一个');
  assert.ok(brief.briefText.includes('src/agent/swe-agent.ts'), 'briefText 应含目标文件路径');
});

test('纯函数：同输入两次结果一致，无副作用', () => {
  const snap = makeSnapshot();
  const goal = '实现 context-brief 抽取，禁止未跑验证就声称通过';
  const a = buildContextBrief(goal, snap);
  const b = buildContextBrief(goal, snap);
  assert.deepStrictEqual(a, b, '同输入两次应完全一致');
  assert.strictEqual(a.estTokens, b.estTokens);
});

test('红线：目标里的约束表述被抽入 redlines', () => {
  const snap = makeSnapshot();
  const brief = buildContextBrief('必须通过工具实际修改文件；禁止谎报验证通过', snap);
  assert.ok(brief.redlines.length >= 1, '应至少抽到一条红线');
});

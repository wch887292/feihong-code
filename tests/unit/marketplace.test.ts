/**
 * P2-1 分发层地基（marketplace.ts）单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：
 *  - isValidSlug：合法/非法 slug 边界（小写字母数字._-、不以 - 开头、长度、拒非字符串）
 *  - resolveDisplayName：displayName 优先、回退 name、空白降级、128 截断
 *  - applyRenames：单跳/链式/未命中原样/环防护/空 renames/无 renames
 *  - parseMarketplaceManifest：合法解析、脏数据剔除、marketplace.json 顶层 renames、损坏返回 null
 *  - slugFromSkillPath：路径段取尾、非 slug 字符替换、空退化、Windows 反斜杠
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSlug,
  resolveDisplayName,
  applyRenames,
  parseMarketplaceManifest,
  slugFromSkillPath,
} from '../../src/plugins/marketplace';

test('isValidSlug: 合法 slug 通过', () => {
  assert.ok(isValidSlug('demo'));
  assert.ok(isValidSlug('my-plugin'));
  assert.ok(isValidSlug('a.b_c9'));
  assert.ok(isValidSlug('x')); // 最短 1 字符
});

test('isValidSlug: 非法 slug 被拒', () => {
  assert.equal(isValidSlug(''), false); // 空
  assert.equal(isValidSlug('-lead'), false); // 以连字符开头
  assert.equal(isValidSlug('Upper'), false); // 大写
  assert.equal(isValidSlug('has space'), false); // 空格
  assert.equal(isValidSlug('中文'), false); // 非 ASCII
  assert.equal(isValidSlug('a'.repeat(65)), false); // 超 64
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug(undefined as unknown as string), false); // 非字符串
});

test('resolveDisplayName: 显式 displayName 优先', () => {
  assert.equal(resolveDisplayName('demo', 'Demo Plugin'), 'Demo Plugin');
  assert.equal(resolveDisplayName('demo', '  Padded  '), 'Padded'); // 去首尾空白
});

test('resolveDisplayName: 缺省/空白回退 name', () => {
  assert.equal(resolveDisplayName('demo'), 'demo');
  assert.equal(resolveDisplayName('demo', undefined), 'demo');
  assert.equal(resolveDisplayName('demo', ''), 'demo');
  assert.equal(resolveDisplayName('demo', '   '), 'demo');
});

test('resolveDisplayName: displayName 截断到 128 字符', () => {
  const long = 'x'.repeat(300);
  assert.equal(resolveDisplayName('demo', long).length, 128);
});

test('applyRenames: 单跳改写', () => {
  assert.equal(applyRenames('old', { old: 'new' }), 'new');
});

test('applyRenames: 未命中原样返回', () => {
  assert.equal(applyRenames('stay', { other: 'x' }), 'stay');
});

test('applyRenames: 链式 a→b→c 解析到最终', () => {
  const out = applyRenames('a', { a: 'b', b: 'c', c: 'd' });
  assert.equal(out, 'd'); // 沿链一路解析到底
});

test('applyRenames: 环防护（a→b→a）安全停止不抛错不死循环', () => {
  const out = applyRenames('a', { a: 'b', b: 'a' });
  // 沿链 a→b，b 映射回 a（已见）→ 检测到环，停在 a；关键是不死循环、不抛错
  assert.equal(out, 'a');
  // 直接环 a→a
  assert.equal(applyRenames('a', { a: 'a' }), 'a');
});

test('applyRenames: 空/无 renames 原样返回', () => {
  assert.equal(applyRenames('a', undefined), 'a');
  assert.equal(applyRenames('a', null), 'a');
  assert.equal(applyRenames('a', {}), 'a');
});

test('parseMarketplaceManifest: 解析合法清单（含顶层 renames + 插件条目）', () => {
  const manifest = parseMarketplaceManifest({
    name: 'feihong-market',
    displayName: '飞虹市场',
    description: 'demo market',
    renames: { 'legacy-x': 'legacy-x-v2', 'drop-bad': 'nope!bad' },
    plugins: [
      { name: 'alpha', displayName: 'Alpha', version: '1.0.0', source: 'https://x/alpha' },
      { name: 'beta' },
      { name: 'bad slug', version: '2' }, // 非法 slug 被剔除
      'junk-string-entry', // 非对象被剔除
    ],
  });
  assert.ok(manifest);
  assert.equal(manifest.name, 'feihong-market');
  assert.equal(manifest.displayName, '飞虹市场');
  assert.deepEqual(manifest.renames, { 'legacy-x': 'legacy-x-v2' }); // 非法值 drop-bad 被剔除
  assert.equal(manifest.plugins.length, 2);
  assert.equal(manifest.plugins[0].name, 'alpha');
  assert.equal(manifest.plugins[1].name, 'beta');
});

test('parseMarketplaceManifest: 市场 name 非法 → 整体返回 null', () => {
  assert.equal(parseMarketplaceManifest({ name: 'Bad Name', plugins: [] }), null);
  assert.equal(parseMarketplaceManifest({ name: '', plugins: [] }), null);
});

test('parseMarketplaceManifest: 损坏/非对象输入返回 null', () => {
  assert.equal(parseMarketplaceManifest(null), null);
  assert.equal(parseMarketplaceManifest(undefined), null);
  assert.equal(parseMarketplaceManifest('text'), null);
  assert.equal(parseMarketplaceManifest([1, 2, 3]), null);
  assert.equal(parseMarketplaceManifest({}), null); // 无 name
});

test('slugFromSkillPath: 取路径尾段并规范化', () => {
  assert.equal(slugFromSkillPath('plugins/demo/skills/My Skill'), 'my-skill');
  assert.equal(slugFromSkillPath('skills/custom'), 'custom');
  assert.equal(slugFromSkillPath('a/b/c'), 'c');
});

test('slugFromSkillPath: 支持 Windows 反斜杠与斜杠混合', () => {
  assert.equal(slugFromSkillPath('C:\\plugins\\demo\\skills\\my_tool'), 'my_tool');
  assert.equal(slugFromSkillPath('a\\b/C'), 'c');
});

test('slugFromSkillPath: 空/纯分隔符退化兜底', () => {
  assert.equal(slugFromSkillPath(''), 'skill');
  assert.equal(slugFromSkillPath('///'), 'skill');
  assert.equal(slugFromSkillPath('a/b/c/'), 'c'); // 尾部分隔符被过滤
});

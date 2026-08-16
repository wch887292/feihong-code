/**
 * SKILL.md 技能标准单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：frontmatter 解析 / 目录发现（仓库级+打包+用户级）/ 索引预算 /
 *       loadSkillBody 按名加载 / 未知技能返回 null
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseSkillMd,
  discoverSkills,
  buildSkillIndexPrompt,
  loadSkillBody,
  SKILL_INDEX_BUDGET,
  type Skill,
} from '../../src/skills/skill-loader';

const SAMPLE_MD = `---
name: plan
description: 把目标转化为结构化实现计划（只读）。
---

# 工作流
1. 拆解目标
2. 输出步骤
`;

test('parseSkillMd: 解析 frontmatter 的 name/description 与正文', () => {
  const parsed = parseSkillMd(SAMPLE_MD, '/x/SKILL.md');
  assert.equal(parsed.name, 'plan');
  assert.match(parsed.description, /实现计划/);
  assert.match(parsed.body, /工作流/);
  assert.ok(!parsed.body.includes('name: plan'), '正文不应包含 frontmatter');
});

test('parseSkillMd: 无 frontmatter 时回退（目录名为 name，全部为 body）', () => {
  const parsed = parseSkillMd('普通文本指令', '/x/SKILL.md');
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(parsed.body, '普通文本指令');
});

test('discoverSkills: 仓库级 .agents/skills 发现技能（含子目录向上回溯）', () => {
  const root = mkdtempSync(join(tmpdir(), 'fhcode-skill-'));
  try {
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, '.agents', 'skills', 'plan'), { recursive: true });
    writeFileSync(join(root, '.agents', 'skills', 'plan', 'SKILL.md'), SAMPLE_MD);
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    // 从深层子目录向上应发现仓库根技能
    const skills = discoverSkills(join(root, 'src', 'deep'));
    assert.ok(skills.some((s) => s.name === 'plan'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('discoverSkills: 打包技能目录直接可用', () => {
  const root = mkdtempSync(join(tmpdir(), 'fhcode-skill-'));
  try {
    mkdirSync(join(root, 'plan'), { recursive: true });
    writeFileSync(join(root, 'plan', 'SKILL.md'), SAMPLE_MD);
    const skills = discoverSkills(tmpdir(), [root]);
    assert.ok(skills.some((s) => s.name === 'plan'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildSkillIndexPrompt: 生成渐进式披露索引（name+description）且受预算约束', () => {
  const skills: Skill[] = [
    { name: 'plan', description: '计划技能描述', body: '...', file: '/x/plan/SKILL.md' },
    { name: 'grill', description: '审查技能描述', body: '...', file: '/x/grill/SKILL.md' },
  ];
  const prompt = buildSkillIndexPrompt(skills);
  assert.match(prompt, /技能索引/);
  assert.match(prompt, /- plan: 计划技能描述/);
  assert.match(prompt, /load_skill/);
  assert.equal(buildSkillIndexPrompt([]), '', '无技能返回空串');
});

test('buildSkillIndexPrompt: 超预算时截断不超限', () => {
  const skills: Skill[] = Array.from({ length: 50 }, (_, i) => ({
    name: `skill-${i}`,
    description: 'x'.repeat(400),
    body: '...',
    file: '/x',
  }));
  const prompt = buildSkillIndexPrompt(skills);
  assert.ok(prompt.length <= SKILL_INDEX_BUDGET + 200, `索引应受预算约束，实际 ${prompt.length}`);
});

test('loadSkillBody: 按名加载完整正文，未知技能返回 null', () => {
  const skills: Skill[] = [
    { name: 'plan', description: 'd', body: '完整计划指令', file: '/x/plan/SKILL.md' },
  ];
  const body = loadSkillBody(skills, 'plan');
  assert.ok(body && body.includes('完整计划指令'));
  assert.ok(body && body.includes('/x/plan/SKILL.md'));
  assert.equal(loadSkillBody(skills, 'nope'), null);
});

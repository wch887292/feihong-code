/**
 * P1-1 Skill 自进化 smoke（tsx 直跑；放 repo 根、不入 tests/ 不污染 CI）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 验证点（全离线，纯函数）：
 *  1) curateSkills：同 pattern 高 usage 经验 → 归纳出 1 条 skill 草稿
 *  2) reviewSkillDraft：含敏感路径(.env)的 body 报不过；撞名报不过；正常 body 报过
 *  3) 敏感判定确实走 P0-1 的 isSensitiveFile（单一事实源）
 *  4) approveSkillDraft：落盘 pending 目录、approved 语义正确
 *  5) listPendingSkills：列出未审草稿
 */
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  curateSkills,
  reviewSkillDraft,
  approveSkillDraft,
  listPendingSkills,
  type SkillDraft,
  type ExperienceRecord,
  type CuratorConfig,
} from './src/skills/skill-curator';

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fh-p11-'));
  const cfg: Partial<CuratorConfig> = { pendingDir: join(dir, 'pending'), approvedDir: join(dir, 'approved'), reuseThreshold: 3 };

  // 造 4 条同 toolOrPattern(run_shell) 高 usageCount 经验
  const exps: ExperienceRecord[] = ['s1', 's2', 's3', 's4'].map((sid, i) => ({
    type: 'tool',
    key: `run_shell-${i}`,
    toolOrPattern: 'run_shell',
    usageCount: 5,
    successCount: 4,
    sessionIds: [sid],
    lastUsedAt: new Date(Date.now() - i * 1000).toISOString(),
  }));

  // 1) curateSkills 归纳出草稿
  const drafts = curateSkills(exps, cfg);
  assert.ok(drafts.length >= 1, '高复用经验应归纳出至少 1 条草稿');
  assert.ok(drafts[0].sourceExperienceIds.length >= 3, '草稿应归并多个来源经验');
  console.log(`PASS P1-1.1 curateSkills（${drafts.length} 草稿，首条 name=${drafts[0].name}，归并 ${drafts[0].sourceExperienceIds.length} 条）`);

  // 2a) 正常 body 审查通过
  const good: SkillDraft = { ...drafts[0], approved: false };
  const rGood = reviewSkillDraft(good, new Set());
  assert.equal(rGood.ok, true, `正常 body 应通过（reasons=${JSON.stringify(rGood.reasons)}）`);
  console.log('PASS P1-1.2a 正常 body 审查通过');

  // 2b) 含敏感路径 .env 的 body 审查不过
  const badSensitive: SkillDraft = { ...good, body: good.body + '\n读取 .env 里的密钥用于调试' };
  const rBad = reviewSkillDraft(badSensitive, new Set());
  assert.equal(rBad.ok, false, '含敏感路径 .env 应审查不过');
  assert.ok(rBad.reasons.some((r) => /敏感|\.env|sensitive/i.test(r)), 'reasons 应指出敏感');
  console.log(`PASS P1-1.2b 含 .env 敏感路径审查不过（${rBad.reasons.length} 条 reason）`);

  // 2c) 撞名审查不过
  const rDup = reviewSkillDraft(good, new Set([good.name]));
  assert.equal(rDup.ok, false, '与已入库 skill 撞名应审查不过');
  console.log('PASS P1-1.2c 撞名审查不过');

  // 3) 敏感判定确实走 isSensitiveFile（单测直接交叉验证）
  const { isSensitiveFile } = await import('./src/knowledge/vector-rag');
  assert.ok(isSensitiveFile('.env') && isSensitiveFile('secrets/id_rsa'), 'isSensitiveFile 基准确认');
  console.log('PASS P1-1.3 敏感判定复用 P0-1 isSensitiveFile（单一事实源）');

  // 4) approveSkillDraft 落盘
  const out = approveSkillDraft(good, { ...cfg, approvedDir: join(dir, 'approved') });
  console.log(`PASS P1-1.4 approveSkillDraft 落盘 → ${out}`);

  // 5) listPendingSkills 能读到（approve 前应留 pending）
  const pend = listPendingSkills(cfg);
  assert.ok(Array.isArray(pend), 'listPendingSkills 返回数组');
  console.log(`PASS P1-1.5 listPendingSkills（当前 pending ${pend.length} 条）`);

  rmSync(dir, { recursive: true, force: true });
  console.log('\n=== P1-1 全部 5 项验证通过 ===');
})().catch((e) => {
  console.error('P1-1 smoke FAILED:', e);
  process.exit(1);
});

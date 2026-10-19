/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 技能市场与脚手架命令
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { t } from '../../shared/i18n';
import { resolveHomeDir } from '../../shared/config';
import { resolveAccountHome } from '../../security/account';
import { ModelRouter } from '../../models/model-router';
import { fetchMarketIndex, searchMarket, installMarketSkill, isSchemaSupported } from '../../skills/skill-market';
import { discoverSkills } from '../../skills/skill-loader';
import { listExperiences, type Experience } from '../../agent/experience';

export async function runSkillNewCmd(name: string, opts: { template?: string; global?: boolean } = {}): Promise<void> {
  const templateId = opts.template ?? 'code-review';
  const templateDir = join(__dirname, '../../templates/skills', templateId);
  if (!existsSync(templateDir)) {
    console.error(`模板不存在: ${templateId}（可选：code-review/git-flow/api-design/refactor/test-gen/doc-gen/security-audit/performance/dependency-upgrade/onboarding/docx/pptx/xlsx/summarize/web-research）`);
    process.exitCode = 1;
    return;
  }
  if (!name || /[\\/:*?"<>|]/.test(name)) {
    console.error('Skill 名称非法（不能含 \\/:*?"<>| 且不能为空）');
    process.exitCode = 1;
    return;
  }
  const base = opts.global
    ? join(resolveHomeDir(), '.feihong-code', 'skills')
    : join(process.cwd(), '.fhcode', 'skills');
  const target = join(base, name);
  if (existsSync(target)) {
    console.error(`已存在: ${target}`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(target, { recursive: true });
  const src = readFileSync(join(templateDir, 'SKILL.md'), 'utf8');
  const rendered = src.replace(/{{SKILL_NAME}}/g, name);
  writeFileSync(join(target, 'SKILL.md'), rendered, 'utf8');
  console.log(`✓ 已创建 Skill: ${target}`);
  console.log(`  模板: ${templateId}（可直接编辑 SKILL.md 定制）`);
}

/* ===================== P3-3：插件管理 ===================== */
/** fhcode plugin install <source> / plugin list：插件打包分发管理 */

/* ===================== Skills 市场 ===================== */

/** 技能分类映射（用于 list/search 分类浏览，对标生态平台分类；未知归「通用」） */
const SKILL_CATEGORIES: Record<string, string> = {
  goal: '自管理', plan: '自管理', grill: '安全审计', 'self-evolve': '自管理', 'self-heal': '自管理',
  'geo-faq-deploy': '部署',
  docx: '办公文档', pptx: '办公文档', xlsx: '办公文档',
  summarize: '调研摘要', 'web-research': '调研摘要',
  'code-review': '编码开发', 'git-flow': '编码开发', 'api-design': '编码开发', refactor: '编码开发',
  'test-gen': '编码开发', 'doc-gen': '办公文档', 'security-audit': '安全审计', performance: '编码开发',
  'dependency-upgrade': '编码开发', onboarding: '其他',
};
/** 飞虹官方精选（★ 标记，作为推荐/信任信号，对标生态平台榜单） */
const FEATURED = new Set<string>([
  'goal', 'plan', 'grill', 'docx', 'pptx', 'xlsx', 'summarize', 'web-research',
  'code-review', 'security-audit',
]);
function categoryOf(name: string): string {
  return SKILL_CATEGORIES[name] ?? '通用';
}
function featuredStar(name: string): string {
  return FEATURED.has(name) ? ' ★' : '';
}

/** 默认市场源（agentskills.io 官方规范端点；可用 --repo 或 FH_SKILL_MARKET 覆盖） */
const DEFAULT_MARKET = process.env.FH_SKILL_MARKET || 'https://agentskills.io';

/** fhcode skill-market search <关键词> | install <技能名> | list */
export async function runSkillMarketCmd(action: 'search' | 'install' | 'list', query?: string, market?: string): Promise<void> {
  const base = market || DEFAULT_MARKET;

  if (action === 'list') {
    // 列出本地已安装技能（复用技能发现，含打包/仓库/用户级）
    const skills = discoverSkills(process.cwd());
    if (skills.length === 0) {
      console.log(t('skillMarket.localEmpty'));
      return;
    }
    console.log(t('skillMarket.localTitle', { n: skills.length }));
    // 按分类分组展示（对标生态平台分类浏览）
    const groups: Record<string, typeof skills> = {};
    for (const s of skills) {
      const cat = categoryOf(s.name);
      (groups[cat] ||= []).push(s);
    }
    for (const cat of Object.keys(groups).sort()) {
      console.log(`\n  [${cat}]`);
      for (const s of groups[cat]) {
        console.log(`    ${s.name.padEnd(22)}${featuredStar(s.name)} ${s.description.slice(0, 48)}`);
      }
    }
    console.log('\n  ★ = 飞虹官方精选（推荐榜）');
    return;
  }

  // search / install 需拉索引；网络不可达时回退本地种子源（P4-3）
  let index;
  try {
    index = await fetchMarketIndex(base);
  } catch (e) {
    const localSeed = join(__dirname, '../../templates/market/index.json');
    if (existsSync(localSeed)) {
      try {
        index = JSON.parse(readFileSync(localSeed, 'utf8'));
        index.source = 'local:seed';
        console.log(t('skillMarket.localSeed'));
      } catch {
        console.error(t('skillMarket.fetchFailed', { base }) + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
        return;
      }
    } else {
      console.error(t('skillMarket.fetchFailed', { base }) + (e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
      return;
    }
  }
  if (!isSchemaSupported(index.schema)) {
    console.warn(t('skillMarket.schemaWarn', { schema: index.schema ?? '?' }));
  }

  if (action === 'search') {
    const results = searchMarket(index, query ?? '');
    if (results.length === 0) {
      console.log(t('skillMarket.searchEmpty', { q: query ?? '' }));
      return;
    }
    console.log(t('skillMarket.searchTitle', { q: query ?? '', n: results.length, base }));
    for (const s of results) {
      console.log(`  ${s.name.padEnd(26)} [${categoryOf(s.name)}] ${s.description.slice(0, 54)}`);
    }
    console.log(t('skillMarket.installHint'));
    return;
  }

  // install
  if (!query) {
    console.error(t('skillMarket.installUsage'));
    process.exitCode = 1;
    return;
  }
  const skill = index.skills.find((s: { name: string }) => s.name === query);
  if (!skill) {
    console.error(t('skillMarket.notFound', { name: query }));
    process.exitCode = 1;
    return;
  }
  const destDir = join(resolveHomeDir(), 'skills');
  try {
    // P4-3: 本地种子源（url 以 local: 开头）→ 直接从官方模板复制，不依赖网络
    if (skill.url.startsWith('local:')) {
      const tid = skill.url.slice('local:'.length);
      const tdir = join(__dirname, '../../templates/skills', tid);
      if (!existsSync(tdir)) {
        console.error(t('skillMarket.notFound', { name: skill.name }));
        process.exitCode = 1;
        return;
      }
      const target = join(destDir, skill.name);
      mkdirSync(target, { recursive: true });
      copyFileSync(join(tdir, 'SKILL.md'), join(target, 'SKILL.md'));
      console.log(t('skillMarket.installed', { name: skill.name, dir: target }));
    } else {
      const target = await installMarketSkill(index, skill, destDir);
      console.log(t('skillMarket.installed', { name: skill.name, dir: target }));
    }
    // P5-3: 自动注册闭环——安装后立即用 discoverSkills 验证已被本地索引发现
    const discovered = discoverSkills(process.cwd());
    const expectedFile = join(destDir, skill.name, 'SKILL.md');
    const registered = discovered.some((s) => s.file === expectedFile);
    console.log(registered
      ? t('skillMarket.registered', { name: skill.name, n: discovered.length })
      : t('skillMarket.notRegisteredWarn', { name: skill.name }));
  } catch (e) {
    console.error(t('skillMarket.installFailed') + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  }
}

/** fhcode model-stats：显示各模型性能统计 */
export function runModelStats(): void {
  const homeDir = resolveHomeDir();
  const statsFile = join(homeDir, 'model-stats.jsonl');
  if (!existsSync(statsFile)) {
    console.log(t('modelStats.empty'));
    return;
  }
  const router = new ModelRouter([], 'cost', 0, statsFile);
  router.loadStats(homeDir).then(() => {
    const stats = router.getStats();
    if (stats.length === 0) {
      console.log(t('modelStats.noRecords'));
      return;
    }
    console.log(t('modelStats.title'));
    console.log(t('modelStats.tableHeader'));
    for (const s of stats) {
      console.log(
        `  ${s.providerId.padEnd(16)} ${s.model.padEnd(18)} ${String(s.totalCalls).padStart(5)} ${String(s.successfulCalls).padStart(5)} ${String(s.failedCalls).padStart(5)} ${s.successRate.toFixed(2).padStart(6)} ${s.avgLatencyMs.toFixed(0).padStart(8)}ms $${s.totalCostUsd.toFixed(6)}`,
      );
    }
  });
}

/** fhcode experiences [路径]：列出经验库（默认按激活账号隔离） */
export function runExperiences(path?: string): void {
  const experienceDir = path || join(resolveAccountHome(), 'experiences');
  listExperiences(experienceDir).then((experiences: Experience[]) => {
    if (experiences.length === 0) {
      console.log(t('exp.empty'));
      return;
    }
    console.log(t('exp.header', { n: experiences.length, dir: experienceDir }));
    console.log(t('exp.tableHeader'));
    for (const exp of experiences.slice(0, 10)) {
      console.log(
        `  ${exp.id.padEnd(30)} ${exp.type.padEnd(16)} ${exp.title.slice(0, 25).padEnd(25)} ${(exp.metadata.successRate * 100).toFixed(0).padStart(4)}%    ${String(exp.metadata.sessionCount).padStart(4)}`,
      );
    }
    if (experiences.length > 10) {
      console.log(t('exp.more', { n: experiences.length }));
    }
  });
}

/* ===================== M5：Web 控制台（serve） ===================== */

/** fhcode serve：启动 Web 管理控制台。无 FH_WEB_PORT 用 8080；无 FH_WEB_TOKEN 自动生成。 */

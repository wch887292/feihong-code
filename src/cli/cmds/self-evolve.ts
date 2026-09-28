/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 自我迭代元技能命令
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { t } from '../../shared/i18n';
import { listExperiences } from '../../agent/experience';
import { createSelfImprover } from '../../agent/self-improver';

export async function runSelfImprove(): Promise<void> {
  const improver = createSelfImprover();
  const records = improver.loadImprovements();
  const stats = improver.getStats();
  console.log(t('selfimp.title'));
  console.log(t('selfimp.reflections', { n: stats.totalReflections }));
  console.log(t('selfimp.successRate', { p: (stats.successRate * 100).toFixed(1) }));
  console.log(t('selfimp.avgDuration', { ms: stats.avgDurationMs.toFixed(0) }));

  // 经验库概览（与 orchestrator 共用同一库，体现回流闭环）
  const exps = await listExperiences(improver.experienceStoreDir);
  const totalWeight = exps.reduce((s, e) => s + e.metadata.sessionCount, 0);
  console.log('\n' + t('selfimp.expLib', { n: exps.length, w: totalWeight }));
  if (exps.length > 0) {
    console.log('\n' + t('selfimp.topExp'));
    for (const e of exps.slice(0, 6)) {
      console.log(t('selfimp.expItem', { count: e.metadata.sessionCount, type: e.type, title: e.title }));
    }
  }

  if (records.length > 0) {
    console.log('\n' + t('selfimp.recent'));
    for (const rec of records.slice(-5).reverse()) {
      console.log(t('selfimp.record', { ts: rec.timestamp.slice(0, 19), ok: rec.success ? '✅' : '❌', n: rec.patterns.length }));
      for (const imp of rec.improvements.slice(0, 3)) {
        console.log(t('selfimp.improvement', { imp }));
      }
    }
  } else {
    console.log('\n' + t('selfimp.noRecords'));
  }

  // 学习提示预览：模拟一次任务，展示将注入模型的经验
  console.log('\n' + t('selfimp.learnPreview', { goal: '实现一个 REST API 功能' }));
  const learned = await improver.getLearnedPrompt('实现一个 REST API 功能');
  console.log(learned || t('selfimp.noLearned'));
}

/** fhcode self-evolve <子命令>：自我迭代元技能系统（失败记录 / 技能库 / 每日复盘 / 错误模式分析）。
 *  复用 self-evolve-cli.js 的 runCli（自包含零依赖实现），避免重复逻辑。 */
export async function runSelfEvolve(action: string, args: string[]): Promise<void> {
  // 该模块为 CommonJS JS 文件，无类型声明；此处用 createRequire 显式加载。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runCli } = require('../self-evolve-cli.js') as { runCli: (argv: string[]) => void };
  runCli([action, ...args]);
}

/* ===================== M9：全自动软件工程 Agent ===================== */


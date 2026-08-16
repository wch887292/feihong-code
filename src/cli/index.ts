#!/usr/bin/env node
/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * CLI 入口：参数解析 → 版本/帮助/单命令/REPL/管理命令 分发
 */
import { randomUUID } from 'crypto';
import { setRunId } from '../shared/logger';
import { AppError } from '../shared/errors';
import { loadDotEnv } from '../shared/config';
import { parseArgs, type SkillCommand, type ManagementCommand } from './commands';
import { startRepl } from './repl';
import {
  runGoal,
  isOfflineByDefault,
  runPlanSkill,
  runGrillSkill,
  runGoalSkill,
  runParallelGoal,
  runSessions,
  runResume,
  runDiff,
  runRollback,
  runWhoami,
  runPolicyCmd,
  runAudit,
  runAuditVerify,
  runTenants,
  runDoctor,
  runPluginCmd,
  runSkillMarketCmd,
  runTeamCmd,
  runServe,
  runCodeWrite,
  runQualityGate,
  runSelfImprove,
  runSwe,
  runModelStats,
  runExperiences,
} from './run';
import { VERSION } from './version';
import { setLang, t } from '../shared/i18n';

function printVersion(): void {
  console.log(`fhcode v${VERSION}`);
  console.log(`${t('app.product')} — ${t('app.tagline')}`);
  console.log(t('app.signature'));
}

function printHelp(): void {
  console.log(t('cli.help', { version: VERSION, signature: t('app.signature') }));
}

async function main(): Promise<void> {
  setRunId(randomUUID());
  loadDotEnv(); // 尽早加载 .env（须在 isOfflineByDefault / loadConfig 之前）

  const args = parseArgs(process.argv.slice(2));
  setLang(args.flags.lang);

  if (args.flags.version) {
    printVersion();
    return;
  }
  if (args.flags.help) {
    printHelp();
    return;
  }
  if (args.skill) {
    await dispatchSkill(args.skill);
    return;
  }
  if (args.manage) {
    await dispatchManage(args.manage);
    return;
  }
  if (args.flags.parallel && args.command) {
    await runParallelGoal(args.command);
    return;
  }
  if (args.command) {
    const offline = isOfflineByDefault();
    await runGoal(args.command, { offline, stream: args.flags.stream });
    return;
  }

  await startRepl();
}

async function dispatchSkill(skill: { kind: SkillCommand; arg: string }): Promise<void> {
  if (skill.kind === 'plan') console.log(runPlanSkill(skill.arg || ''));
  else if (skill.kind === 'grill') console.log(runGrillSkill(skill.arg || '.'));
  else console.log(runGoalSkill(skill.arg || ''));
}

async function dispatchManage(m: ManagementCommand): Promise<void> {
  switch (m.kind) {
    case 'sessions': await runSessions(); break;
    case 'resume': await runResume(m.id); break;
    case 'diff': await runDiff(m.id); break;
    case 'rollback': await runRollback(m.id, m.yes); break;
    case 'whoami': runWhoami(); break;
    case 'policy': runPolicyCmd(); break;
    case 'audit': if (m.verify) runAuditVerify(); else runAudit(m.limit); break;
    case 'tenants': runTenants(); break;
    case 'doctor': await runDoctor(); break;
    case 'plugin': await runPluginCmd(m.action, m.source); break;
    case 'skill-market': await runSkillMarketCmd(m.action, m.query, m.market); break;
    case 'team': await runTeamCmd(m.goal); break;
    case 'serve': runServe(m.port); break;
    case 'code-write': runCodeWrite(m.goal); break;
    case 'quality-gate': runQualityGate(m.path); break;
    case 'self-improve': await runSelfImprove(); break;
    case 'model-stats': runModelStats(); break;
    case 'experiences': runExperiences(m.path); break;
    case 'swe': await runSwe(m.goal, {
      repo: m.repo,
      maxTasks: m.maxTasks,
      maxRetries: m.maxRetries,
      maxIterations: m.maxIterations,
      verifyOnly: m.verifyOnly,
      planOnly: m.planOnly,
    }); break;
  }
}

main().catch((err: unknown) => {
  setRunId(randomUUID());
  if (err instanceof AppError) {
    console.error(t('err.runFailed', { code: err.code, message: err.message }));
  } else {
    console.error(t('err.unexpected') + (err instanceof Error ? err.message : String(err)));
  }
  console.error(t('err.hint'));
  process.exit(1);
});

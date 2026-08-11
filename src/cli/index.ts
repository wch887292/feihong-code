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
import { parseArgs } from './commands';
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
  runServe,
  runCodeWrite,
  runQualityGate,
  runSelfImprove,
  runSwe,
} from './run';
import { VERSION, PRODUCT, TAGLINE, SIGNATURE } from './version';

function printVersion(): void {
  console.log(`fhcode v${VERSION}`);
  console.log(`${PRODUCT} — ${TAGLINE}`);
  console.log(SIGNATURE);
}

function printHelp(): void {
  console.log(`飞虹 Code (fhcode) v${VERSION}

用法:
  fhcode                             进入交互 REPL
  fhcode "<需求>"                   单命令模式执行一条需求
  fhcode --parallel "<需求>"         多子代理并行（M2：git worktree 隔离）
  fhcode /plan "<目标>"              生成实现计划（只读）
  fhcode /grill [路径]               红队式代码审查（只读）
  fhcode /goal "<目标>"              分解并保存高层目标
  fhcode sessions                    列出历史会话（M3 恢复与审计）
  fhcode resume <id>                 从检查点恢复中断的会话（M3）
  fhcode diff [<id>]                 展示会话/工作区变更（M3）
  fhcode rollback <id> [--yes]       回滚会话改动（M3，危险操作需 --yes）

企业能力 (M4):
  fhcode whoami                      当前租户 / 用户 / 角色 / 隔离目录 / 配额
  fhcode policy                      查看生效的 RBAC 策略与角色矩阵
  fhcode audit [--limit N]           查看审计记录（默认最近 20 条）
  fhcode audit verify                校验审计哈希链是否被篡改
  fhcode tenants                     列出全部租户与用量汇总

自我进化 (M6):
  fhcode model-stats                 查看各模型性能统计
  fhcode experiences [路径]          列出经验库

Web 控制台 (M5):
  fhcode serve [--port 8080]         启动 Web 管理控制台（默认 http://localhost:8080）
                                    令牌由 FH_WEB_TOKEN 或自动生成（控制台仅观测，不执行）

自主编程 (M8):
  fhcode code-write "<目标>"         自主编写代码（规划→编写→测试→审查→修复）
  fhcode quality-gate [路径]         质量门禁审查（安全+质量+测试覆盖）
  fhcode self-improve                自我改进统计与历史

全自动软件工程 Agent (M9):
  fhcode swe "<目标>"                读取仓库→拆解规划→实现+验证+自愈→报告
                                     --repo <路径> 指定仓库(默认当前目录)
                                     --plan-only 仅规划不执行
                                     --verify-only 仅跑验证不实现
                                     --max-tasks N 限制子任务数(默认8)
                                     --max-retries N 单任务自愈重试(默认2)

  fhcode --version                   显示版本 (-v)
  fhcode --help                      显示帮助 (-h)

说明: 未配置 FH_PROVIDERS 时自动进入离线模式（脚本化 Mock 驱动闭环验证）。
配置 FH_PROVIDERS（OpenAI 兼容 / Ollama）后，将调用真实大模型执行任务。
企业模式默认开启（租户隔离 + RBAC + 审计链 + 配额），可用 FH_ENTERPRISE=false 关闭。
署名: ${SIGNATURE}`);
}

async function main(): Promise<void> {
  setRunId(randomUUID());
  loadDotEnv(); // 尽早加载 .env（须在 isOfflineByDefault / loadConfig 之前）

  const args = parseArgs(process.argv.slice(2));

  if (args.flags.version) {
    printVersion();
    return;
  }
  if (args.flags.help) {
    printHelp();
    return;
  }
  if (args.skill) {
    if (args.skill.kind === 'plan') {
      console.log(runPlanSkill(args.skill.arg || ''));
    } else if (args.skill.kind === 'grill') {
      console.log(runGrillSkill(args.skill.arg || '.'));
    } else if (args.skill.kind === 'goal') {
      console.log(runGoalSkill(args.skill.arg || ''));
    }
    return;
  }
  if (args.manage) {
    const m = args.manage;
    if (m.kind === 'sessions') {
      await runSessions();
    } else if (m.kind === 'resume') {
      await runResume(m.id);
    } else if (m.kind === 'diff') {
      await runDiff(m.id);
    } else if (m.kind === 'rollback') {
      await runRollback(m.id, m.yes);
    } else if (m.kind === 'whoami') {
      runWhoami();
    } else if (m.kind === 'policy') {
      runPolicyCmd();
    } else if (m.kind === 'audit') {
      if (m.verify) runAuditVerify();
      else runAudit(m.limit);
    } else if (m.kind === 'tenants') {
      runTenants();
    } else if (m.kind === 'serve') {
      runServe(m.port);
    } else if (m.kind === 'code-write') {
      runCodeWrite(m.goal);
    } else if (m.kind === 'quality-gate') {
      runQualityGate(m.path);
    } else if (m.kind === 'self-improve') {
      runSelfImprove();
    } else if (m.kind === 'swe') {
      await runSwe(m.goal, {
        repo: m.repo,
        maxTasks: m.maxTasks,
        maxRetries: m.maxRetries,
        maxIterations: m.maxIterations,
        verifyOnly: m.verifyOnly,
        planOnly: m.planOnly,
      });
    }
    return;
  }
  if (args.flags.parallel && args.command) {
    await runParallelGoal(args.command);
    return;
  }
  if (args.command) {
    const offline = isOfflineByDefault();
    await runGoal(args.command, { offline });
    return;
  }

  await startRepl();
}

main().catch((err: unknown) => {
  setRunId(randomUUID());
  if (err instanceof AppError) {
    console.error(`[飞虹 Code] 运行失败 (${err.code}): ${err.message}`);
  } else {
    console.error('运行出错:', err instanceof Error ? err.message : String(err));
  }
  console.error('（详细日志见结构化 JSON 输出；配置类错误请检查 FH_PROVIDERS / .env）');
  process.exit(1);
});

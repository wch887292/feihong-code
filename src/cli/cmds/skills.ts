/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 技能与并行入口命令（M2）
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../../shared/logger';
import { t } from '../../shared/i18n';
import { loadConfig } from '../../shared/config';
import { ModelRouter } from '../../models/model-router';
import type { OrchestratorSecurity } from '../../agent/orchestrator';
import { runParallel, defaultParallelMock } from '../../agent/parallel-orchestrator';
import { runPlan } from '../../skills/plan';
import { runGrill } from '../../skills/grill';
import { decomposeGoalToGoal, saveGoal, renderGoal } from '../../skills/goal';
import { runSelfHeal } from '../../skills/self-heal';
import { executeTask, getEnterprise, isOfflineByDefault, defaultApproverFor, expandHome, joinHome, type RunOptions } from '../../core/task-executor';

export async function runGoal(goal: string, opts: RunOptions = {}): Promise<void> {
  const result = await executeTask(goal, opts);
  const offline = opts.offline ?? isOfflineByDefault();

  // 只输出最终答案，不打印迭代数、成本、日志路径等技术信息
  if (result.finalAnswer.trim()) {
    console.log('');
    console.log(result.finalAnswer.trim());
    console.log('');
  }

  if (offline) {
    const demoFile = join(process.cwd(), 'demo-output.txt');
    logger.info('offline-run done', { cwd: process.cwd(), demoFile });
    if (existsSync(demoFile)) {
      console.log(t('run.offlineFileYes', { file: demoFile }));
    }
  }
}

/* ===================== M2：技能与并行入口 ===================== */

/** /plan 技能：生成结构化实现计划（只读，不修改代码） */
export function runPlanSkill(goal: string): string {
  const out = runPlan(goal);
  const lines = [
    `【/plan】目标: ${out.goal}`,
    `预计并行工作树: ${out.estimatedWorktrees}`,
    `步骤:`,
    ...out.items.map((it) => `  ${it.step}. ${it.action}\n     目标: ${it.target} | 风险: ${it.risk}`),
    `备注: ${out.note}`,
  ];
  return lines.join('\n');
}

/** /grill 技能：红队式代码审查（只读） */
export function runGrillSkill(target: string): string {
  const result = runGrill(process.cwd(), target || '.');
  const lines = [
    `【/grill】${result.summary}`,
    ...result.findings.map(
      (f) => `  [${f.severity.toUpperCase()}] ${f.file}:${f.line} (${f.rule}) ${f.detail}`,
    ),
    result.findings.length === 0 ? '  未发现明显问题。' : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * M1.1a `fhcode review [路径] [--json]`：红队式代码审查的结构化版本。
 *  - 文本模式：与 /grill 输出一致（人类可读）
 *  - --json 模式：输出完整结构（scanned/findings/summary），供 IDE 内联评审等消费
 */
export function runReviewCmd(path: string, asJson: boolean): void {
  const result = runGrill(process.cwd(), path || '.');
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`【review】${result.summary}`);
  for (const f of result.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.file}:${f.line} (${f.rule}) ${f.detail}`);
  }
  if (result.findings.length === 0) console.log('  未发现明显问题。');
}

/** /goal 技能：分解并保存高层目标（M4 起写入租户隔离目录 tenants/<id>/goals） */
export function runGoalSkill(title: string): string {
  const goal = decomposeGoalToGoal(title);
  const rt = getEnterprise();
  // saveGoal 内部会拼接 goals 子目录，这里给它租户根目录
  const home = rt
    ? dirname(rt.tenant.goalDir)
    : process.env.FH_HOME
      ? expandHome(process.env.FH_HOME)
      : joinHome();
  const file = saveGoal(goal, home);
  if (rt) {
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId: goal.id,
      action: 'skill:goal',
      resource: title,
      decision: 'info',
      reason: `保存至 ${file}`,
    });
  }
  return `【/goal】已保存\n${renderGoal(goal)}\n文件: ${file}`;
}

/** /self-heal 技能：系统化自我修复错误（分类 → 根因 → 修复建议 → 验证步骤） */
export function runSelfHealSkill(errorText: string): string {
  const out = runSelfHeal(errorText);
  if (getEnterprise()) {
    // 审计留痕（脱敏由 audit.ts 处理），便于追溯自愈诊断过程
    try {
      const rt = getEnterprise();
      if (rt) {
        rt.audit.record({
          tenantId: rt.tenant.tenantId,
          userId: rt.tenant.userId,
          role: rt.tenant.role,
          runId: randomUUID(),
          action: 'skill:self-heal',
          resource: out.category,
          decision: out.known ? 'info' : 'deny',
          reason: out.known ? '自动分类完成' : '未能自动分类，需人工介入',
        });
      }
    } catch {
      /* 审计失败不阻断技能输出 */
    }
  }
  return out.text;
}

/**
 * M10：是否启用第一性原理拆解并行（DAG 分波次）。
 * 默认开启；可用环境变量 FH_FIRST_PRINCIPLES=0 关闭以回退到旧的连词规则拆分。
 */
function isFirstPrinciplesByDefault(): boolean {
  const v = (process.env.FH_FIRST_PRINCIPLES ?? '').trim().toLowerCase();
  if (v === '') return true; // 默认开启
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

/** --parallel 并行多子代理执行（离线用 Mock；真实模式接入 FH_PROVIDERS 路由） */
export async function runParallelGoal(goal: string): Promise<void> {
  const offline = isOfflineByDefault();
  const firstPrinciples = isFirstPrinciplesByDefault();
  console.log(t('run.parallelMode', { offline: offline ? t('run.modeOffline') : t('run.modeLive') }));
  console.log(`[飞虹 Code] 任务拆解: ${firstPrinciples ? '第一性原理（领域本质 + DAG 分波次并行）' : '传统连词规则'}`);

  if (!offline) {
    const cfg = loadConfig();
    const router = ModelRouter.fromConfig(cfg);
    const security: OrchestratorSecurity = {
      shellAllowlist: cfg.security.shellAllowlist,
      requireApproval: cfg.security.requireApproval,
    };
    const result = await runParallel(goal, {
      offline: false,
      router,
      approve: defaultApproverFor(security),
      firstPrinciples,
    });
    console.log('\n' + t('run.parallelResult'));
    console.log(result.summary);
    console.log(t('run.parallelRepo', { root: result.repoRoot, trees: result.worktrees.length }));
    return;
  }

  const result = await runParallel(goal, {
    offline: true,
    mockFor: (task) => defaultParallelMock(task),
    firstPrinciples,
  });
  console.log('\n' + t('run.parallelResult'));
  console.log(result.summary);
  console.log(t('run.parallelRepo', { root: result.repoRoot, trees: result.worktrees.length }));
}

/* ===================== M3：会话管理（resume / diff / rollback） ===================== */

/** 按完整 id 或前缀解析会话检查点（sessions 列表默认展示 8 位前缀，便于直接引用） */

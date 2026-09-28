/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 运维/集成命令（doctor / plugin / team / serve）
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { t } from '../../shared/i18n';
import { loadConfig, resolveHomeDir } from '../../shared/config';
import { runCommand } from '../../tools/shell/exec';
import { startWebServer } from '../../web/server';
import { scheduleDailySummary } from '../../memory/auto-summarize';
import { scheduleSelfHeal, runSelfHealIfDue } from '../../self-evolve/self-heal-scheduler';
import { installPlugin, listPlugins } from '../../plugins/plugin-loader';
import { runTeam } from '../../agent/team';
import { executeTask, isOfflineByDefault } from '../../core/task-executor';

async function probeUrl(base: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(base.replace(/\/+$/, ''), { method: 'GET', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fhcode doctor：环境自检（版本 / git / 配置 / provider / 路径可写 / 网络连通）。
 * 全部通过输出 ✅，异常项以 ⚠️ 列明，帮助快速定位接入问题。
 */
export async function runDoctor(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // 1. Node 版本（engines >= 18）
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: t('doctor.node'),
    ok: nodeMajor >= 18,
    detail: `Node ${process.version}（要求 >=18）`,
  });

  // 2. git 可用性（diff/rollback/并行 worktree 依赖）
  const git = await runCommand('git --version', process.cwd(), 5000).catch(() => null);
  checks.push({
    name: t('doctor.git'),
    ok: !!git && git.code === 0,
    detail: git && git.code === 0 ? (git.stdout || git.stderr).trim() : t('doctor.gitMissing'),
  });

  // 3. 配置加载 + provider 明细 + 网络连通
  try {
    const cfg = loadConfig();
    if (cfg.models.providers.length === 0) {
      checks.push({ name: t('doctor.config'), ok: true, detail: t('doctor.configEmpty') });
    } else {
      checks.push({ name: t('doctor.config'), ok: true, detail: `${cfg.models.providers.length} providers` });
      for (const p of cfg.models.providers) {
        checks.push({
          name: `${t('doctor.provider')} ${p.id}`,
          ok: !!p.baseURL,
          detail: `${p.type} @ ${p.baseURL || '（缺 baseURL）'}${p.model ? ` · model=${p.model}` : ''}`,
        });
      }
    }
    // 网络探测：仅真实模式且有 provider 时执行；离线模式直接跳过
    if (!isOfflineByDefault() && cfg.models.providers.length > 0) {
      const base = cfg.models.providers[0].baseURL;
      if (base) {
        const reachable = await probeUrl(base);
        checks.push({
          name: t('doctor.network'),
          ok: reachable,
          detail: reachable ? `${base} 可达` : `${base} 不可达`,
        });
      }
    } else {
      checks.push({ name: t('doctor.network'), ok: true, detail: t('doctor.networkOffline') });
    }
  } catch (e) {
    checks.push({
      name: t('doctor.config'),
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. 主目录可写（会话/审计/经验/统计落盘依赖）
  const homeDir = resolveHomeDir();
  let homeOk = true;
  let homeDetail = homeDir;
  try {
    mkdirSync(homeDir, { recursive: true });
    const probe = join(homeDir, '.doctor-probe');
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
  } catch (e) {
    homeOk = false;
    homeDetail = `${homeDir}（${e instanceof Error ? e.message : String(e)}）`;
  }
  checks.push({ name: t('doctor.home'), ok: homeOk, detail: homeDetail });

  // 5. 沙箱模式（P0-2）
  try {
    const cfg = loadConfig();
    const sandboxDetail =
      `${cfg.security.sandboxMode}` +
      (cfg.security.networkDeny.length > 0 ? ` · deny: ${cfg.security.networkDeny.join(',')}` : '') +
      (cfg.security.networkAllow.length > 0 ? ` · allow: ${cfg.security.networkAllow.join(',')}` : '');
    checks.push({ name: t('doctor.sandbox'), ok: true, detail: sandboxDetail });
  } catch {
    checks.push({ name: t('doctor.sandbox'), ok: false, detail: t('doctor.sandboxUnavailable') });
  }

  // 6. Docker 沙箱档位探测（P5-4 container 模式执行层依赖）
  try {
    const docker = await runCommand('docker --version', process.cwd(), 5000).catch(() => null);
    const dockerOk = !!docker && docker.code === 0;
    const cfg6 = loadConfig();
    const mode = cfg6.security.sandboxMode;
    checks.push({
      name: t('doctor.docker'),
      ok: mode !== 'container' || dockerOk, // container 模式下必须可用；其他模式仅为提示
      detail: dockerOk
        ? `${(docker?.stdout || docker?.stderr || 'docker 可用').trim()} · sandbox=${mode}`
        : `docker 不可用（container 沙箱模式无法执行）· sandbox=${mode}`,
    });
  } catch {
    checks.push({ name: t('doctor.docker'), ok: true, detail: 'docker 探测跳过' });
  }

  // 输出
  console.log(t('doctor.title'));
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`  ${c.ok ? '✅' : '⚠️'} ${c.name}: ${c.detail}`);
  }
  console.log(failed.length === 0 ? t('doctor.allOk') : t('doctor.issues', { n: failed.length }));
}

/** `fhcode skill-new <name> [--template <id>] [--global]`：从官方模板脚手架生成 Skill（P0-3 生态） */

export async function runPluginCmd(action: 'install' | 'list', source?: string): Promise<void> {
  if (action === 'install') {
    if (!source) {
      console.error(t('plugin.installUsage'));
      return;
    }
    try {
      const { name, dir } = await installPlugin(source);
      console.log(t('plugin.installed', { name, dir }));
    } catch (e) {
      console.error(t('plugin.installFailed') + (e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
    }
    return;
  }
  // list
  const plugins = listPlugins(process.cwd());
  if (plugins.length === 0) {
    console.log(t('plugin.empty'));
    return;
  }
  console.log(t('plugin.listTitle'));
  for (const p of plugins) {
    console.log(`  ${p.name.padEnd(24)} v${p.version}  ${p.description ?? ''}`);
  }
}

/* ===================== P4-2：Agent teams ===================== */

/** fhcode team "<目标>"：多 agent 协作执行（共享任务清单 + 消息总线） */
export async function runTeamCmd(goal: string): Promise<void> {
  const offline = isOfflineByDefault();
  console.log(t('team.start', { mode: offline ? t('run.modeOffline') : t('run.modeLive') }));

  // 目标拆解为任务清单（复用 planner 的并列连词拆分；拆不开则单任务）
  const { decomposeGoal } = await import('../../agent/planner');
  const tasks = decomposeGoal(goal).map((t) => t.goal);
  if (tasks.length === 0) tasks.push(goal);

  const report = await runTeam(tasks, {
    runSubTask: async (focusedGoal) => {
      const result = await executeTask(focusedGoal, { offline });
      return { ok: result.ok, finalAnswer: result.finalAnswer, iterations: result.iterations };
    },
    pollIntervalMs: offline ? 0 : 100,
  });

  console.log('\n' + t('team.reportTitle'));
  console.log(report.summary);
}

export function runServe(port?: number): void {
  const handle = startWebServer({ port });
  console.log(t('serve.url', { url: handle.url }));
  console.log(t('serve.token', { token: handle.token }));
  console.log(t('serve.stop'));
  // 启动每日记忆总结定时器（每天 00:00 UTC）
  scheduleDailySummary();
  // 自我修复调度：每天 00:00 统一执行；常驻进程启动时若今日未做则补做（"第二天第一次开机修复"）
  scheduleSelfHeal();
  void runSelfHealIfDue().catch(() => {});
  // 注意：app.listen 保持事件循环运行，进程持续存活直到收到 SIGINT；本函数返回后 main() 结束不影响服务。
}

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 全自动软件工程 Agent 命令（M9）
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { randomUUID } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setRunId } from '../../shared/logger';
import { t } from '../../shared/i18n';
import { loadConfig } from '../../shared/config';
import { ModelRouter } from '../../models/model-router';
import { ScriptedMockProvider } from '../../models/providers/mock.provider';
import { createDefaultRegistry } from '../../tools';
import { attachMcpTools, closeMcpClients } from '../../tools/mcp';
import { McpClient } from '../../tools/mcp/mcp-client';
import { EventLog } from '../../runtime/event-log';
import { SessionStore } from '../../runtime/session-store';
import { saveCheckpoint } from '../../runtime/session-persist';
import { assertQuota } from '../../enterprise';
import { Orchestrator, type OrchestratorSecurity } from '../../agent/orchestrator';
import { runSweAgent, type SweReport, type SubTaskOutcome } from '../../agent/swe-agent';
import { summarizeSubTaskAnswer } from '../../agent/subagent-summary';
import { getEnterprise, isOfflineByDefault, getSessionHome, buildDemoSteps, interactiveApprover, defaultApproverFor } from '../../core/task-executor';

export interface SweOptions {
  repo?: string;
  maxTasks?: number;
  maxRetries?: number;
  maxIterations?: number;
  verifyOnly?: boolean;
  planOnly?: boolean;
  offline?: boolean;
}

/**
 * fhcode swe "<目标>"：全自动软件工程 Agent
 * 读取整个仓库 → 任务拆解 → 逐任务(实现+验证+自愈) → 产出报告。
 * 实现阶段复用 Orchestrator（ReAct + 工具 + 自愈）；验证阶段跑构建/测试。
 */
export async function runSwe(goal: string, opts: SweOptions = {}): Promise<void> {
  const offline = opts.offline ?? isOfflineByDefault();
  const cwd = opts.repo
    ? require('path').resolve(opts.repo)
    : offline
      ? mkdtempSync(join(tmpdir(), 'fhcode-swe-'))
      : process.cwd();

  const rt = getEnterprise();
  if (rt) assertQuota(rt);
  const security: OrchestratorSecurity = { shellAllowlist: [], requireApproval: true };

  // 真实模式就绪检查：未配置任何模型供应商时给出明确接入指引，避免盲目失败
  if (!offline) {
    const cfg = loadConfig();
    if (!cfg.models.providers.length) {
      console.error(t('swe.noProvider'));
      return;
    }
  }

  /** 实现单个子任务的回调：内部装配一个 Orchestrator 实例并运行 */
  const runSubTask = async (focusedGoal: string): Promise<SubTaskOutcome> => {
    const runId = randomUUID();
    setRunId(runId);
    let router: ModelRouter;
    if (offline) {
      router = new ModelRouter([new ScriptedMockProvider(buildDemoSteps())], 'cost', 0);
    } else {
      const cfg = loadConfig();
      router = ModelRouter.fromConfig(cfg);
      security.shellAllowlist = cfg.security.shellAllowlist;
      security.requireApproval = cfg.security.requireApproval;
      security.sandboxMode = cfg.security.sandboxMode;
      security.networkRules = { networkAllow: cfg.security.networkAllow, networkDeny: cfg.security.networkDeny };
      security.hooks = cfg.hooks;
    }
    const tools = createDefaultRegistry();
    // P0-3：附加 MCP 外部工具（真实模式且有配置时），子任务结束即关闭
    let mcpClients: McpClient[] = [];
    if (!offline) {
      const cfg = loadConfig();
      mcpClients = await attachMcpTools(tools, cfg.mcp.servers);
    }
    const logDir = getSessionHome(offline);
    const eventLog = new EventLog(runId, logDir);
    const session = new SessionStore(runId, cwd);
    const approve = process.stdin.isTTY ? interactiveApprover() : defaultApproverFor(security);
    const guard = rt
      ? rt.makeGuard({ runId, cwd, shellAllowlist: security.shellAllowlist, approve })
      : undefined;
    const orchestrator = new Orchestrator({
      router,
      tools,
      eventLog,
      session,
      cwd,
      security,
      approve,
      guard,
      maxIterations: opts.maxIterations ?? 15,
      maxCostUsd: rt?.maxCostUsd ?? 0,
      // P1-1：子任务用低成本模型分担（编排器主模型保持 code-gen，worker 加 cheap 优先）
      tags: ['code-gen', 'cheap'],
      persist: (cp: import('../../runtime/session-persist').SessionCheckpoint) =>
        saveCheckpoint(logDir, cp),
    });
    const result = await orchestrator.run(focusedGoal);
    await closeMcpClients(mcpClients);
    // P2-2：子代理结果摘要化回主上下文（隔离中间大输出）
    const summarized = summarizeSubTaskAnswer(result.finalAnswer);
    return {
      ok: result.ok,
      finalAnswer: summarized.text,
      iterations: result.iterations,
      touchedFiles: [],
    };
  };

  console.log(t('swe.start', { offline: offline ? t('run.modeOffline') : t('run.modeLive'), cwd }));
  const report: SweReport = await runSweAgent(goal, {
    cwd,
    runSubTask,
    maxTasks: opts.maxTasks ?? 8,
    maxRetries: opts.maxRetries ?? 2,
    verifyOnly: !!opts.verifyOnly,
    planOnly: !!opts.planOnly,
  });

  console.log('\n' + t('swe.reportTitle'));
  console.log(report.summary);

  if (rt) {
    rt.audit.record({
      tenantId: rt.tenant.tenantId,
      userId: rt.tenant.userId,
      role: rt.tenant.role,
      runId: 'swe',
      action: 'swe:run',
      resource: goal,
      decision: report.overall === 'failed' ? 'deny' : report.overall === 'partial' ? 'info' : 'allow',
      reason: `tasks=${report.executedTasks}/${report.plannedTasks} passed=${report.completedTasks} overall=${report.overall}`,
    });
  }
}

/* ===================== harness 评测命令 ===================== */


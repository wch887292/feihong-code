/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * harness 执行器（可插拔）：对单个评测实例运行 Agent 闭环。
 *  - HarnessExecutor 接口：mock / 真实模型 / 容器化执行均可实现该接口接入
 *  - MockOrchestratorExecutor：用 ScriptedMockProvider 跑「写方案→总结」闭环，
 *    无需模型/网络，验证 pipeline 可用（复刻自 scripts/eval-swebench.mjs runInstance）
 *  - RealModelExecutor：用 loadConfig() 构建的真实 ModelRouter（读取 .env 配置，
 *    密钥不经过命令行）驱动编排器，跑真实模型基准（对应 M2.2 真实模型执行）
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Orchestrator } from '../agent/orchestrator';
import { ModelRouter } from '../models/model-router';
import { ScriptedMockProvider, type MockStep } from '../models/providers/mock.provider';
import { createDefaultRegistry } from '../tools';
import { EventLog } from '../runtime/event-log';
import { SessionStore } from '../runtime/session-store';
import { loadDotEnv, loadConfig } from '../shared/config';
import type { HarnessExecutionResult, HarnessInstance } from './types';

/** 执行器契约：运行单个实例，产出原始执行结果（通过判定交给验证器） */
export interface HarnessExecutor {
  readonly id: string;
  execute(instance: HarnessInstance): Promise<HarnessExecutionResult>;
}

/** 方案文件名（验证器默认检查该文件是否生成） */
export const SOLUTION_FILE = 'SOLUTION.md';

/** 共享编排循环：临时工作区 + 事件日志 + 会话 + 工具注册表，注入指定 router 跑一轮 */
async function runOrchestratorLoop(
  instance: HarnessInstance,
  router: ModelRouter,
  maxIterations: number,
): Promise<HarnessExecutionResult> {
  const runId = randomUUID();
  const logDir = mkdtempSync(join(tmpdir(), 'fhcode-harness-'));
  const cwd = mkdtempSync(join(tmpdir(), 'fhcode-harness-ws-'));
  const stats = { toolCalls: 0 };
  const cleanup = (): void => {
    rmSync(logDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  };
  try {
    const tools = createDefaultRegistry();
    const eventLog = new EventLog(runId, logDir);
    const session = new SessionStore(runId, cwd);
    const orch = new Orchestrator({
      router,
      tools,
      eventLog,
      session,
      cwd,
      security: { shellAllowlist: [], requireApproval: false },
      maxIterations,
      maxCostUsd: 0,
      onEvent: (ev) => {
        if (ev.type === 'tool.result') stats.toolCalls++;
      },
    });
    const result = await orch.run(instance.problem_statement || instance.instance_id);
    return {
      instance_id: instance.instance_id,
      repo: instance.repo,
      problem: (instance.problem_statement || '').split('\n')[0].slice(0, 80),
      failToPass: instance.FAIL_TO_PASS.length,
      passToPass: instance.PASS_TO_PASS.length,
      runOk: result.ok,
      iterations: result.iterations,
      toolCalls: stats.toolCalls,
      cwd,
      cleanup,
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Mock 闭环执行器：无需真实模型/网络，验证 pipeline 可用并记录指标 */
export class MockOrchestratorExecutor implements HarnessExecutor {
  readonly id = 'mock-orchestrator';

  constructor(private readonly opts: { maxIterations?: number } = {}) {}

  async execute(instance: HarnessInstance): Promise<HarnessExecutionResult> {
    // 问题陈述作为任务目标；mock 步骤：写方案 → 总结
    const steps: MockStep[] = [
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 't1',
              name: 'write_file',
              arguments: {
                path: SOLUTION_FILE,
                content: `# Solution for ${instance.instance_id}\n\n${(instance.problem_statement || '').slice(0, 500)}`,
              },
            },
          ],
        },
      },
      { message: { role: 'assistant', content: `已完成 ${instance.instance_id} 方案`, toolCalls: [] } },
    ];
    const router = new ModelRouter([new ScriptedMockProvider(steps)], 'capability', 0);
    return runOrchestratorLoop(instance, router, this.opts.maxIterations ?? 4);
  }
}

/** 真实模型执行器：读取 .env 配置（loadDotEnv/loadConfig），真实模型驱动编排器跑基准 */
export class RealModelExecutor implements HarnessExecutor {
  readonly id = 'real-model';

  constructor(private readonly opts: { maxIterations?: number; budgetUsd?: number } = {}) {}

  async execute(instance: HarnessInstance): Promise<HarnessExecutionResult> {
    loadDotEnv();
    const cfg = loadConfig();
    if (cfg.models.providers.length === 0) {
      throw new Error('未配置任何模型 provider（请设置 FH_PROVIDERS 或 FH_MODEL_NAME）');
    }
    const router = ModelRouter.fromConfig(cfg);
    await router.loadStats(cfg.app.homeDir);
    return runOrchestratorLoop(instance, router, this.opts.maxIterations ?? 10);
  }
}

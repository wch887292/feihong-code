/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * AI 员工军团桥接层（agent-team · feihongzhi_agents 整合）
 *
 * 把 Python 实现的「AI 员工军团」CLI（main.py：submit/list-agents/stats/run-once…）
 * 封装为飞虹原生工具，并接入飞虹模型路由：
 *   - 从 loadConfig().models.providers 取第一个 openai-compatible（带 apiKey）provider
 *   - 映射为 DOUBAO_API_KEY / DOUBAO_MODEL / DOUBAO_BASE_URL + LLM_PROVIDER=doubao
 *     （agent-team 的 LLM 适配器兼容 OpenAI 接口，火山方舟/OpenAI 兼容端点均可）
 *   - 无可用 provider 时回退 LLM_PROVIDER=mock（本地确定性，跑通全链路）
 *
 * 安全：apiKey 只作为子进程环境变量传递，不回显、不落盘、不进审计摘要。
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { loadConfig } from '../../shared/config';
import { logger } from '../../shared/logger';

/** agent-team 目录：FEIHONG_AGENT_TEAM_DIR 覆盖，缺省 <仓库根>/agent-team */
function resolveAgentTeamDir(): string {
  const env = process.env.FEIHONG_AGENT_TEAM_DIR;
  if (env?.trim()) return resolve(env);
  return resolve(process.cwd(), 'agent-team');
}

/** Python 解释器：FEIHONG_PYTHON 覆盖，缺省 python */
function resolvePython(): string {
  return process.env.FEIHONG_PYTHON || 'python';
}

/** 从飞虹模型路由取 LLM 环境变量（只取 key 名，不取 key 值回显） */
export function resolveLlmEnv(): Record<string, string> {
  try {
    const cfg = loadConfig();
    const provider = cfg.models.providers.find(
      (p) => p.type === 'openai-compatible' && p.apiKey && p.baseURL,
    );
    if (provider) {
      return {
        LLM_PROVIDER: 'doubao',
        DOUBAO_API_KEY: provider.apiKey ?? '',
        DOUBAO_MODEL: provider.model ?? 'doubao-seed-1-6-250615',
        DOUBAO_BASE_URL: provider.baseURL,
      };
    }
  } catch (e) {
    logger.warn('读取模型路由失败，回退 mock LLM', { error: e instanceof Error ? e.message : String(e) });
  }
  return { LLM_PROVIDER: 'mock' };
}

/** 执行 agent-team CLI（同步，输出 JSON 文本）；首次调用先静默 init-db（幂等） */
function runCli(
  args: string[],
  _ctx: ToolContext,
  envExtra: Record<string, string> = {},
): { ok: boolean; output: string; error?: string } {
  const teamDir = resolveAgentTeamDir();
  if (!existsSync(join(teamDir, 'main.py'))) {
    return { ok: false, output: '', error: `agent-team 未就位（缺 ${teamDir}/main.py）` };
  }
  const env = { ...resolveLlmEnv(), ...envExtra };
  const py = resolvePython();
  // init-db 幂等（CREATE TABLE IF NOT EXISTS），保证 stats/submit 可查 DB
  spawnSync(py, ['main.py', 'init-db'], { cwd: teamDir, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
  const r = spawnSync(py, ['main.py', ...args], {
    cwd: teamDir,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 180000,
  });
  if (r.error) {
    return { ok: false, output: '', error: `agent-team 启动失败: ${r.error.message}` };
  }
  if (r.status !== 0) {
    return { ok: false, output: '', error: (r.stderr || r.stdout || '').slice(0, 500) };
  }
  return { ok: true, output: r.stdout || '' };
}

/* ================= feihong_agents_list（只读） ================= */

const listSchema = z.object({
  /** 可选子命令：agents=员工清单（默认）/ stats=任务统计 */
  scope: z.enum(['agents', 'stats']).optional(),
});

export const feihongAgentsListTool: Tool = {
  name: 'feihong_agents_list',
  description: '查询 AI 员工军团：员工清单（17 个 AI 员工，按 L1-L5 分层）或任务统计。只读，不改状态。',
  jsonSchema: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['agents', 'stats'], description: 'agents=员工清单（默认）| stats=任务统计' },
    },
  },
  schema: listSchema,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { scope = 'agents' } = listSchema.parse(args);
    const r = runCli([scope === 'stats' ? 'stats' : 'list-agents'], ctx);
    return r.ok ? { ok: true, output: r.output } : { ok: false, output: '', error: r.error };
  },
};

/* ================= feihong_agents_submit（写 · 需审批） ================= */

const submitSchema = z.object({
  /** 员工编号（1-17，对应 17 个 AI 员工；查清单用 feihong_agents_list） */
  agentId: z.union([z.number(), z.string()]),
  /** 任务入参（JSON 字符串，字段见对应技能 SKILL.md） */
  input: z.string().min(1),
  /** 是否立即执行一轮（默认 true；false 只入队待审批后执行） */
  executeNow: z.boolean().optional(),
});

export const feihongAgentsSubmitTool: Tool = {
  name: 'feihong_agents_submit',
  description:
    '向 AI 员工军团提交任务（需审批）：指定员工编号（1-17）与 JSON 入参。提交后自动执行一轮（LLM 用飞虹模型路由，未配置时 mock）。',
  jsonSchema: {
    type: 'object',
    properties: {
      agentId: { type: ['number', 'string'], description: '员工编号 1-17' },
      input: { type: 'string', description: '任务入参 JSON 字符串（字段见对应技能 SKILL.md）' },
      executeNow: { type: 'boolean', description: '是否立即执行（默认 true）' },
    },
    required: ['agentId', 'input'],
  },
  schema: submitSchema,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { agentId, input, executeNow = true } = submitSchema.parse(args);
    // module_id 为两位编号（01-17）：兼容 1/"1"/"01" 输入
    const moduleId = String(agentId).padStart(2, '0');
    const submit = runCli(['submit', '--module', moduleId, '--input', input], ctx);
    if (!submit.ok) return { ok: false, output: '', error: submit.error };
    const out: string[] = [submit.output];
    if (executeNow) {
      const once = runCli(['run-once'], ctx);
      if (once.ok) {
        out.push('--- 执行结果 ---', once.output);
      } else {
        out.push('--- 执行失败 ---', once.error ?? '');
      }
    }
    return { ok: true, output: out.join('\n') };
  },
};

export const agentsTools: Tool[] = [feihongAgentsListTool, feihongAgentsSubmitTool];

/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：执行 shell 命令（白名单 + 审批）
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { runCommand, commandHead } from './exec';

export const runShellTool: Tool = {
  name: 'run_shell',
  description: '执行 shell 命令（受白名单约束，需审批时会被拦截）',
  jsonSchema: {
    type: 'object',
    properties: { command: { type: 'string', description: '要执行的完整命令' } },
    required: ['command'],
  },
  schema: z.object({ command: z.string().min(1) }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { command } = args as { command: string };
    const head = commandHead(command);
    if (ctx.security.shellAllowlist.length > 0 && !ctx.security.shellAllowlist.includes(head)) {
      return { ok: false, output: '', error: `命令不在白名单: ${head}` };
    }
    if (ctx.security.requireApproval) {
      const approved = ctx.approve ? await ctx.approve(`run_shell: ${command}`) : false;
      if (!approved) return { ok: false, output: '', error: '已拒绝执行（需审批）' };
    }
    const res = await runCommand(command, ctx.cwd);
    return {
      ok: res.code === 0,
      output: `${res.stdout}${res.stderr}`.slice(0, 4000),
      error: res.code === 0 ? undefined : `exit code ${res.code}`,
    };
  },
};

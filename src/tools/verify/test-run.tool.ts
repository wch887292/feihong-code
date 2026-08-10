/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：运行测试套件
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { runCommand } from '../shell/exec';

export const runTestsTool: Tool = {
  name: 'run_tests',
  description: '运行项目测试套件（默认 npm test）',
  jsonSchema: {
    type: 'object',
    properties: { command: { type: 'string', description: '测试命令，默认 npm test' } },
  },
  schema: z.object({ command: z.string().min(1).optional() }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const cmd = (args.command as string) ?? 'npm test';
    const res = await runCommand(cmd, ctx.cwd);
    return {
      ok: res.code === 0,
      output: `${res.stdout}${res.stderr}`.slice(0, 4000),
      error: res.code === 0 ? undefined : `exit code ${res.code}`,
    };
  },
};

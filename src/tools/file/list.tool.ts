/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：列出目录内容
 */
import { z } from 'zod';
import { readdir } from 'fs/promises';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { safeJoin } from '../safe-path';

export const listDirTool: Tool = {
  name: 'list_dir',
  description: '列出工作区内目录内容（d=目录，-=文件）',
  jsonSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: '目录相对路径，默认工作区根' } },
  },
  schema: z.object({ path: z.string().min(1).optional() }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const rel = (args.path as string) ?? '.';
    const abs = safeJoin(ctx.cwd, rel);
    try {
      const entries = await readdir(abs, { withFileTypes: true });
      const lines = entries
        .filter((e) => e.name !== '.workbuddy' && e.name !== 'node_modules')
        .map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`);
      return { ok: true, output: lines.join('\n') };
    } catch (e) {
      return { ok: false, output: '', error: `列目录失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

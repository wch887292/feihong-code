/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：读取文件
 */
import { z } from 'zod';
import { readFile } from 'fs/promises';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { safeJoin } from '../safe-path';

export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取工作区内指定文件的文本内容',
  jsonSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: '文件相对工作区的路径' } },
    required: ['path'],
  },
  schema: z.object({ path: z.string().min(1) }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { path } = args as { path: string };
    const abs = safeJoin(ctx.cwd, path);
    try {
      const content = await readFile(abs, 'utf8');
      return { ok: true, output: content };
    } catch (e) {
      return { ok: false, output: '', error: `读取失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：写入/覆盖文件
 */
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { safeJoin } from '../safe-path';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '在工作区内写入/覆盖文件（自动创建父目录）',
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件相对路径' },
      content: { type: 'string', description: '要写入的完整内容' },
    },
    required: ['path', 'content'],
  },
  schema: z.object({ path: z.string().min(1), content: z.string() }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { path, content } = args as { path: string; content: string };
    const abs = safeJoin(ctx.cwd, path);
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      return { ok: true, output: `已写入 ${path}（${content.length} 字节）。

✅ 文件写入完成。如果你认为这已是本次任务的最终产物，请直接用文字回复一段简短的任务总结（不带任何 toolCalls），结束任务；不要再次调用 write_file 重写同一个文件、不要再次调用 read_file 回读——这只会浪费 token 并可能陷入原地打转循环。` };
    } catch (e) {
      return { ok: false, output: '', error: `写入失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

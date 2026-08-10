/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：精确替换文件中的文本片段
 */
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { safeJoin } from '../safe-path';

export const editFileTool: Tool = {
  name: 'edit_file',
  description: '在文件中将 oldText 首次精确替换为 newText',
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件相对路径' },
      oldText: { type: 'string', description: '待替换的原文本' },
      newText: { type: 'string', description: '替换后的新文本' },
    },
    required: ['path', 'oldText', 'newText'],
  },
  schema: z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { path, oldText, newText } = args as { path: string; oldText: string; newText: string };
    const abs = safeJoin(ctx.cwd, path);
    try {
      const content = await readFile(abs, 'utf8');
      const idx = content.indexOf(oldText);
      if (idx < 0) return { ok: false, output: '', error: '未找到 oldText' };
      const updated = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
      await writeFile(abs, updated, 'utf8');
      return { ok: true, output: `已更新 ${path}` };
    } catch (e) {
      return { ok: false, output: '', error: `编辑失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

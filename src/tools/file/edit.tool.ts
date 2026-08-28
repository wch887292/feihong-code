/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
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
      if (idx < 0) {
        // 把问题完整交回大模型：附上文件当前真实内容摘要，让模型基于实际内容重新提供 oldText，
        // 避免模型在不知晓文件现状时反复盲猜 oldText 而陷入死循环。
        const lines = content.split('\n');
        const head = lines.slice(0, 40).join('\n');
        const tail = lines.slice(-15).join('\n');
        const ellipsis = lines.length > 55 ? '\n...(中间省略)...\n' : '\n';
        const summary = `未找到 oldText。你提供的 oldText 与文件当前内容不匹配（可能被其他步骤改写、或包含空白/缩进差异）。
文件 "${path}" 当前真实内容（共 ${lines.length} 行 / ${content.length} 字符）：

--- 文件开头 ---
${head}${ellipsis}--- 文件结尾 ---
${tail}

请基于以上真实内容重新提供 oldText（必须与文件中的字符完全一致，注意空白与缩进）；若你只是想新增代码，请先 read_file 读取目标位置附近内容，或用 write_file 直接整体重写。`;
        return { ok: false, output: '', error: summary };
      }
      const updated = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
      await writeFile(abs, updated, 'utf8');
      return { ok: true, output: `已更新 ${path}` };
    } catch (e) {
      return { ok: false, output: '', error: `编辑失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

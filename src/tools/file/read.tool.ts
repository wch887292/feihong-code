/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：读取文件
 *
 * 2026-11-10 修复（fhcode「read_file 大文件截断诱发死锁」3-2）：
 *  - 新增 offset（起始行，1 基）/ limit（最多行数）区间读取，大文件可原生分段读取，
 *    不必再像历史事故那样手写 seg.js 把文件拆段分读（那套歪招最终诱发循环拦截死锁）。
 *  - 大文件默认【返回完整内容、绝不中间截断】（截断由编排器 capToolOutput 统一负责，
 *    且 read_file 已被编排器豁免中间截断）；仅在文件较大且未指定区间时，顶部附加
 *    一行非破坏性提示，告知行数/字符数与 offset/limit 用法，避免模型误以为内容缺失。
 */
import { z } from 'zod';
import { readFile } from 'fs/promises';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { safeJoin } from '../safe-path';

/** 超过此行数且未使用区间读取时，顶部附加非破坏性提示（不截断内容） */
const HUGE_LINES = 1500;

export const readFileTool: Tool = {
  name: 'read_file',
  description:
    '读取工作区内指定文件的文本内容。支持 offset（起始行，1 基，默认 1）与 limit（最多读取行数）做区间读取，便于处理大文件且不丢失中间内容。' +
    '大文件默认返回【完整内容，不截断】；仅在文件较大且未指定区间时顶部附加一行行数提示，提示可用 offset/limit 分段读取以节省上下文。',
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件相对工作区的路径' },
      offset: { type: 'number', description: '起始行（1 基，包含），默认 1。用于分段读取大文件，例如读第 1000 行起传 1000。' },
      limit: { type: 'number', description: '最多读取的行数；省略则读到文件末尾。' },
    },
    required: ['path'],
  },
  schema: z.object({
    path: z.string().min(1),
    offset: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { path, offset, limit } = args as { path: string; offset?: number; limit?: number };
    const abs = safeJoin(ctx.cwd, path);
    try {
      const content = await readFile(abs, 'utf8');
      const allLines = content.split('\n');
      const totalLines = allLines.length;
      const start = offset && offset > 0 ? offset : 1;
      const end = limit && limit > 0 ? Math.min(start + limit - 1, totalLines) : totalLines;
      const sliceLines = allLines.slice(start - 1, end);
      let output = sliceLines.join('\n');
      if (offset || limit) {
        // 区间读取：明确标注本次读取范围，便于模型拼接多段
        output = `[read_file 区间] 读取第 ${start}–${end} 行（文件共 ${totalLines} 行）。\n` + output;
      } else if (totalLines > HUGE_LINES) {
        // 大文件整读：绝不截断，仅顶部附加非破坏性提示
        output =
          `[read_file 提示] 文件共 ${totalLines} 行 / ${content.length} 字符，已返回【完整内容，未截断】。` +
          `如需节省上下文可改用 offset/limit 分段读取（例如 offset=1000&limit=400）。\n` +
          output;
      }
      return { ok: true, output };
    } catch (e) {
      return { ok: false, output: '', error: `读取失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

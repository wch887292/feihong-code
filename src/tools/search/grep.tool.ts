/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：递归文本搜索
 */
import { z } from 'zod';
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { safeJoin } from '../safe-path';

const MAX_DEPTH = 8;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.workbuddy']);

async function walk(
  dir: string,
  depth: number,
  pattern: RegExp,
  base: string,
  hits: string[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(abs, depth + 1, pattern, base, hits);
    } else if (e.isFile()) {
      try {
        const content = await readFile(abs, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            hits.push(`${relative(base, abs)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          }
        }
      } catch {
        // 二进制/无法读取的文件忽略
      }
    }
  }
}

export const grepTool: Tool = {
  name: 'grep',
  description: '在工作区内递归搜索匹配文本（忽略 node_modules/.git 等），返回 file:line:content',
  jsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '正则模式' },
      path: { type: 'string', description: '搜索起始目录，默认工作区根' },
    },
    required: ['pattern'],
  },
  schema: z.object({ pattern: z.string().min(1), path: z.string().min(1).optional() }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { pattern, path } = args as { pattern: string; path?: string };
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'i');
      } catch {
        return { ok: false, output: '', error: `无效的正则表达式: "${pattern}"` };
      }
      const base = safeJoin(ctx.cwd, path ?? '.');
      const hits: string[] = [];
      await walk(base, 0, regex, base, hits);
      return { ok: true, output: hits.length ? hits.slice(0, 50).join('\n') : '无匹配' };
    } catch (err) {
      return { ok: false, output: '', error: `grep 搜索失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

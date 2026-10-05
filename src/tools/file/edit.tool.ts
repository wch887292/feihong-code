/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：精确替换文件中的文本片段
 *
 * P1 修复（2026-10-05）：oldText 匹配三级兜底，根治「oldText 不匹配 → 反复盲试 → 自愈爆表」死循环：
 *   1) 精确匹配（原行为，命中首个出现位置）；
 *   2) 换行符容忍：CRLF/LF 风格不一致时自动对齐后重试（Windows 文件常见翻车点）；
 *   3) 逐行空白容忍窗口匹配：忽略每行首尾空白后做唯一窗口匹配（缩进差异常见翻车点），
 *      命中不唯一（多处出现）时拒绝替换并报错，绝不误伤。
 */
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { safeJoin } from '../safe-path';

/** 将原始文本按行切分，并记录每行在原文中的 [start, end) 偏移（\r\n 与 \n 均视为分隔符） */
function buildLineIndex(raw: string): { lines: string[]; starts: number[]; ends: number[] } {
  const lines: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let lineStart = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\n') {
      const lineEnd = i > 0 && raw[i - 1] === '\r' ? i - 1 : i;
      lines.push(raw.slice(lineStart, lineEnd));
      starts.push(lineStart);
      ends.push(lineEnd);
      lineStart = i + 1;
    }
  }
  // 最后一行（文件以换行结尾时为空字符串行）
  lines.push(raw.slice(lineStart));
  starts.push(lineStart);
  ends.push(raw.length);
  return { lines, starts, ends };
}

/** oldText 匹配失败时生成可行动的错误摘要（附文件真实内容，交回模型重新决策） */
function notFoundSummary(path: string, raw: string): string {
  const lines = raw.split(/\r?\n/);
  const head = lines.slice(0, 40).join('\n');
  const tail = lines.slice(-15).join('\n');
  const ellipsis = lines.length > 55 ? '\n...(中间省略)...\n' : '\n';
  return `未找到 oldText。你提供的 oldText 与文件当前内容不匹配（可能被其他步骤改写、或包含空白/缩进差异）。
文件 "${path}" 当前真实内容（共 ${lines.length} 行 / ${raw.length} 字符）：

--- 文件开头 ---
${head}${ellipsis}--- 文件结尾 ---
${tail}

请基于以上真实内容重新提供 oldText（必须与文件中的字符完全一致，注意空白与缩进）；若你只是想新增代码，请先 read_file 读取目标位置附近内容，或用 write_file 直接整体重写。
（本次已自动尝试换行符对齐与逐行空白容忍匹配，均未命中——说明文件中确实不存在这段内容，请勿用相同 oldText 重试。）`;
}

export const editFileTool: Tool = {
  name: 'edit_file',
  description: '在文件中将 oldText 首次精确替换为 newText（支持换行符与缩进的容忍匹配兜底）',
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
      const raw = await readFile(abs, 'utf8');

      // ---- 第 1/2 级：精确匹配 + 换行符对齐匹配 ----
      const candidates = new Set<string>([oldText]);
      if (raw.includes('\r\n')) {
        candidates.add(oldText.replace(/\r?\n/g, '\r\n'));
      } else if (oldText.includes('\r\n')) {
        candidates.add(oldText.replace(/\r?\n/g, '\n'));
      }
      for (const cand of candidates) {
        const idx = raw.indexOf(cand);
        if (idx >= 0) {
          // 匹配串被换行对齐过时，newText 也按同样风格对齐，避免混入不一致的换行符
          const alignedNew = cand === oldText ? newText : newText.replace(/\r?\n/g, cand.includes('\r\n') ? '\r\n' : '\n');
          const updated = raw.slice(0, idx) + alignedNew + raw.slice(idx + cand.length);
          await writeFile(abs, updated, 'utf8');
          const note = cand === oldText ? '' : '（换行符已自动对齐）';
          return { ok: true, output: `已更新 ${path}${note}` };
        }
      }

      // ---- 第 3 级：逐行空白容忍窗口匹配（仅唯一命中才替换） ----
      const { lines, starts, ends } = buildLineIndex(raw);
      const oldLines = oldText.split(/\r?\n/).map((l) => l.trim());
      if (oldLines.length > 0 && oldLines.length <= lines.length) {
        let hit = -1;
        let ambiguous = false;
        for (let i = 0; i + oldLines.length <= lines.length; i++) {
          let matched = true;
          for (let j = 0; j < oldLines.length; j++) {
            if (lines[i + j].trim() !== oldLines[j]) {
              matched = false;
              break;
            }
          }
          if (matched) {
            if (hit >= 0) {
              ambiguous = true;
              break;
            }
            hit = i;
          }
        }
        if (ambiguous) {
          return {
            ok: false,
            output: '',
            error: `oldText 经空白容忍匹配后在 "${path}" 中命中多处（第 ${hit + 1} 行起等多处），为避免误伤拒绝替换。请在 oldText 中补充更多上下文行使其唯一，或改用 write_file 整体重写。`,
          };
        }
        if (hit >= 0) {
          const k = oldLines.length;
          const lastWin = hit + k - 1;
          const eol = raw.includes('\r\n') ? '\r\n' : '\n';
          // 窗口最后一行是否带行终止符（仅当窗口触及文件末行且文件无结尾换行时为 false）
          const hadTerminator = lastWin + 1 < lines.length ? true : ends[lastWin] < raw.length;
          const before = raw.slice(0, starts[hit]);
          const after = hit + k < lines.length ? raw.slice(starts[hit + k]) : '';
          const ins = newText.replace(/\r?\n/g, eol).replace(/\r?\n$/, '');
          const updated = before + ins + (hadTerminator ? eol : '') + after;
          await writeFile(abs, updated, 'utf8');
          return { ok: true, output: `已更新 ${path}（空白容忍匹配：第 ${hit + 1}-${lastWin + 1} 行，请核对缩进是否符合预期）` };
        }
      }

      // ---- 全部兜底失败：附文件真实内容交回模型 ----
      return { ok: false, output: '', error: notFoundSummary(path, raw) };
    } catch (e) {
      return { ok: false, output: '', error: `编辑失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

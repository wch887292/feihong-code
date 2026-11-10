/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：写入/追加文件
 *
 * 2026-11-09 修复（大会话截断退化）：
 *  - 支持 append 模式，允许模型把大文件拆成多段写入，避免单次输出超 max_tokens；
 *  - 识别 __truncated__ 标记，拒绝把半截 tool call 参数落盘；
 *  - 首次写入 HTML / JSON 类完整文档时做闭合性校验，缺闭合标签直接拒绝并提示续写。
 */
import { z } from 'zod';
import { writeFile, appendFile, mkdir, readFile } from 'fs/promises';
import { dirname } from 'path';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { safeJoin } from '../safe-path';

/** 纯函数：判断「首次完整写入」的内容是否明显未写完（供收尾校验与单测复用）。
 *  返回 null 表示未发现问题；仅做保守启发式，避免误伤合法片段文件。 */
export function detectIncompleteDocument(path: string, content: string): string | null {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const head = content.trimStart().slice(0, 400).toLowerCase();
  if (ext === 'html' || ext === 'htm') {
    if ((head.startsWith('<!doctype html') || head.startsWith('<html')) && !/<\/html\s*>/i.test(content)) {
      return 'HTML 缺少 </html> 闭合标签';
    }
    const opens = (content.match(/<script\b/gi) ?? []).length;
    const closes = (content.match(/<\/script\s*>/gi) ?? []).length;
    // 只拦「开多于闭」：内联脚本字符串里出现转义的 </script> 不算异常
    if (opens > closes) return `<script> 标签未配对（开 ${opens} / 闭 ${closes}）`;
  }
  if (ext === 'json' && content.trim()) {
    try {
      JSON.parse(content);
    } catch (e) {
      return `JSON 语法不闭合: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return null;
}

/**
 * 纯函数：判断本次 append 的内容是否「像独立脚本 / 新文档整体」而非文档片段续写。
 * 仅用于「已完整成品文件」的 append 污染防护，保守判定避免误伤正常续写。
 * 返回 true 表示疑似污染，应拒绝 append。
 */
export function looksLikeStandaloneScript(path: string, content: string): boolean {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  // 脚本类文件（js/ts/py/sh 等）本身就该 append 代码，不视为污染
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'py', 'sh', 'bat', 'ps1'].includes(ext)) return false;
  const trimmed = content.trimStart();
  // 像一份新的 HTML 文档整体（重复 <!DOCTYPE>/<html> 开头）
  if (/^<!doctype html|^<html/i.test(trimmed)) return true;
  // 明确的 node 脚本 shebang
  if (/^#!\/usr\/bin\/env\s+node/i.test(trimmed)) return true;
  // node 模块式脚本（既有 const/function 赋值定义，又含 require/process 调用）
  if (
    /(^|[\n;])\s*(const|let|var|async\s+function|function)\s+[\w$]*\s*[=\(]/m.test(content) &&
    /(require\s*\(|process\.\w+)/.test(content)
  ) {
    return true;
  }
  return false;
}

export const writeFileTool: Tool = {
  name: 'write_file',
  description: '在工作区内写入文件（自动创建父目录）。大文件必须用 append:true 分段写入，避免单次输出被截断。',
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件相对路径' },
      content: { type: 'string', description: '本段要写入的内容' },
      append: { type: 'boolean', description: 'true=追加到文件末尾（分段写大文件）；缺省/false=覆盖写入' },
    },
    required: ['path', 'content'],
  },
  schema: z.object({ path: z.string().min(1), content: z.string(), append: z.boolean().optional() }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { path, content } = args as { path: string; content: string };
    const append = (args as { append?: unknown }).append === true;
    const truncatedCall = (args as { __truncated__?: unknown }).__truncated__ === true;
    if (truncatedCall) {
      return {
        ok: false,
        output: '',
        error: '【输出被截断，已拒绝落盘】你这次 write_file 的参数在模型输出上限处被切断，content 是半截内容，写入只会制造残缺文件。\n'
          + '请改用分段写入：第 1 段 append:false 写开头（不超过 200 行），后续每段 append:true 续写，最后一段补齐闭合标签。\n'
          + '每次只发一个 write_file 调用，不要一次性输出整个大文件。',
      };
    }
    if (!append) {
      const incomplete = detectIncompleteDocument(path, content);
      if (incomplete) {
        return {
          ok: false,
          output: '',
          error: `【疑似截断，已拒绝落盘】${incomplete}。若文件确实很长，请改用 append:true 分段写入；若你已写完，请补齐闭合标签后重试。`,
        };
      }
    }
    const abs = safeJoin(ctx.cwd, path);
    try {
      await mkdir(dirname(abs), { recursive: true });
      if (append) {
        // 2026-11-10 修复（选项3·write_file append 易污染）：
        // 已完整的 HTML/JSON 成品再被 append「独立脚本 / 新文档整体」形态内容时，拒绝并回滚，
        // 避免弱模型误把调试脚本追加进成品（实测曾往 index.html 末尾 append node 脚本污染）。
        let existing = '';
        try {
          existing = await readFile(abs, 'utf8');
        } catch {
          existing = '';
        }
        if (
          existing.trim().length > 0 &&
          detectIncompleteDocument(path, existing) === null &&
          looksLikeStandaloneScript(path, content)
        ) {
          return {
            ok: false,
            output: '',
            error: `【append 污染防护】${path} 已是完整文档，而本次 append 的内容疑似独立脚本/非续写片段，追加会破坏成品。\n`
              + `请改用独立文件名（如 ${path.replace(/\.\w+$/, '')}-patch.js）写入该脚本，或用 overwrite 模式（append:false）覆盖目标文件。不要往已完成的文档末尾追加。`,
          };
        }
        await appendFile(abs, content, 'utf8');
      } else await writeFile(abs, content, 'utf8');
      const mode = append ? '追加' : '写入';
      const hint = append
        ? '若还有未写完的内容，请继续用 append:true 写下一段；全部写完后用 read_file 回读确认闭合标签齐全，再输出 FINAL: 总结。'
        : '若这是大文件的第 1 段，请继续用 append:true 分段写完；写完可用 read_file 回读确认闭合标签齐全。不要重复覆盖同一个文件。';
      return { ok: true, output: `已${mode} ${path}（本段 ${content.length} 字节）。\n\n${hint}` };
    } catch (e) {
      return { ok: false, output: '', error: `写入失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

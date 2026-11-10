/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 文本格式 tool call 兜底解析
 *
 * 背景：部分模型/网关不返回标准 OpenAI tool_calls 结构字段，而是把工具调用
 * 以文本形式混在 content 里。已观测到两类：
 *  1. dots 系（dots3 等网关）：
 *     <dots_function_call>
 *       <invoke name="write_file">
 *         <parameter name="path">H:/x.md</parameter>
 *         <parameter name="content">...</parameter>
 *       </invoke>
 *     </dots_function_call>
 *  2. Qwen/Hermes 系（模型无原生 FC 时的常见输出）：
 *     <tool_call>{"name":"write_file","arguments":{"path":"..."}}</tool_call>
 *
 * 不兜底时这些块会被当成普通正文流给用户，工具永远不会执行（write_file
 * 等静默失效）。本模块统一提取为标准 ToolCall 并从正文清理掉这些块。
 */
import type { ToolCall } from './model.interface';

const DOTS_BLOCK = /<dots_function_call>([\s\S]*?)<\/dots_function_call>/g;
const INVOKE_BLOCK = /<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/g;
const PARAM_BLOCK = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/g;
const QWEN_BLOCK = /<tool_call>([\s\S]*?)<\/tool_call>/g;

let seq = 0;
const nextId = (): string => `textcall-${Date.now().toString(36)}-${++seq}`;

export interface TextToolCallResult {
  toolCalls: ToolCall[];
  /** 移除已识别块之后的正文 */
  cleanedContent: string;
  /** true = 命中了流式截断的未闭合块（参数内容可能不完整，调用方应知悉） */
  truncated?: boolean;
}

/** 从 content 中提取文本格式 tool call；无命中返回 null（正文不做任何改动） */
export function extractTextToolCalls(content: string): TextToolCallResult | null {
  if (!content || content.indexOf('<') === -1) return null;
  const toolCalls: ToolCall[] = [];
  let cleaned = content;
  let truncated = false;

  // 1) dots 格式（闭合）
  for (const blockMatch of content.matchAll(DOTS_BLOCK)) {
    const block = blockMatch[0];
    for (const invokeMatch of block.matchAll(INVOKE_BLOCK)) {
      const name = invokeMatch[1].trim();
      const inner = invokeMatch[2];
      if (!name) continue;
      const args: Record<string, unknown> = {};
      for (const p of inner.matchAll(PARAM_BLOCK)) {
        // dots 格式参数值通常自带首尾换行，trim 归一
        args[p[1].trim()] = p[2].trim();
      }
      toolCalls.push({ id: nextId(), name, arguments: args });
    }
    // 从正文移除整个 <dots_function_call>…</dots_function_call> 块
    cleaned = cleaned.split(block).join('');
  }

  // 1b) dots 格式「未闭合块」：说明模型输出被 max_tokens 截断。
  // 2026-11-09 修复：旧逻辑把文末半截参数当合法 content 落盘，制造出停在半行的
  // 残缺文件（22KB HTML 停在 `for (var p =`）。现在只打 __truncated__ 标记，
  // 由 write_file / edit_file 拒绝落盘并引导模型改用 append 分段写。
  const unclosedAt = cleaned.indexOf('<dots_function_call>');
  if (unclosedAt >= 0) {
    const tail = cleaned.slice(unclosedAt);
    const invokeOpen = tail.match(/<invoke\s+name=["']([^"']+)["']\s*>/);
    if (invokeOpen) {
      const innerStart = (tail.indexOf(invokeOpen[0]) ?? 0) + invokeOpen[0].length;
      const inner = tail.slice(innerStart);
      const args: Record<string, unknown> = {};
      // 参数值到 </parameter> 或文末（截断场景无闭合标签）
      for (const p of inner.matchAll(/<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/parameter>|$)/g)) {
        args[p[1].trim()] = p[2].trim();
      }
      if (Object.keys(args).length > 0) {
        // 半截参数禁止伪装成完整写入：工具层见到该标记会拒绝落盘
        args.__truncated__ = true;
        toolCalls.push({ id: nextId(), name: invokeOpen[1].trim(), arguments: args });
      }
      truncated = true;
      cleaned = cleaned.slice(0, unclosedAt);
    }
  }

  // 2) Qwen/Hermes JSON 格式
  for (const m of content.matchAll(QWEN_BLOCK)) {
    const raw = m[1].trim();
    let obj: { name?: unknown; arguments?: unknown };
    try {
      obj = JSON.parse(raw) as { name?: unknown; arguments?: unknown };
    } catch {
      // 非法 JSON：可能只是正文里恰好出现该标签，保持原样不动
      continue;
    }
    if (typeof obj.name !== 'string' || !obj.name) continue;
    let args: Record<string, unknown> = {};
    if (obj.arguments && typeof obj.arguments === 'object') {
      args = obj.arguments as Record<string, unknown>;
    } else if (typeof obj.arguments === 'string') {
      try {
        args = JSON.parse(obj.arguments) as Record<string, unknown>;
      } catch {
        args = { __parse_error__: obj.arguments };
      }
    }
    toolCalls.push({ id: nextId(), name: obj.name, arguments: args });
    cleaned = cleaned.split(m[0]).join('');
  }

  if (toolCalls.length === 0 && !truncated) return null;
  return { toolCalls, cleanedContent: cleaned.trim(), truncated };
}

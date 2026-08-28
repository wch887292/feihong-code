/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 模型响应 zod 校验 + 工具参数归一化（供应商返回结构不可信，必须校验）
 */
import { z } from 'zod';

export const openAIMessageSchema = z.object({
  role: z.string(),
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal('function'),
        function: z.object({
          name: z.string(),
          arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
        }),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
});

export const openAIChatResponseSchema = z.object({
  model: z.string(),
  choices: z
    .array(z.object({ message: openAIMessageSchema, finish_reason: z.string().optional() }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

export const ollamaChatResponseSchema = z.object({
  model: z.string(),
  message: openAIMessageSchema,
  done: z.boolean().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

/** 将模型返回的工具参数（可能是 JSON 字符串或对象）归一为对象。
 *  对畸形字符串尝试提取 JSON（处理 markdown 代码块、前后多余文本等），
 *  仍失败时返回 { __parse_error__: raw } 让上游能感知并给模型反馈，而非静默 {}。 */
export function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // 1. 直接解析
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // 2. 尝试从 markdown 代码块中提取
      const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (codeBlockMatch) {
        try {
          return JSON.parse(codeBlockMatch[1].trim()) as Record<string, unknown>;
        } catch { /* fall through */ }
      }
      // 3. 尝试提取第一个 { ... } 块
      const objMatch = trimmed.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          return JSON.parse(objMatch[0]) as Record<string, unknown>;
        } catch { /* fall through */ }
      }
      // 4. 全部失败：保留原始文本供上游警告，不静默丢弃
      console.warn('[parseToolArgs] 无法解析工具参数，保留原始文本', { raw: trimmed.slice(0, 200) });
      return { __parse_error__: trimmed };
    }
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

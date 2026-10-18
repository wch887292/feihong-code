/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Anthropic Messages 协议供应商（对标 DeepSeek Harness 协议支持面）：
 *  - Claude 官方（api.anthropic.com）与 Anthropic 兼容网关（如 DeepSeek /v1/messages）
 *  - 非流式 POST {baseURL}/v1/messages，x-api-key + anthropic-version
 *  - 消息映射：system 抽到顶层；assistant tool_use 与 user tool_result 成对往返
 */
import { ModelError } from '../../shared/errors';
import type { ProviderConfig } from '../../shared/config';
import type { CapabilityTag } from '../../shared/types';
import type { ChatMessage, ChatRequest, ChatResponse, ModelProvider, ToolDefinition } from '../model.interface';
import { anthropicMessagesResponseSchema, parseToolArgs } from '../model.dto';
import { estimateCost } from '../cost';

/** Anthropic content block（发送侧）：文本或 tool_result/tool_use 结构 */
interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

/** 把一条历史消息映射为 Anthropic messages[] 条目 */
function toAnthropicMessage(m: ChatMessage): Array<{ role: string; content: string | AnthropicContentBlock[] }> {
  // 工具结果 → user + tool_result block（成对关联 assistant 的 tool_use id）
  if (m.role === 'tool') {
    return [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content ?? '',
          },
        ],
      },
    ];
  }
  // assistant 携带 tool 调用 → 文本块 + tool_use 块
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    const blocks: AnthropicContentBlock[] = [];
    if (m.content) blocks.push({ type: 'text', text: m.content });
    for (const tc of m.toolCalls) {
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
    }
    return [{ role: 'assistant', content: blocks }];
  }
  // 防御分支：chat() 已把 system 抽到顶层并跳过 messages 里的 system，
  // 此分支仅在未来其它调用路径直接传入 system 时兜底（按 Anthropic 规则并入 user 角色）
  return [{ role: m.role === 'system' ? 'user' : m.role, content: m.content ?? '' }];
}

/** 归一 baseURL：容忍带/不带末尾 /v1 两种写法 */
function messagesEndpoint(baseURL: string): string {
  const root = baseURL.replace(/\/$/, '');
  return root.endsWith('/v1') ? `${root}/messages` : `${root}/v1/messages`;
}

export class AnthropicMessagesProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly tags: CapabilityTag[];
  readonly costPer1k: number;
  private readonly baseURL: string;
  private readonly apiKey?: string;

  constructor(cfg: ProviderConfig) {
    this.id = cfg.id;
    this.model = cfg.model ?? cfg.id;
    this.tags = cfg.tags;
    this.costPer1k = cfg.costPer1k ?? 0;
    this.baseURL = cfg.baseURL.replace(/\/$/, '');
    this.apiKey = cfg.apiKey;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // 1) system 消息抽到顶层（Anthropic 不支持 system 混在 messages 里）
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).filter(Boolean).join('\n');
    // 2) 其余消息映射（tool 结果内联为 user/tool_result）
    const messages: Array<{ role: string; content: string | AnthropicContentBlock[] }> = [];
    for (const m of req.messages) {
      if (m.role === 'system') continue;
      messages.push(...toAnthropicMessage(m));
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 8192,
      ...(system ? { system } : {}),
      messages,
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t: ToolDefinition) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    if (req.timeoutMs && req.timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), req.timeoutMs);
    }
    const onExternalAbort = (): void => controller.abort();
    if (req.signal) {
      if (req.signal.aborted) controller.abort();
      else req.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let res: Response;
    try {
      res = await fetch(messagesEndpoint(this.baseURL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = controller.signal.aborted;
      if (aborted) throw new ModelError('任务已被用户中断', this.id);
      throw new ModelError(`网络请求失败: ${e instanceof Error ? e.message : String(e)}`, this.id);
    } finally {
      if (timer) clearTimeout(timer);
      if (req.signal) req.signal.removeEventListener('abort', onExternalAbort);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ModelError(`HTTP ${res.status} ${text.slice(0, 200)}`, this.id, res.status);
    }

    const json: unknown = await res.json().catch(() => undefined);
    const parsed = anthropicMessagesResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ModelError(`响应结构校验失败: ${parsed.error.message}`, this.id);
    }

    // 3) 内容块归一：text 拼接 + tool_use → ToolCall
    let content = '';
    const toolCalls: NonNullable<ChatResponse['message']['toolCalls']> = [];
    for (const block of parsed.data.content) {
      if (block.type === 'text' && block.text) content += block.text;
      else if (block.type === 'tool_use' && block.name && block.id) {
        toolCalls.push({ id: block.id, name: block.name, arguments: parseToolArgs(block.input) });
      }
    }

    const usage = parsed.data.usage
      ? {
          promptTokens: parsed.data.usage.input_tokens,
          completionTokens: parsed.data.usage.output_tokens,
          totalTokens: parsed.data.usage.input_tokens + parsed.data.usage.output_tokens,
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    return {
      message: { role: 'assistant', content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined },
      usage,
      providerId: this.id,
      model: this.model,
      costUsd: estimateCost(usage, this.costPer1k),
    };
  }
}

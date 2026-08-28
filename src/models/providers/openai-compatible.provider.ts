/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * OpenAI 兼容供应商（DeepSeek / 通义 / OpenRouter 等 OpenAI 协议接口）
 */
import { ModelError } from '../../shared/errors';
import type { ProviderConfig } from '../../shared/config';
import type { CapabilityTag } from '../../shared/types';
import type { ChatRequest, ChatResponse, ModelProvider, ToolDefinition } from '../model.interface';
import { openAIChatResponseSchema, parseToolArgs } from '../model.dto';
import { estimateCost } from '../cost';

export class OpenAICompatibleProvider implements ModelProvider {
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
    const body = {
      model: this.model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls?.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.arguments) },
        })),
        tool_call_id: m.toolCallId,
      })),
      tools:
        req.tools && req.tools.length > 0
          ? req.tools.map((t: ToolDefinition) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            }))
          : undefined,
      temperature: req.temperature ?? 0,
      max_tokens: req.maxTokens ?? 4096,
    };

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    if (req.timeoutMs && req.timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), req.timeoutMs);
    }
    // 外部中断信号（任务停止）：链接到本地 controller，触发即中断 fetch
    const onExternalAbort = (): void => controller.abort();
    if (req.signal) {
      if (req.signal.aborted) controller.abort();
      else req.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
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
    const parsed = openAIChatResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ModelError(`响应结构校验失败: ${parsed.error.message}`, this.id);
    }

    const choice = parsed.data.choices[0];
    const usage = parsed.data.usage
      ? {
          promptTokens: parsed.data.usage.prompt_tokens,
          completionTokens: parsed.data.usage.completion_tokens,
          totalTokens: parsed.data.usage.total_tokens,
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseToolArgs(tc.function.arguments),
    }));

    return {
      message: { role: 'assistant', content: choice.message.content ?? '', toolCalls },
      usage,
      providerId: this.id,
      model: this.model,
      costUsd: estimateCost(usage, this.costPer1k),
    };
  }
}

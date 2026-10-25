/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Ollama 本地供应商（数据不出本机，零成本）
 */
import { ModelError } from '../../shared/errors';
import type { ProviderConfig } from '../../shared/config';
import type { CapabilityTag } from '../../shared/types';
import type { ChatRequest, ChatResponse, ModelProvider } from '../model.interface';
import { ollamaChatResponseSchema, parseToolArgs } from '../model.dto';
import { estimateCost } from '../cost';

export class OllamaProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly tags: CapabilityTag[];
  readonly costPer1k: number;
  readonly keyIndex?: number;
  private readonly baseURL: string;

  constructor(cfg: ProviderConfig) {
    this.id = cfg.id;
    this.model = cfg.model ?? cfg.id;
    this.tags = cfg.tags;
    this.costPer1k = cfg.costPer1k ?? 0;
    this.keyIndex = cfg.keyIndex;
    this.baseURL = cfg.baseURL.replace(/\/$/, '');
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls && m.toolCalls.length > 0 ? m.toolCalls : undefined,
      })),
      tools: req.tools && req.tools.length > 0 ? req.tools : undefined,
      stream: false,
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
      res = await fetch(`${this.baseURL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      throw new ModelError(`HTTP ${res.status} ${text.slice(0, 200)}`, this.id);
    }

    const json: unknown = await res.json().catch(() => undefined);
    const parsed = ollamaChatResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ModelError(`响应结构校验失败: ${parsed.error.message}`, this.id);
    }

    const msg = parsed.data.message;
    const toolCalls = msg.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseToolArgs(tc.function.arguments),
    }));

    const usage = {
      promptTokens: parsed.data.prompt_eval_count ?? 0,
      completionTokens: parsed.data.eval_count ?? 0,
      totalTokens: (parsed.data.prompt_eval_count ?? 0) + (parsed.data.eval_count ?? 0),
    };

    return {
      message: { role: 'assistant', content: msg.content ?? '', toolCalls },
      usage,
      providerId: this.id,
      model: this.model,
      costUsd: estimateCost(usage, this.costPer1k),
    };
  }

  /**
   * 可选嵌入方法：调用 Ollama /api/embeddings 端点（同 baseURL，本地无需 key）。
   * 仅当本地模型支持嵌入时可用，供向量 RAG 可选通道调用。
   */
  async embed(texts: string[], model?: string): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    const results: number[][] = [];
    try {
      // Ollama /api/embeddings 单次只接受一个 input，逐条调用
      for (const text of texts) {
        let res: Response;
        try {
          res = await fetch(`${this.baseURL}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model ?? this.model, prompt: text }),
            signal: controller.signal,
          });
        } catch (e) {
          const aborted = controller.signal.aborted;
          if (aborted) throw new ModelError('嵌入请求超时', this.id);
          throw new ModelError(`嵌入网络请求失败: ${e instanceof Error ? e.message : String(e)}`, this.id);
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new ModelError(`嵌入 HTTP ${res.status} ${errText.slice(0, 200)}`, this.id, res.status);
        }

        const json: unknown = await res.json().catch(() => undefined);
        const embedding = (json as { embedding?: number[] })?.embedding;
        if (!Array.isArray(embedding)) {
          throw new ModelError('嵌入响应缺少 embedding 数组', this.id);
        }
        results.push(embedding);
      }
    } finally {
      clearTimeout(timer);
    }
    return results;
  }
}

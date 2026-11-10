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
import { extractTextToolCalls } from '../text-toolcall';
import { estimateCost } from '../cost';

/**
 * 识别 Cline 之类"网关包络"响应：顶层 { data, success }，data 才是真正的
 * OpenAI Chat Completions。识别条件同时检查 success 字段类型 + data.choices
 * 存在，避免误把用户标准响应解包。
 */
function unwrapGatewayEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (
      typeof obj.success === 'boolean' &&
      obj.data && typeof obj.data === 'object' &&
      Array.isArray((obj.data as Record<string, unknown>).choices)
    ) {
      return obj.data;
    }
  }
  return raw;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly tags: CapabilityTag[];
  readonly costPer1k: number;
  readonly keyIndex?: number;
  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly userAgent?: string;

  constructor(cfg: ProviderConfig) {
    this.id = cfg.id;
    this.model = cfg.model ?? cfg.id;
    this.tags = cfg.tags;
    this.costPer1k = cfg.costPer1k ?? 0;
    this.keyIndex = cfg.keyIndex;
    this.baseURL = cfg.baseURL.replace(/\/$/, '');
    this.apiKey = cfg.apiKey;
    this.userAgent = cfg.userAgent;
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
      // 8192：长报告/长代码输出在 4096 下频繁截断（dots 系网关把 tool call 混在
      // content 里，截断导致闭合标签缺失、工具静默失效），默认放宽一倍
      max_tokens: req.maxTokens ?? 8192,
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
          ...(this.userAgent ? { 'user-agent': this.userAgent } : {}),
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
    // Cline 等部分网关返回包络结构 { data: <标准响应>, success: bool }，
    // 标准 schema 校验会报"choices 找不到"。先探测解包再校验。
    const unwrapped = unwrapGatewayEnvelope(json);
    const parsed = openAIChatResponseSchema.safeParse(unwrapped);
    if (!parsed.success) {
      throw new ModelError(`响应结构校验失败: ${parsed.error.message}`, this.id);
    }

    const choice = parsed.data.choices[0];
    // 2026-11-09 修复：上游 finish_reason 明确告知截断时必须把信号上抛，
    // 否则「半截 tool call 被容错解析 → 静默落盘 → 报 done」的退化链路无从阻断。
    const finishReason = choice.finish_reason ?? undefined;
    let truncated = finishReason === 'length' || finishReason === 'max_tokens';
    const usage = parsed.data.usage
      ? {
          promptTokens: parsed.data.usage.prompt_tokens,
          completionTokens: parsed.data.usage.completion_tokens,
          totalTokens: parsed.data.usage.total_tokens,
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    let content = choice.message.content ?? '';

    let toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseToolArgs(tc.function.arguments),
    }));

    // 兜底：部分模型/网关（dots 系、无原生 FC 的 Qwen 系）把 tool call 以
    // 文本形式混在 content 里而不返回 tool_calls 字段——提取为标准结构，
    // 否则 write_file 等工具会静默失效、XML 直接漏进对话正文。
    if ((!toolCalls || toolCalls.length === 0) && content) {
      const extracted = extractTextToolCalls(content);
      if (extracted) {
        toolCalls = extracted.toolCalls.length > 0 ? extracted.toolCalls : undefined;
        content = extracted.cleanedContent;
        truncated = truncated || !!extracted.truncated;
      }
    }
    if (truncated && (!toolCalls || toolCalls.length === 0)) {
      content = '【输出被截断】上一轮回复超过模型单次输出上限，未闭合的 tool call 已丢弃，禁止直接收尾。请改用 write_file 的 append:true 分段写入，每段不超过 200 行，最后一段补齐闭合标签。';
    }

    return {
      message: { role: 'assistant', content, toolCalls },
      usage,
      providerId: this.id,
      model: this.model,
      costUsd: estimateCost(usage, this.costPer1k),
      finishReason,
      truncated,
    };
  }

  /**
   * 可选嵌入方法：调用 OpenAI 兼容 /embeddings 端点（同 baseURL 同 key）。
   * 仅当 provider 实际支持嵌入模型时可用，供向量 RAG 可选通道调用。
   */
  async embed(texts: string[], model?: string): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    const body = {
      model: model ?? this.model,
      input: texts,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    let res: Response;
    try {
      res = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(this.userAgent ? { 'user-agent': this.userAgent } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = controller.signal.aborted;
      if (aborted) throw new ModelError('嵌入请求超时', this.id);
      throw new ModelError(`嵌入网络请求失败: ${e instanceof Error ? e.message : String(e)}`, this.id);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ModelError(`嵌入 HTTP ${res.status} ${text.slice(0, 200)}`, this.id, res.status);
    }

    const json: unknown = await res.json().catch(() => undefined);
    const data = (json as { data?: Array<{ embedding?: number[] }> })?.data;
    if (!Array.isArray(data)) {
      throw new ModelError('嵌入响应缺少 data 数组', this.id);
    }
    return data.map((item) => item.embedding ?? []);
  }
}

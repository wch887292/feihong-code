/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 本地模型管理：走宿主 Ollama，幂等拉取模型，并对外提供本地模型状态。
 * 不捆绑任何二进制或模型文件进包。
 */
import { probeOllama, type DeviceProbeResult } from './device-probe';

export interface LocalModelStatus {
  /** 宿主 Ollama 是否可达 */
  available: boolean;
  /** 已安装的本地模型名列表 */
  models: string[];
  /** GPU 后端：nvidia / rocm / cpu */
  gpu: 'nvidia' | 'rocm' | 'cpu';
  /** Ollama 版本（未知为空） */
  version: string;
  /** 探测耗时（ms） */
  latencyMs: number;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

/**
 * 幂等拉取模型：POST {baseUrl}/api/pull。
 * 已存在（/api/tags 中命中）则跳过；拉取过程流式读取直到 done。
 * 任何失败返回 false，不抛错（fail-open）。
 */
export async function ensureOllamaModel(
  model: string,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<boolean> {
  if (!model) return false;
  const normalized = baseUrl.replace(/\/$/, '');

  // 已存在则跳过
  try {
    const tagsRes = await fetch(`${normalized}/api/tags`, { method: 'GET' });
    if (tagsRes.ok) {
      const payload: unknown = await tagsRes.json().catch(() => undefined);
      const names: string[] = [];
      if (payload && typeof payload === 'object') {
        const models = (payload as { models?: Array<{ name?: string; model?: string }> }).models;
        if (Array.isArray(models)) {
          for (const m of models) {
            if (m && typeof m === 'object') {
              const n = typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : '';
              if (n) names.push(n);
            }
          }
        }
      }
      if (names.includes(model)) return true;
    }
  } catch {
    // 探测失败继续尝试 pull（由 pull 决定结果）
  }

  // 幂等拉取：POST /api/pull，流式读取直到 done
  try {
    const controller = new AbortController();
    // 拉取大模型可能耗时较长，默认 30 分钟超时
    const timer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    let res: Response;
    try {
      res = await fetch(`${normalized}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const text = decoder.decode(chunk.value, { stream: true });
      // 逐行解析 JSON，遇到 status=success 即完成
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as { status?: string; error?: string };
          if (obj.error) return false;
          if (obj.status === 'success') {
            done = true;
            break;
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }
    return done;
  } catch {
    return false;
  }
}

/**
 * 本地模型状态：探测宿主 Ollama 可达性、已安装模型与 GPU 后端。
 * 全部 fail-open，任何异常返回不可用状态，不抛错。
 */
export async function localModelStatus(
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<LocalModelStatus> {
  let probe: DeviceProbeResult;
  try {
    probe = await probeOllama(baseUrl);
  } catch {
    probe = { available: false, version: '', gpu: 'cpu', models: [], latencyMs: 0 };
  }
  return {
    available: probe.available,
    models: probe.models,
    gpu: probe.gpu,
    version: probe.version,
    latencyMs: probe.latencyMs,
  };
}
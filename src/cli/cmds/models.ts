/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 模型发现命令（对标 dsh「获取可用模型」）：
 *   fhcode models discover [providerId]   探测端点的可用模型列表
 *   - OpenAI 兼容：GET {baseURL}/models（Bearer）
 *   - Anthropic：GET {baseURL}/v1/models（x-api-key + anthropic-version）
 *   - Ollama：GET {baseURL}/api/tags
 * 归一化 data[] / models{} 两种常见返回格式，失败时提示手动录入。
 */
import type { ProviderConfig } from '../../shared/config';
import { loadConfig, resolveHomeDir } from '../../shared/config';
import { resolveProviderApiKey } from '../../security/credentials';

/** 归一 baseURL：Anthropic 列表 URL 容忍带/不带末尾 /v1 */
function modelsListEndpoint(baseURL: string, type: string): string {
  const root = baseURL.replace(/\/$/, '');
  if (type === 'ollama') return `${root}/api/tags`;
  if (type === 'anthropic-messages') return root.endsWith('/v1') ? `${root}/models` : `${root}/v1/models`;
  return `${root}/models`;
}

/** 从响应提取模型 id 列表：data[]（id 字段）或 models{}（对象键）两种格式 */
function extractModelIds(json: unknown): string[] {
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      const ids = obj.data
        .map((d: unknown) => (d && typeof d === 'object' ? ((d as Record<string, unknown>).id as string) : undefined))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length > 0) return [...new Set(ids)].sort();
    }
    if (obj.models && typeof obj.models === 'object' && !Array.isArray(obj.models)) {
      const ids = Object.keys(obj.models as Record<string, unknown>);
      if (ids.length > 0) return ids.sort();
    }
    if (Array.isArray(obj.models)) {
      const ids = (obj.models as unknown[])
        .map((m: unknown) => (m && typeof m === 'object' ? ((m as Record<string, unknown>).id as string) : undefined))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length > 0) return [...new Set(ids)].sort();
    }
  }
  return [];
}

export async function runModelsDiscoverCmd(providerId?: string): Promise<void> {
  // loadConfig 走与真实请求一致的 provider 解析（FH_PROVIDERS / 配置文件 / 单环境变量）
  const cfg = loadConfig();
  const providers = cfg.models.providers ?? [];
  if (providers.length === 0) {
    console.error('未配置任何模型 provider（FH_PROVIDERS 或 fhcode.config.json models.providers 为空）。');
    process.exitCode = 1;
    return;
  }
  const targets: ProviderConfig[] = providerId
    ? providers.filter((p) => p.id === providerId)
    : providers;
  if (targets.length === 0) {
    console.error(`未找到 provider: ${providerId}`);
    process.exitCode = 1;
    return;
  }

  const homeDir = resolveHomeDir();
  for (const p of targets) {
    const apiKey = resolveProviderApiKey(p, homeDir);
    const endpoint = modelsListEndpoint(p.baseURL, p.type);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (p.type === 'anthropic-messages') {
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    try {
      const res = await fetch(endpoint, { method: 'GET', headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`  ✗ ${p.id} (${p.type}) HTTP ${res.status} ${text.slice(0, 120)}`);
        continue;
      }
      const json: unknown = await res.json().catch(() => undefined);
      const ids = extractModelIds(json);
      if (ids.length === 0) {
        console.log(`  ~ ${p.id} (${p.type}) 返回空列表或格式不在支持范围（data[]/models{}），请手动录入模型 ID`);
        continue;
      }
      console.log(`  ✓ ${p.id} (${p.type}) ${ids.length} 个模型:`);
      for (const id of ids) console.log(`      - ${id}`);
    } catch (e) {
      console.error(`  ✗ ${p.id} (${p.type}) 探测失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

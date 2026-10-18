/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1-4 插件 Provider 注册中心（对标 dsh「一切皆插件」的模型路由侧）：
 *  - 插件 plugin.json 可声明 providers，加载后合并进模型路由
 *  - 冲突检测：与已配置 provider 同 id 时，type+baseURL 一致视为幂等跳过；
 *    不一致视为冲突，拒绝插件声明并保留配置版（fail-safe，不静默覆盖）
 */
import type { ProviderConfig } from '../shared/config';

export interface PluginProviderMergeResult {
  providers: ProviderConfig[];
  /** 冲突明细（provider id + 原因），调用方应记录到日志/诊断 */
  conflicts: Array<{ id: string; plugin: string; reason: string }>;
}

function sameEndpoint(a: ProviderConfig, b: ProviderConfig): boolean {
  return a.type === b.type && a.baseURL === b.baseURL;
}

/** 合并插件 provider 到已配置列表：配置优先，冲突拒绝加载并返回冲突明细 */
export function mergePluginProviders(
  configured: ProviderConfig[],
  fromPlugins: ProviderConfig[],
): PluginProviderMergeResult {
  const providers = [...configured];
  const conflicts: Array<{ id: string; plugin: string; reason: string }> = [];

  for (const pluginProvider of fromPlugins) {
    const id = pluginProvider.id;
    if (!id || typeof id !== 'string' || id.length === 0) {
      conflicts.push({ id: '(空)', plugin: '(未知)', reason: '插件 provider 缺少 id' });
      continue;
    }
    const existing = providers.find((p) => p.id === id);
    if (!existing) {
      providers.push(pluginProvider);
      continue;
    }
    if (sameEndpoint(existing, pluginProvider)) {
      // 幂等：配置与插件声明一致，跳过（不重复注册）
      continue;
    }
    conflicts.push({
      id,
      plugin: pluginProvider.model ?? '(插件)',
      reason: `与配置冲突（配置 type=${existing.type}/${existing.baseURL}，插件 type=${pluginProvider.type}/${pluginProvider.baseURL}），保留配置版`,
    });
  }

  return { providers, conflicts };
}

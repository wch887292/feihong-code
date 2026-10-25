/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹
 *
 * sync-client 配置读取：从环境变量加载同步客户端配置
 */

import { SyncClientConfig } from './sync-client.types';

const defaultConfig: SyncClientConfig = {
  url: process.env.FHCODE_SYNC_URL ?? '',
  token: process.env.FHCODE_SYNC_TOKEN ?? '',
  enabled: process.env.FHCODE_SYNC_ENABLED === 'true',
  interval: Number(process.env.FHCODE_SYNC_INTERVAL) || 60000,
};

export function loadSyncConfig(): SyncClientConfig {
  return {
    ...defaultConfig,
    enabled: defaultConfig.enabled ?? false,
    interval: defaultConfig.interval || 60000,
  };
}

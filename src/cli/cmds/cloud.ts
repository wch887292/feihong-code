/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹
 *
 * CLI 子命令：fhcode cloud-delegate "<目标>" —— 把任务转投云端电脑执行
 * 任务进入 sync-server 的云端队列（executor='cloud'），由服务器上的云执行器认领执行，
 * 本机不开机也照跑；进度与结果在手机端/任意端可见。
 */
import { AppError } from '../../shared/errors';
import { loadSyncConfig } from '../../features/sync-client/config';
import { hostname } from 'node:os';

/** cloud-delegate 入口：校验配置后把 goal 以 executor='cloud' 送入同步队列 */
export async function runCloudDelegate(goal: string): Promise<void> {
  if (!goal || !goal.trim()) {
    throw new AppError('用法：fhcode cloud-delegate "<任务目标>"', 'CLOUD_GOAL_MISSING', 400);
  }
  const cfg = loadSyncConfig();
  if (!cfg.enabled) {
    throw new AppError('跨端同步未启用：请设置环境变量 FHCODE_SYNC_ENABLED=true', 'SYNC_DISABLED', 400);
  }
  if (!cfg.url || !cfg.token) {
    throw new AppError('缺少同步配置：请设置 FHCODE_SYNC_URL 与 FHCODE_SYNC_TOKEN', 'SYNC_CONFIG_MISSING', 400);
  }

  const host = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'local';
  const runId = 'delegate-' + host;

  // 1. 确保会话存在（不存在则以 done 态创建——done 会话才会接收新 goal 入队）
  const check = await fetch(cfg.url + '/api/sessions/' + encodeURIComponent(runId), {
    headers: { Authorization: 'Bearer ' + cfg.token },
  });
  if (check.status === 404) {
    const create = await fetch(cfg.url + '/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
      body: JSON.stringify({
        runId,
        goal: '云端转投会话（' + hostname() + '）',
        status: 'done',
        messages: [],
      }),
    });
    if (!create.ok) throw new AppError('创建转投会话失败: HTTP ' + create.status, 'CLOUD_SESSION_CREATE_FAILED', create.status);
  }

  // 2. 下发 goal，标记 executor='cloud'
  const res = await fetch(cfg.url + '/api/sessions/' + encodeURIComponent(runId) + '/goals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
    body: JSON.stringify({ goal: goal.trim(), executor: 'cloud' }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok !== true) {
    throw new AppError('转投失败: ' + ((data && data.error) || ('HTTP ' + res.status)), 'CLOUD_DELEGATE_FAILED', res.status);
  }

  console.log('[cloud-delegate] 已转投云端执行');
  console.log('  会话: ' + runId);
  console.log('  任务: ' + goal.trim().slice(0, 80));
  console.log('  进度: 手机端同步任务页或任意端打开 ' + cfg.url + ' 可见（云电脑执行，本机无需开机）');
}

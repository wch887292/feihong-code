/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹
 *
 * sync-client 推送器：将会话快照推送到 sync-server
 * 设计约束：任何错误静默吞掉，绝不影响 CLI 主流程
 */

import { SyncSessionSnapshot, SyncPushResult } from './sync-client.types';

let lastPushTime = 0;
const THROTTLE_MS = 5000;

/** 重置节流计时（测试用） */
export function resetThrottle(): void {
  lastPushTime = 0;
}

/**
 * 推送会话快照到 sync-server（POST /api/sessions，合并模式）
 * @param opts.force 为 true 时绕过 5 秒节流（用于最终状态推送，确保多端立刻看到结果）
 */
export async function pushSnapshot(
  url: string,
  token: string,
  snapshot: SyncSessionSnapshot,
  opts?: { force?: boolean }
): Promise<SyncPushResult> {
  const now = Date.now();
  if (!opts?.force && now - lastPushTime < THROTTLE_MS) {
    return { ok: false, error: 'throttled' };
  }

  try {
    lastPushTime = now;
    const response = await fetch(url + '/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      return { ok: false, error: `http_status_${response.status}` };
    }

    const data = (await response.json()) as { ok?: boolean };
    return { ok: data.ok === true, runId: snapshot.runId };
  } catch (e) {
    // 静默吞错，不影响主流程
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

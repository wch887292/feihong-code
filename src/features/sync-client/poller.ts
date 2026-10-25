/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹
 *
 * sync-client 轮询器：从 sync-server 认领远程下发的 goal 并执行
 * 协议对齐 sync-server 阶段一（docs/sync-protocol.md）：
 *   GET  /api/sessions              会话列表摘要
 *   POST /api/sessions/:runId/claim 拉取该会话下 queued 的 goal（goal 置 running）
 *   POST /api/sessions/:runId/status 更新会话状态
 * 设计约束：任何错误静默吞掉，轮询永不崩溃。
 */

import { SyncSessionsSummary } from './sync-client.types';

let pollingIntervalId: NodeJS.Timeout | null = null;

/** 拉取会话列表摘要 */
async function listSessions(url: string, token: string): Promise<SyncSessionsSummary[]> {
  const response = await fetch(url + '/api/sessions', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { ok?: boolean; sessions?: SyncSessionsSummary[] };
  return Array.isArray(data.sessions) ? data.sessions : [];
}

/** 对指定会话 claim 一个 queued goal，返回 goal 文本；无可拉取返回 null */
async function claimGoal(url: string, token: string, runId: string): Promise<string | null> {
  const response = await fetch(url + `/api/sessions/${encodeURIComponent(runId)}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { ok?: boolean; goal?: { goal?: string } };
  return data.ok && data.goal?.goal ? data.goal.goal : null;
}

/** 更新会话状态（静默吞错） */
async function updateStatus(url: string, token: string, runId: string, status: string): Promise<void> {
  try {
    await fetch(url + `/api/sessions/${encodeURIComponent(runId)}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
  } catch {
    // 静默吞错
  }
}

/**
 * 扫描所有待执行会话并认领执行：
 * 会话 status=queued 表示其下有等待执行的 goal（sync-server 在下发 goal 时自动置 queued）。
 * @returns 是否实际执行了至少一个 goal
 */
export async function claimAndExecute(
  url: string,
  token: string,
  executeGoal: (goal: string, runId: string) => Promise<void>
): Promise<boolean> {
  try {
    const sessions = await listSessions(url, token);
    const queuedSessions = sessions.filter((s) => s.status === 'queued');
    if (queuedSessions.length === 0) return false;

    let executed = false;
    for (const s of queuedSessions) {
      const goalText = await claimGoal(url, token, s.runId);
      if (!goalText) continue; // 已被其他端认领或无 queued goal，跳过
      await updateStatus(url, token, s.runId, 'running');
      try {
        await executeGoal(goalText, s.runId);
        await updateStatus(url, token, s.runId, 'done');
      } catch {
        await updateStatus(url, token, s.runId, 'failed');
      }
      executed = true;
    }
    return executed;
  } catch {
    return false;
  }
}

/**
 * 启动轮询：每 interval 毫秒扫描一次，返回停止函数
 */
export function startPolling(
  url: string,
  token: string,
  executeGoal: (goal: string, runId: string) => Promise<void>,
  interval: number,
  opts?: { once?: boolean }
): () => void {
  const stop = (): void => {
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
  };

  const tick = async (): Promise<void> => {
    try {
      const executed = await claimAndExecute(url, token, executeGoal);
      if (opts?.once && executed) stop();
    } catch {
      // 静默吞错
    }
  };

  if (opts?.once) {
    // 单次模式：立即执行一轮后由调用方决定退出
    void tick();
  } else {
    pollingIntervalId = setInterval(() => { void tick(); }, interval);
    void tick(); // 启动即执行一次
  }

  return stop;
}

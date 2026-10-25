/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹
 *
 * CLI 子命令：fhcode sync-poll —— 轮询 sync-server，认领并执行远程下发的 goal
 * 用法：fhcode sync-poll [once]
 *   默认持续轮询（间隔取 FHCODE_SYNC_INTERVAL，默认 60 秒）；加 once 则扫描一轮即退出
 * 环境变量：FHCODE_SYNC_URL / FHCODE_SYNC_TOKEN / FHCODE_SYNC_ENABLED=true / FHCODE_SYNC_INTERVAL
 */
import { AppError } from '../../shared/errors';
import { loadSyncConfig } from '../../features/sync-client/config';
import { startPolling, claimAndExecute } from '../../features/sync-client/poller';
import { executeTask, isOfflineByDefault } from '../../core/task-executor';

/** sync-poll 命令入口：校验配置后启动轮询 */
export async function runSyncPoll(opts: { once?: boolean }): Promise<void> {
  const cfg = loadSyncConfig();
  if (!cfg.enabled) {
    throw new AppError('跨端同步未启用：请设置环境变量 FHCODE_SYNC_ENABLED=true', 'SYNC_DISABLED', 400);
  }
  if (!cfg.url || !cfg.token) {
    throw new AppError('缺少同步配置：请设置 FHCODE_SYNC_URL 与 FHCODE_SYNC_TOKEN（与 sync-server 的 FHCODE_SYNC_TOKEN 一致）', 'SYNC_CONFIG_MISSING', 400);
  }

  console.log(`[sync-poll] 已连接 ${cfg.url}，轮询间隔 ${cfg.interval}ms${opts.once ? '（单次模式）' : ''}`);
  const executeGoal = async (goal: string): Promise<void> => {
    console.log(`[sync-poll] 开始执行远程任务: ${goal.slice(0, 80)}`);
    const result = await executeTask(goal, { offline: isOfflineByDefault() });
    console.log(`[sync-poll] 任务结束 ok=${result.ok} runId=${result.runId}`);
    if (!result.ok) {
      // 执行失败：抛出让 poller 将会话置为 failed
      throw new Error(`任务执行失败: ${result.finalAnswer.slice(0, 200)}`);
    }
  };

  if (opts.once) {
    // 单次模式：完整跑完本轮（认领→执行→终态回传）后自然退出
    // 教训：早期版本用 setTimeout 15s 硬退，会在终态回传前杀死进程，云端永远停在 running
    await claimAndExecute(cfg.url, cfg.token, executeGoal);
    return;
  }

  const stop = startPolling(cfg.url, cfg.token, executeGoal, cfg.interval);
  // 持续模式：常驻运行，Ctrl+C 退出
  process.on('SIGINT', () => { stop(); process.exit(0); });
}

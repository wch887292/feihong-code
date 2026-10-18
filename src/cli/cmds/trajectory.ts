/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 执行轨迹命令（对标 dsh trajectory / Codex rollout）：
 *   fhcode trajectory list                      列出全部轨迹文件
 *   fhcode trajectory replay <runId> [--json]   按时间线回放单条轨迹
 *   fhcode trajectory fork <runId> <step>       从第 N 步分支：重建检查点并提示 resume 续跑
 *   fhcode trajectory resume <runId> [<step>]   从轨迹末端（或指定步骤）重建检查点并立即续跑
 */
import { isOfflineByDefault, getSessionHome } from '../../core/task-executor';
import {
  listTrajectories,
  readTrajectory,
  formatReplay,
  buildForkCheckpoint,
} from '../../runtime/trajectory';
import { saveCheckpoint } from '../../runtime/session-persist';
import { runResume } from './sessions';

export type TrajectoryAction = 'list' | 'replay' | 'fork' | 'resume';

export async function runTrajectoryCmd(
  action: TrajectoryAction = 'list',
  id?: string,
  step?: number,
  json = false,
): Promise<void> {
  const home = getSessionHome(isOfflineByDefault());

  if (action === 'list') {
    const rows = await listTrajectories(home);
    if (rows.length === 0) {
      console.log('（暂无轨迹文件，目录: ' + home + '）');
      return;
    }
    console.log('执行轨迹（sessions/*.jsonl）:');
    for (const r of rows) {
      const goal = (r.goal ?? '').slice(0, 60);
      console.log(
        `  ${r.runId.slice(0, 8)}  ${r.eventCount} 事件  ${(r.sizeBytes / 1024).toFixed(1)}KB  ${r.lastTs ?? ''}  ${goal}`,
      );
    }
    console.log('\n用法：fhcode trajectory replay <runId> | fork <runId> <step> | resume <runId> [<step>]');
    return;
  }

  if (!id) {
    console.error('缺少轨迹 runId。用法：fhcode trajectory replay <runId> [--json] | fork <runId> <step> | resume <runId> [<step>]');
    process.exitCode = 1;
    return;
  }

  if (action === 'replay') {
    const events = await readTrajectory(home, id);
    if (events.length === 0) {
      console.error(`轨迹不存在或为空: ${id}（目录: ${home}）`);
      process.exitCode = 1;
      return;
    }
    if (json) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }
    console.log(`轨迹回放 ${id}（${events.length} 条事件）`);
    console.log('='.repeat(72));
    console.log(formatReplay(events));
    return;
  }

  if (action === 'fork' || action === 'resume') {
    // 未指定步骤：fork 必须显式给步骤；resume 缺省续到轨迹末端
    if (action === 'fork' && (step === undefined || !Number.isFinite(step))) {
      console.error('缺少分支步骤号。用法：fhcode trajectory fork <runId> <step>');
      process.exitCode = 1;
      return;
    }
    try {
      const { checkpoint, steps } = await buildForkCheckpoint(home, id, step ?? Number.POSITIVE_INFINITY);
      await saveCheckpoint(home, checkpoint);
      console.log(`✓ 已从轨迹 ${id} 步骤 ${steps} 分支，重建会话 ${checkpoint.runId.slice(0, 8)}`);
      console.log(`  目标: ${checkpoint.goal.slice(0, 80)}`);
      console.log(`  消息 ${checkpoint.messages.length} 条 / 迭代 ${checkpoint.iterations} / 文件 ${checkpoint.touchedFiles.length}`);
      if (action === 'resume') {
        console.log(`  立即续跑（可 Ctrl+C 中断后执行 fhcode resume ${checkpoint.runId}）...`);
        await runResume(checkpoint.runId);
      } else {
        console.log(`  继续执行：fhcode resume ${checkpoint.runId}`);
      }
    } catch (e) {
      console.error(`${action === 'resume' ? '续跑' : '分支'}失败: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1 命令入口：
 *   - recover        扫描会话目录下未正常收尾（crashed/running）的中断会话，列出可恢复项
 *                    （对标 Today CN DesktopStartupRecovery；真正续跑走既有 fhcode resume <id>）
 *   - manifest verify 校验会话检查点的内容指纹清单（sha256 + provenance + manifestSha256 自校验）
 *                    （对标 Today CN checksums.json 完整性溯源）
 */
import { loadCheckpoint, listCheckpoints } from '../../runtime/session-persist';
import { findRecoverable } from '../../runtime/recovery';
import { verifyCheckpointManifest } from '../../runtime/provenance';
import { isOfflineByDefault, getSessionHome } from '../../core/task-executor';

/** 列出可恢复的中断会话（崩溃恢复入口，对标 DesktopStartupRecovery） */
export async function runRecover(json: boolean): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);
  const cps = await listCheckpoints(home);
  // 完整性预检：有清单的会话先验 manifest，未通过则标记不可续跑（防篡改）
  const recoverable = await findRecoverable(cps, {
    verifyOne: async (cp) => {
      try {
        const r = await verifyCheckpointManifest(home, cp.runId, cp.cwd);
        return r.ok || r.total === 0; // 无清单（旧会话）视为可续跑
      } catch {
        return true;
      }
    },
  });

  if (recoverable.length === 0) {
    if (json) {
      console.log(JSON.stringify({ ok: true, home, recoverable: [] }, null, 2));
    } else {
      console.log('未发现可恢复的中断会话（status=crashed/running）。');
    }
    return;
  }

  if (json) {
    console.log(JSON.stringify({ ok: true, home, mode: offline ? 'offline' : 'live', recoverable }, null, 2));
    return;
  }

  console.log(`会话目录: ${home}（${offline ? '离线' : '在线'}模式）`);
  console.log(`发现 ${recoverable.length} 个中断会话，其中可续跑 ${recoverable.filter((r) => r.resumable).length} 个：\n`);
  for (const r of recoverable) {
    const mark = r.resumable ? '▶ 可续跑' : '✖ 不可续跑';
    console.log(`  [${r.runId.slice(0, 8)}] ${mark}  status=${r.status}  迭代=${r.iterations}  成本=$${r.costUsd.toFixed(6)}  改动文件=${r.touchedFiles}`);
    console.log(`      目标: ${r.goal}`);
    if (!r.resumable && r.reason) console.log(`      原因: ${r.reason}`);
    console.log(`      续跑: fhcode resume ${r.runId}`);
  }
  console.log('\n提示：崩溃恢复对标 Today CN DesktopStartupRecovery——上方为扫描结果，实际续跑请执行 `fhcode resume <runId>`。');
}

/** 校验单个会话检查点的内容指纹清单（缺省校验最近一个） */
export async function runManifestVerify(id: string | undefined, json: boolean): Promise<void> {
  const offline = isOfflineByDefault();
  const home = getSessionHome(offline);

  let resolved: string | undefined;
  if (id) {
    // 支持 8 位前缀
    const cp = await loadCheckpoint(home, id);
    if (cp) {
      resolved = cp.runId;
    } else {
      const all = await listCheckpoints(home);
      const matches = all.filter((c) => c.runId.startsWith(id));
      if (matches.length === 1) resolved = matches[0].runId;
      else {
        const msg = `未找到会话检查点: ${id}`;
        console.log(json ? JSON.stringify({ ok: false, detail: msg }) : msg);
        process.exitCode = 1;
        return;
      }
    }
  } else {
    const cps = await listCheckpoints(home);
    if (cps.length === 0) {
      const msg = '无会话可校验';
      console.log(json ? JSON.stringify({ ok: false, detail: msg }) : msg);
      process.exitCode = 1;
      return;
    }
    resolved = cps[0].runId;
  }

  const runId = resolved;
  const cwd = (await loadCheckpoint(home, runId))?.cwd;
  const result = await verifyCheckpointManifest(home, runId, cwd);

  if (json) {
    console.log(JSON.stringify({ runId, ...result }, null, 2));
  } else {
    const head = result.ok ? '✅ 清单完整' : '❌ 清单不完整';
    console.log(`[${head}] ${runId.slice(0, 8)}  文件=${result.total}`);
    if (result.brokenSelf) console.log('  ✖ 清单自校验失败（manifestSha256 被改写）');
    for (const m of result.mismatches) {
      console.log(`  ✖ ${m.rel}: ${m.reason}${m.expected ? `（期望 ${m.expected.slice(0, 12)}…）` : ''}${m.actual ? `（实际 ${m.actual.slice(0, 12)}…）` : ''}`);
    }
    if (result.ok) console.log('  所有文件内容指纹与 provenance 一致，未被篡改。');
  }
  if (!result.ok) process.exitCode = 1;
}

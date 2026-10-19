/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 沙箱命令（对标 dsh sandboxed commands）：
 *   fhcode sandbox run <dir> -- <cmd>   在工作区副本中执行命令（防误操作污染原目录）
 *   fhcode sandbox run <dir> -- <cmd> --sync   执行后把沙箱变更合并回原目录
 *   fhcode sandbox run <dir> -- <cmd> --os     OS 级沙箱执行（bwrap/unshare/sandbox-exec，Windows 受限降级）
 *   fhcode sandbox status                     显示本机 OS 沙箱后端能力
 */
import { resolve } from 'path';
import { createWorkspaceSandbox, runInSandbox, diffSandbox, mergeSandbox } from '../../runtime/sandbox';
import { runOsSandboxed, detectOsSandbox, describeOsSandbox } from '../../runtime/os-sandbox';

/** fhcode sandbox status：OS 沙箱后端探测结果 */
export async function showSandboxStatus(): Promise<void> {
  const info = await detectOsSandbox();
  console.log(`OS 沙箱后端: ${info.backend}${info.available ? '（可用）' : '（不可用）'}`);
  console.log(`  平台: ${info.platform}`);
  if (info.reason) console.log(`  说明: ${info.reason}`);
  console.log(describeOsSandbox(info));
}

export async function runSandboxCmd(workdir: string, command: string, sync: boolean, os: boolean): Promise<void> {
  // status 子命令：fhcode sandbox status
  if (workdir === 'status' && !command.trim()) {
    await showSandboxStatus();
    return;
  }
  const absWork = resolve(workdir || '.');

  // --os：OS 级沙箱直接在当前工作区执行（进程/命名空间隔离，非副本复制）
  if (os) {
    if (!command.trim()) {
      console.error('缺少命令。用法：fhcode sandbox run <目录> -- <命令> --os');
      process.exitCode = 1;
      return;
    }
    const info = await detectOsSandbox();
    console.log(`OS 沙箱: ${info.backend}${info.available ? '' : '（后端不可用，降级受限执行）'}`);
    const started = Date.now();
    console.log(`> ${command}`);
    const res = await runOsSandboxed({ command, cwd: absWork });
    const costMs = Date.now() - started;
    if (res.stdout.trim()) console.log(res.stdout.trimEnd());
    if (res.stderr.trim()) console.error(res.stderr.trimEnd());
    console.log(`退出码 ${res.exitCode}（耗时 ${(costMs / 1000).toFixed(1)}s，后端 ${res.backend}${res.timedOut ? '，已超时强杀' : ''}）`);
    return;
  }

  if (!command.trim()) {
    console.error('缺少命令。用法：fhcode sandbox run <目录> -- <命令> [--sync|--os]');
    process.exitCode = 1;
    return;
  }
  let handle;
  try {
    handle = await createWorkspaceSandbox(absWork);
  } catch (e) {
    console.error(`沙箱创建失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  console.log(`> ${command}`);
  const res = await runInSandbox(handle.root, command);
  const costMs = Date.now() - started;
  if (res.stdout.trim()) console.log(res.stdout.trimEnd());
  if (res.stderr.trim()) console.error(res.stderr.trimEnd());
  console.log(`退出码 ${res.exitCode}（耗时 ${(costMs / 1000).toFixed(1)}s）`);

  const changes = await diffSandbox(handle.root, absWork);
  if (changes.length === 0) {
    console.log('沙箱内无文件变更（原工作区未受影响）');
  } else {
    const kinds: Record<string, number> = {};
    for (const c of changes) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    console.log(`沙箱变更: ${Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(' ')}`);
    for (const c of changes.slice(0, 30)) {
      console.log(`  ${c.kind === 'add' ? '+' : c.kind === 'delete' ? '-' : '~'} ${c.path}`);
    }
    if (changes.length > 30) console.log(`  …等 ${changes.length} 项`);
    if (sync) {
      const merged = await mergeSandbox(handle.root, absWork, changes);
      console.log(`✓ 已合并 ${merged.length} 项变更回 ${absWork}`);
    } else {
      console.log('未合并（原工作区未被修改）。如需应用变更，请加 --sync 重跑');
    }
  }

  try { await handle.cleanup(); } catch { /* 清理失败不影响结果 */ }
}

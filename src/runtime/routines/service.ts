/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ③ Routines 服务单例：把真实 runner 与持久化调度器装配起来，
 * 供 CLI（fhcode routine）与 Web 控制台（serve）共用同一实例。
 */
import { join } from 'path';
import { resolveHomeDir, loadConfigFile } from '../../shared/config';
import { RoutineScheduler } from './scheduler';
import { createRoutineRunner } from './runner';
import { ApprovalInbox } from '../../security/approval-inbox';
import type { UserRule } from '../../security/rules-engine';

let _scheduler: RoutineScheduler | null = null;
let _inbox: ApprovalInbox | null = null;

/** 从配置装配真实 runner（三级规则引擎 + 审批收件箱门控） */
export function buildRunner(homeDir: string, inbox: ApprovalInbox): ReturnType<typeof createRoutineRunner> {
  const cfg = loadConfigFile();
  const rules = ((cfg?.security?.rules as UserRule[] | undefined) ?? []) as UserRule[];
  const requireApproval = process.env.FH_REQUIRE_APPROVAL !== 'false';
  return createRoutineRunner({ homeDir, rules, inbox, requireApproval, workspaceDir: process.cwd() });
}

/** 获取或创建全局调度器单例（缺省基于 FH_HOME） */
export function ensureScheduler(homeDir?: string): RoutineScheduler {
  if (_scheduler) return _scheduler;
  const dir = homeDir ?? resolveHomeDir();
  const routineDir = join(dir, 'routines');
  _inbox = new ApprovalInbox(routineDir);
  _scheduler = new RoutineScheduler({
    dir: routineDir,
    runner: buildRunner(dir, _inbox),
    maxConcurrent: 3,
  });
  return _scheduler;
}

/** 返回当前调度器单例（未初始化返回 null） */
export function getScheduler(): RoutineScheduler | null {
  return _scheduler;
}

/** 返回当前审批收件箱单例（未初始化返回 null） */
export function getInbox(): ApprovalInbox | null {
  return _inbox;
}

/** 仅供测试/重置用 */
export function _resetSchedulerForTest(): void {
  _scheduler = null;
  _inbox = null;
}

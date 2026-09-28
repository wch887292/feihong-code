/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * CLI 命令装配层。
 * 所有命令实现已下沉到 cli/cmds/*（B3 架构治理延续，2026-09-28），
 * 此处仅做再导出，兼容既有 import 路径（cli/index.ts / repl.ts / tests）。
 */

// B1 架构治理(2026-09-27)：任务执行核心下沉到 core/task-executor（打断 cli↔web 循环依赖），
// 保留再导出以兼容既有 import 路径。
export {
  executeTask,
  getEnterprise,
  streamRenderer,
  isOfflineByDefault,
  interactiveApprover,
  defaultApproverFor,
} from '../core/task-executor';
export type { RunOptions } from '../core/task-executor';

export * from './cmds/skills';
export * from './cmds/sessions';
export * from './cmds/enterprise';
export * from './cmds/integrations';
export * from './cmds/skill-market';
export * from './cmds/self-evolve';
export * from './cmds/code-write';
export * from './cmds/swe';
export * from './cmds/harness';
export * from './cmds/computer-control';
export * from './cmds/license';

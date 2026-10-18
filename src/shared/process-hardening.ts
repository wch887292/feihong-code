/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 进程环境加固（对标 Codex process-hardening）：
 *   CLI 启动时清理易注入的环境变量，防止注入面沿子进程扩散——
 *   NODE_OPTIONS 可被用于 --require 预加载任意模块（供应链/恶意注入高危面），
 *   DEBUG / NODE_DEBUG 可泄露日志细节，LD_PRELOAD / DYLD_INSERT_LIBRARIES
 *   是经典库注入面（Windows 侧无对应项，保留兼容）。
 *
 * 逃生口：设置 FH_ALLOW_DEBUG=1 可保留 DEBUG/NODE_DEBUG（调试场景显式开启）。
 * 本模块不导出清理前的值，避免日志/诊断中复述注入内容。
 */

/** 默认清理的注入面环境变量 */
export const HARDENED_ENV_VARS = [
  'NODE_OPTIONS',           // node --require 预加载注入面
  'NODE_DEBUG',             // 调试输出泄露
  'DEBUG',                  // debug 库调试开关
  'NODE_NO_WARNINGS',       // 可被用于隐藏告警（安全告警不可见）
  'LD_PRELOAD',             // 库预加载注入面（POSIX）
  'DYLD_INSERT_LIBRARIES',  // macOS 库注入面
  'ELECTRON_RUN_AS_NODE',   // 环境逃逸开关
] as const;

/** 清理注入面环境变量（幂等；返回被清理的变量名列表） */
export function hardenProcessEnv(): string[] {
  const allowDebug = process.env.FH_ALLOW_DEBUG === '1';
  const removed: string[] = [];
  for (const key of HARDENED_ENV_VARS) {
    // 调试逃生口只放行与调试直接相关的两个开关
    if (allowDebug && (key === 'DEBUG' || key === 'NODE_DEBUG')) continue;
    if (key in process.env) {
      delete process.env[key];
      removed.push(key);
    }
  }
  return removed;
}

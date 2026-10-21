/**
 * 飞虹 Code Node 版本守卫（必须在任何 node:sqlite 依赖模块之前加载）
 * 飞虹 Code v8.0.0+ 使用 node:sqlite（Node >= 22.5 实验性模块），低版本 Node 直接崩溃，
 * 此守卫在入口最先执行，给出友好提示而非 ERR_UNKNOWN_BUILTIN_MODULE。
 */
const [mj, mn] = process.versions.node.split('.').map(Number);
if (mj < 22 || (mj === 22 && mn < 5)) {
  console.error('');
  console.error('飞虹 Code (fhcode) 需要 Node.js >= 22.5.0（当前: ' + process.versions.node + '）');
  console.error('原因：v8.0.0+ 使用内置 node:sqlite 模块，仅在 Node 22.5+ 可用。');
  console.error('升级方式：https://nodejs.org/ 下载 LTS 及以上版本，或 nvm install 22');
  console.error('');
  process.exit(1);
}

/**
 * 纯净 stdout 模式：以下三类调用的 stdout 必须只承载最终结果，
 * 一切结构化日志（含 import 阶段的副作用日志）改走 stderr。
 *  - --json：stdout 只输出唯一的 JSON 结果对象
 *  - --version / --help：stdout 只输出版本号 / 帮助文本
 * 本文件是入口的第一个 import，因此能在其他模块产生日志前完成切换。
 */
const CLEAN_STDOUT_FLAGS = ['--json', '--version', '--help'];
if (!process.env.FH_LOG_STREAM && CLEAN_STDOUT_FLAGS.some((f) => process.argv.includes(f))) {
  process.env.FH_LOG_STREAM = 'stderr';
}

export {};

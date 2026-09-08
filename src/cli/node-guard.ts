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
export {};

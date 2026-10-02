/**
 * 飞虹 Code 桌面版 preload（最小化安全桥接）
 * contextIsolation 开启、nodeIntegration 关闭：
 * 仅向前端暴露只读的桌面环境标记，不暴露 Node.js 能力，避免安全风险。
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron
});

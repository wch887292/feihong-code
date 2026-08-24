/**
 * 飞虹 Code Electron 预加载脚本
 * 在渲染进程和主进程之间建立安全通信桥梁
 */

const { contextBridge, ipcRenderer } = require('electron');

// 暴露给前端的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 环境信息
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    unmaximize: () => ipcRenderer.send('window:unmaximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChange: (callback) => {
      ipcRenderer.on('window:maximized', (_, isMax) => callback(isMax));
    }
  },

  // 应用控制
  app: {
    quit: () => ipcRenderer.send('app:quit'),
    restart: () => ipcRenderer.send('app:restart'),
    getPath: (name) => ipcRenderer.invoke('app:getPath', name)
  },

  // 系统托盘
  tray: {
    show: () => ipcRenderer.send('tray:show'),
    hide: () => ipcRenderer.send('tray:hide')
  },

  // 外部链接
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path)
  },

  // 对话框
  dialog: {
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpen', options),
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSave', options),
    showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessage', options)
  },

  // 剪贴板
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
    readText: () => ipcRenderer.invoke('clipboard:readText')
  },

  // 通知
  notification: {
    show: (title, body) => ipcRenderer.invoke('notification:show', { title, body })
  },

  // 截图
  screenshot: {
    capture: () => ipcRenderer.invoke('screenshot:capture')
  }
});

// 同时设置一个全局变量，方便前端检测
window.isElectron = true;
window.electronPlatform = process.platform;

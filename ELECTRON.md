# 飞虹 Code Electron 桌面版

## 快速开始

### 开发模式运行

```bash
# 1. 先构建项目
npm run build

# 2. 启动 Electron 桌面版
npm run electron
```

### 打包成 Windows 安装包

```bash
# 打包成 NSIS 安装包 + 便携版
npm run electron:build

# 只打包不发布
npm run electron:dist

# 只生成目录（不打包成安装包，用于测试）
npm run electron:pack
```

打包产物在 `release/` 目录下。

## 功能特性

- ✅ 独立桌面窗口，不依赖浏览器
- ✅ 内置 Web 服务器，启动即用
- ✅ 系统托盘，最小化到后台运行
- ✅ 防止多开，第二个实例自动激活已有窗口
- ✅ 外部链接用系统浏览器打开
- ✅ 预加载脚本，安全暴露 Electron API
- ✅ 支持 NSIS 安装包和便携版

## 目录结构

```
electron/
├── main.js      # Electron 主进程
├── preload.js   # 预加载脚本（渲染进程与主进程通信桥梁）
└── icon.png     # 应用图标（可选）
```

## 前端适配

前端页面可以通过以下方式检测是否在 Electron 环境：

```javascript
if (window.isElectron) {
  // 在 Electron 环境中
  console.log('Electron 版本:', window.electronAPI.versions.electron);

  // 调用 Electron API
  window.electronAPI.window.minimize();
  window.electronAPI.shell.openExternal('https://example.com');
  window.electronAPI.notification.show('标题', '内容');
}
```

## 配置说明

### 修改端口

默认端口 8080，可以通过环境变量修改：

```bash
set FH_WEB_PORT=9090
npm run electron
```

### 修改窗口大小

编辑 `electron/main.js` 中的 `createWindow` 函数：

```javascript
mainWindow = new BrowserWindow({
  width: 1400,   // 窗口宽度
  height: 900,    // 窗口高度
  minWidth: 1024, // 最小宽度
  minHeight: 680, // 最小高度
  // ...
});
```

## 常见问题

### Q: 启动后白屏？
A: 检查是否已运行 `npm run build`，确保 `dist/` 目录存在。

### Q: 端口被占用？
A: 修改 `FH_WEB_PORT` 环境变量，或关闭占用 8080 端口的程序。

### Q: 如何打开开发者工具？
A: 编辑 `electron/main.js`，在 `ready-to-show` 事件中取消注释 `mainWindow.webContents.openDevTools()`。

### Q: 打包失败？
A: 确保网络通畅，electron-builder 需要下载 Electron 二进制文件。国内用户建议配置镜像：
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

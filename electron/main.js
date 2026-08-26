/**
 * 飞虹 Code Electron 桌面版主进程（简化稳定版）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */

const { app, BrowserWindow, shell, Tray, Menu, ipcMain, dialog, clipboard, Notification, session, desktopCapturer, screen, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const { existsSync, writeFileSync, readFileSync } = require('fs');
const { join, resolve } = require('path');
const http = require('http');
const os = require('os');

// 禁用安全警告
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// 配置
const PORT = parseInt(process.env.FH_WEB_PORT || '8081');
const isDev = !app.isPackaged;

// 全局变量
let mainWindow = null;
let serverProcess = null;
let tray = null;

// 获取应用根目录
function getAppPath() {
  if (isDev) return join(__dirname, '..');
  return process.resourcesPath ? join(process.resourcesPath, 'app') : app.getAppPath();
}
const APP_PATH = getAppPath();

/**
 * 等待服务器就绪
 */
function waitForServer(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          res.resume();
          retry();
        }
      });
      req.on('error', () => retry());
      req.setTimeout(2000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error('服务器启动超时'));
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

/**
 * 启动内置 Web 服务器
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const serverEntry = join(APP_PATH, 'dist', 'cli', 'index.js');
    if (!existsSync(serverEntry)) {
      reject(new Error('未找到服务器入口文件，请先运行 npm run build'));
      return;
    }

    console.log('[Electron] 启动服务器，端口: ' + PORT);

    let serverLog = '';
    let started = false;

    serverProcess = spawn('node', [serverEntry, 'serve'], {
      cwd: APP_PATH,
      env: { ...process.env, FH_WEB_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      const text = data.toString();
      serverLog += text;
      console.log('[Server] ' + text.trim());
    });

    serverProcess.stderr.on('data', (data) => {
      const text = data.toString();
      serverLog += text;
      console.error('[Server Error] ' + text.trim());
    });

    serverProcess.on('error', (err) => {
      if (!started) reject(new Error('启动服务器失败: ' + err.message));
    });

    serverProcess.on('exit', (code) => {
      console.log('[Electron] 服务器退出，代码: ' + code);
      serverProcess = null;
      if (!started) {
        reject(new Error('服务器启动失败，退出代码: ' + code + '\n\n日志:\n' + serverLog.slice(-2000)));
      }
    });

    // 等待服务器就绪
    waitForServer(PORT, 60000).then(() => {
      started = true;
      console.log('[Electron] 服务器已就绪');
      resolve();
    }).catch((err) => {
      if (!started) reject(new Error(err.message + '\n\n服务器日志:\n' + serverLog.slice(-2000)));
    });
  });
}

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: '飞虹 Code',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false,
    backgroundColor: '#1a1a2e'
  });

  const url = `http://127.0.0.1:${PORT}/`;
  console.log('[Electron] 加载页面: ' + url);
  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 关闭时最小化到托盘
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 创建系统托盘
 */
function createTray() {
  try {
    const iconPath = join(__dirname, 'icon.png');
    let trayIcon;
    if (existsSync(iconPath)) {
      trayIcon = require('electron').nativeImage.createFromPath(iconPath);
    } else {
      trayIcon = require('electron').nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('飞虹 Code');

    const isAutoLaunch = app.getLoginItemSettings().openAtLogin;

    const contextMenu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: '隐藏到托盘', click: () => { if (mainWindow) mainWindow.hide(); } },
      { type: 'separator' },
      { label: '新建任务', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('app:new-task'); } } },
      { label: '快速补全', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('app:quick-complete'); } } },
      { type: 'separator' },
      {
        label: '开机自启动',
        type: 'checkbox',
        checked: isAutoLaunch,
        click: (menuItem) => {
          app.setLoginItemSettings({ openAtLogin: menuItem.checked });
          console.log('[Electron] 开机自启动设置:', menuItem.checked);
        }
      },
      { label: '检查更新', click: () => { checkForUpdates(); } },
      { type: 'separator' },
      { label: '关于飞虹 Code', click: () => { showAboutDialog(); } },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) mainWindow.hide();
        else { mainWindow.show(); mainWindow.focus(); }
      }
    });

    // 双击托盘显示主窗口
    tray.on('double-click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  } catch (e) {
    console.warn('[Electron] 创建托盘失败: ' + e.message);
  }
}

/**
 * 创建应用菜单（关键：没有菜单会导致复制粘贴等快捷键失效）
 */
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '刷新', role: 'reload' },
        { label: '强制刷新', role: 'forceReload' },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        { label: '开发者工具', role: 'toggleDevTools' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于飞虹 Code', click: () => {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '关于飞虹 Code',
            message: '飞虹 Code v0.6.1',
            detail: '终端 AI 编程智能体\n晋江市飞虹智科技企业管理有限公司'
          });
        }}
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * 设置权限（麦克风、摄像头、屏幕捕获）
 */
function setupPermissions() {
  // 允许所有权限请求（语音输入、视频通话、截图等）
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('[Electron] 权限请求: ' + permission);
    // 允许所有权限
    callback(true);
  });

  // 屏幕捕获：自动选择主屏幕，不需要每次都请求权限
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    console.log('[Electron] 屏幕捕获请求，自动选择主屏幕');
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      if (sources.length > 0) {
        // 自动选择第一个屏幕（主屏幕）
        callback({ video: sources[0] });
      } else {
        callback({});
      }
    }).catch(err => {
      console.error('[Electron] 获取屏幕源失败:', err.message);
      callback({});
    });
  });
}

/**
 * 设置 IPC
 */
function setupIpc() {
  ipcMain.on('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window:maximize', () => { if (mainWindow) mainWindow.maximize(); });
  ipcMain.on('window:unmaximize', () => { if (mainWindow) mainWindow.unmaximize(); });
  ipcMain.on('window:close', () => { if (mainWindow) mainWindow.close(); });
  ipcMain.handle('window:isMaximized', () => mainWindow ? mainWindow.isMaximized() : false);

  ipcMain.on('app:quit', () => { app.isQuitting = true; app.quit(); });
  ipcMain.on('app:restart', () => { app.relaunch(); app.exit(0); });
  ipcMain.handle('app:getPath', (_, name) => { try { return app.getPath(name); } catch { return null; } });

  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));
  ipcMain.handle('shell:openPath', (_, path) => shell.openPath(path));

  ipcMain.handle('dialog:showOpen', (_, options) => dialog.showOpenDialog(mainWindow, options));
  ipcMain.handle('dialog:showSave', (_, options) => dialog.showSaveDialog(mainWindow, options));
  ipcMain.handle('dialog:showMessage', (_, options) => dialog.showMessageBox(mainWindow, options));

  ipcMain.handle('clipboard:writeText', (_, text) => { clipboard.writeText(text); return true; });
  ipcMain.handle('clipboard:readText', () => clipboard.readText());

  ipcMain.handle('notification:show', (_, { title, body }) => {
    if (Notification.isSupported()) { new Notification({ title, body }).show(); return true; }
    return false;
  });

  // 截图功能：截取主屏幕，返回 dataURL
  ipcMain.handle('screenshot:capture', async () => {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
      });
      const primarySource = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0];
      if (!primarySource) throw new Error('未找到屏幕源');
      return {
        success: true,
        dataUrl: primarySource.thumbnail.toDataURL(),
        width: width,
        height: height
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 全局快捷键
  ipcMain.handle('shortcuts:getAll', () => {
    return [
      { accelerator: 'Ctrl+Shift+Space', description: '显示/隐藏主窗口' },
      { accelerator: 'Ctrl+Shift+K', description: '新建任务' },
      { accelerator: 'Ctrl+Shift+L', description: '快速补全' },
    ];
  });

  // 开机自启
  ipcMain.handle('autolaunch:get', () => {
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('autolaunch:set', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return app.getLoginItemSettings().openAtLogin;
  });

  // 应用信息
  ipcMain.handle('app:info', () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      path: app.getAppPath(),
      userData: app.getPath('userData'),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    };
  });
}

/**
 * 注册全局快捷键
 */
function registerGlobalShortcuts() {
  try {
    // Ctrl+Shift+Space: 快速唤起飞虹 Code（显示/隐藏主窗口）
    const ret1 = globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (mainWindow) {
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    // Ctrl+Shift+K: 新建任务
    const ret2 = globalShortcut.register('CommandOrControl+Shift+K', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('app:new-task');
      }
    });

    // Ctrl+Shift+L: 快速补全
    const ret3 = globalShortcut.register('CommandOrControl+Shift+L', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('app:quick-complete');
      }
    });

    if (ret1 && ret2 && ret3) {
      console.log('[Electron] 全局快捷键注册成功');
    } else {
      console.warn('[Electron] 部分全局快捷键注册失败');
    }
  } catch (e) {
    console.warn('[Electron] 全局快捷键注册异常: ' + e.message);
  }
}

/**
 * 检查更新（简化版，实际应使用 electron-updater）
 */
function checkForUpdates() {
  console.log('[Electron] 检查更新...');
  // 简化版：显示当前版本，实际应使用 electron-updater
  const version = app.getVersion();
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '检查更新',
    message: `当前版本: v${version}`,
    detail: '飞虹 Code 会在有新版本时自动通知您。\n\n您也可以访问官网下载最新版本。',
    buttons: ['确定', '访问官网'],
    defaultId: 0,
    cancelId: 0
  }).then(({ response }) => {
    if (response === 1) {
      shell.openExternal('https://feihong-code.com');
    }
  });
}

/**
 * 显示关于对话框
 */
function showAboutDialog() {
  const version = app.getVersion();
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于飞虹 Code',
    message: `飞虹 Code v${version}`,
    detail: '终端 AI 编程智能体\n晋江市飞虹智科技企业管理有限公司\n飞扬企源研发中心 · 负责人：吴赐虹\n\n技术栈：TypeScript + Electron + Express\n核心能力：多模型路由、企业级 RBAC、全自动 SWE Agent',
    buttons: ['确定', '官方网站', 'GitHub'],
    defaultId: 0,
    cancelId: 0
  }).then(({ response }) => {
    if (response === 1) shell.openExternal('https://feihong-code.com');
    if (response === 2) shell.openExternal('https://github.com/feihong-code');
  });
}

/**
 * 设置深度链接（fhcode:// 协议）
 */
function setupDeepLink() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('fhcode', process.execPath, [resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('fhcode');
  }
  console.log('[Electron] 深度链接协议已注册: fhcode://');
}

/**
 * 处理深度链接 URL
 */
function handleDeepLink(url) {
  console.log('[Electron] 深度链接:', url);
  try {
    const parsed = new URL(url);
    const action = parsed.hostname;
    const params = Object.fromEntries(parsed.searchParams);

    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('app:deep-link', { action, params });
    }
  } catch (e) {
    console.error('[Electron] 深度链接解析失败:', e.message);
  }
}

// App 就绪
app.whenReady().then(async () => {
  console.log('[Electron] App 已就绪');
  console.log('[Electron] 应用路径: ' + APP_PATH);

  try {
    setupIpc();
    setupPermissions();
    setupDeepLink();
    createMenu();
    await startServer();
    createWindow();
    createTray();
    registerGlobalShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (err) {
    console.error('[Electron] 启动失败: ' + err.message);

    // 显示错误窗口
    const errorWin = new BrowserWindow({
      width: 700,
      height: 500,
      title: '启动失败',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    const errorHtml = `
      <html><body style="font-family:Microsoft YaHei,sans-serif;padding:30px;background:#1a1a2e;color:#fff;margin:0;">
        <h2 style="color:#ff6b6b;">飞虹 Code 启动失败</h2>
        <p style="color:#aaa;">错误详情：</p>
        <pre style="background:#0d1117;padding:15px;border-radius:8px;overflow:auto;white-space:pre-wrap;font-size:12px;max-height:300px;">${String(err.message).replace(/</g, '&lt;')}</pre>
        <p style="color:#888;margin-top:20px;">请检查：1) 是否已运行 npm run build  2) 端口 ${PORT} 是否被占用  3) Node.js 版本是否 >= 18</p>
        <p style="color:#666;margin-top:20px;font-size:12px;">关闭此窗口后退出</p>
      </body></html>
    `;
    errorWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
    errorWin.on('closed', () => app.quit());
  }
});

// 所有窗口关闭时不退出（保持托盘运行）
app.on('window-all-closed', () => {});

// 退出前注销全局快捷键并停止服务器
app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

// 处理深度链接（Windows/Linux）
app.on('second-instance', (event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  // 查找深度链接 URL
  const deepLink = commandLine.find(arg => arg.startsWith('fhcode://'));
  if (deepLink) handleDeepLink(deepLink);
});

// 处理深度链接（macOS）
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// 防止多开
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

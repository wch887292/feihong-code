/**
 * 飞虹 Code Electron 桌面版主进程（简化稳定版）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */

const { app, BrowserWindow, shell, Tray, Menu, ipcMain, dialog, clipboard, Notification, session, desktopCapturer, screen } = require('electron');
const { spawn } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const http = require('http');

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

    const contextMenu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) mainWindow.hide();
        else { mainWindow.show(); mainWindow.focus(); }
      }
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
}

// App 就绪
app.whenReady().then(async () => {
  console.log('[Electron] App 已就绪');
  console.log('[Electron] 应用路径: ' + APP_PATH);

  try {
    setupIpc();
    setupPermissions();
    createMenu();
    await startServer();
    createWindow();
    createTray();

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

// 退出前停止服务器
app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
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

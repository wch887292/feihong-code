/**
 * 飞虹 Code - 电脑操作路由（B2 拆分自 web/server.ts「电脑操作」区块）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 鼠标/键盘/截图/打开应用：用语言控制电脑（经 PowerShell 驱动 Windows）。
 * 无共享闭包依赖，仅注册到 app 上。
 */
import express from 'express';
import { spawn } from 'child_process';
import type { Request, Response } from 'express';

type ExpressApp = ReturnType<typeof express>;

/** 执行 PowerShell 命令的辅助函数（自然语言指令直达端点也复用） */
export const runPowerShell = (script: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => { stdout += d.toString(); });
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `PowerShell exited with code ${code}`));
    });
    ps.on('error', reject);
  });
};

// 应用名映射表（中文别名 → 可执行文件 / 协议 / 路径），覆盖高频场景
const APP_LAUNCH_MAP: Record<string, string> = {
  '微信': 'WeChat',
  'wechat': 'WeChat',
  '微信输入法': 'WeChatInput',
  'qq': 'QQ',
  'qq音乐': 'QQMusic',
  '腾讯会议': 'wemeetapp',
  '浏览器': 'msedge',
  'chrome': 'chrome',
  '谷歌浏览器': 'chrome',
  'edge': 'msedge',
  '火狐': 'firefox',
  '记事本': 'notepad',
  '计算器': 'calc',
  '画图': 'mspaint',
  '文件管理器': 'explorer',
  '资源管理器': 'explorer',
  '任务管理器': 'taskmgr',
  '控制面板': 'control',
  'cmd': 'cmd',
  '命令行': 'cmd',
  'powershell': 'powershell',
  'power shell': 'powershell',
  'vscode': 'code',
  'visual studio code': 'code',
  'vs code': 'code',
  'word': 'winword',
  'excel': 'excel',
  'powerpoint': 'powerpnt',
  'ppt': 'powerpnt',
  'outlook': 'outlook',
  'pycharm': 'pycharm',
  'intellij': 'idea64',
  'clion': 'clion64',
  'goland': 'goland64',
  'xshell': 'Xshell',
  '百度网盘': 'BaiduNetdisk',
  '网易云音乐': 'cloudmusic',
  'spotify': 'spotify',
  'steam': 'steam',
  '微信开发者工具': 'wechatdevtools',
  '企业微信': 'WXWork',
  '钉钉': 'DingTalk',
  '飞书': 'Feishu',
  'wps': 'wps',
};

export function registerComputerRoutes(app: ExpressApp): void {
  // 截图
  app.post('/api/computer/screenshot', async (_req: Request, res: Response) => {
    try {
      if (process.platform !== 'win32') {
        res.status(400).json({ ok: false, error: '仅支持 Windows 系统' });
        return;
      }
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $bounds = $screen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $ms = New-Object System.IO.MemoryStream
        $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        [Convert]::ToBase64String($bytes)
      `;
      const base64 = await runPowerShell(script);
      res.json({ ok: true, image: 'data:image/png;base64,' + base64, width: 1920, height: 1080 });
    } catch (e) {
      res.status(500).json({ ok: false, error: '截图失败: ' + (e as Error).message });
    }
  });

  // 移动鼠标
  app.post('/api/computer/mouse/move', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const x = parseInt(body?.x ?? '0');
      const y = parseInt(body?.y ?? '0');
      if (isNaN(x) || isNaN(y)) {
        res.status(400).json({ ok: false, error: '缺少 x 或 y 坐标' });
        return;
      }
      const script = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class MouseHelper {
            [DllImport("user32.dll")]
            public static extern bool SetCursorPos(int X, int Y);
        }
"@
        [MouseHelper]::SetCursorPos(${x}, ${y}) | Out-Null
        Write-Output "ok"
      `;
      await runPowerShell(script);
      res.json({ ok: true, x, y });
    } catch (e) {
      res.status(500).json({ ok: false, error: '移动鼠标失败: ' + (e as Error).message });
    }
  });

  // 点击鼠标
  app.post('/api/computer/mouse/click', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const button = (body?.button ?? 'left') as string;
      const x = body?.x !== undefined ? parseInt(body.x) : null;
      const y = body?.y !== undefined ? parseInt(body.y) : null;
      const doubleClick = body?.double === true;

      let clickFlag = '0x0002'; // left down
      let upFlag = '0x0004'; // left up
      if (button === 'right') {
        clickFlag = '0x0008';
        upFlag = '0x0010';
      }

      const movePart = (x !== null && y !== null) ? `[MouseHelper]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -Milliseconds 100;` : '';
      const clickPart = doubleClick
        ? `[MouseHelper]::mouse_event(${clickFlag}, 0, 0, 0, 0); [MouseHelper]::mouse_event(${upFlag}, 0, 0, 0, 0); Start-Sleep -Milliseconds 100; [MouseHelper]::mouse_event(${clickFlag}, 0, 0, 0, 0); [MouseHelper]::mouse_event(${upFlag}, 0, 0, 0, 0);`
        : `[MouseHelper]::mouse_event(${clickFlag}, 0, 0, 0, 0); [MouseHelper]::mouse_event(${upFlag}, 0, 0, 0, 0);`;

      const script = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class MouseHelper {
            [DllImport("user32.dll")]
            public static extern bool SetCursorPos(int X, int Y);
            [DllImport("user32.dll")]
            public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
        }
"@
        ${movePart}
        ${clickPart}
        Write-Output "ok"
      `;
      await runPowerShell(script);
      res.json({ ok: true, button, x, y, double: doubleClick });
    } catch (e) {
      res.status(500).json({ ok: false, error: '点击鼠标失败: ' + (e as Error).message });
    }
  });

  // 输入文字
  app.post('/api/computer/keyboard/type', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const text = (body?.text ?? '') as string;
      if (!text) {
        res.status(400).json({ ok: false, error: '缺少 text 字段' });
        return;
      }
      // SendKeys 需要转义特殊字符
      const escaped = text.replace(/([+^%~(){}])/g, '{$1}');
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
        Write-Output "ok"
      `;
      await runPowerShell(script);
      res.json({ ok: true, text });
    } catch (e) {
      res.status(500).json({ ok: false, error: '输入文字失败: ' + (e as Error).message });
    }
  });

  // 按键（快捷键）
  app.post('/api/computer/keyboard/press', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const key = (body?.key ?? '') as string;
      if (!key) {
        res.status(400).json({ ok: false, error: '缺少 key 字段' });
        return;
      }
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('${key.replace(/'/g, "''")}')
        Write-Output "ok"
      `;
      await runPowerShell(script);
      res.json({ ok: true, key });
    } catch (e) {
      res.status(500).json({ ok: false, error: '按键失败: ' + (e as Error).message });
    }
  });

  // 打开应用（F6 修复：严格白名单，仅允许 APP_LAUNCH_MAP 内已知应用名，禁止任意路径/URL/参数注入）
  app.post('/api/computer/app/open', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const name = String(body?.app ?? body?.name ?? '').trim();
      if (!name) {
        res.status(400).json({ ok: false, error: '缺少 app 字段（应用名，如：微信 / chrome / notepad）' });
        return;
      }
      // 仅允许白名单内的应用名（中文别名或英文键），拒绝一切白名单外输入（含路径/URL/参数）
      const target = APP_LAUNCH_MAP[name.toLowerCase()] ?? APP_LAUNCH_MAP[name];
      if (!target) {
        res.status(400).json({ ok: false, error: '应用不在允许列表内，已拒绝启动: ' + name });
        return;
      }
      // 二次净化：白名单目标不得含路径分隔符、冒号、引号或 .exe 后缀（防绕过）
      if (/[\\/:"]/.test(target) || /\.exe$/i.test(target)) {
        res.status(400).json({ ok: false, error: '非法启动目标，已拒绝' });
        return;
      }
      const script = `
        try { Start-Process '${target.replace(/'/g, "''")}' -ErrorAction Stop } catch { throw "应用未找到: ${target}" }
        Write-Output "opened:${target}"
      `;
      const out = await runPowerShell(script);
      res.json({ ok: true, app: name, resolved: target, message: out || `已尝试打开 ${name}` });
    } catch (e) {
      res.status(500).json({ ok: false, error: '打开应用失败: ' + (e as Error).message });
    }
  });
  // 列出常用应用映射（供手机端展示可选应用胶囊）
  app.get('/api/computer/apps', (_req: Request, res: Response) => {
    const apps = Object.keys(APP_LAUNCH_MAP)
      .filter((k) => k === k.toLowerCase() || /[\u4e00-\u9fa5]/.test(k))
      .filter((k, i, arr) => arr.indexOf(k) === i)
      .slice(0, 40);
    res.json({ ok: true, apps });
  });
}

/**
 * 飞虹 Code - 文件与本地操作域路由（B3-c 拆分自 web/server.ts）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 包含区块（原 649-760 / 783-852 / 857-1002）：
 * - 工作区与文件浏览（/api/workspace*）
 * - 打开本地文件夹/浏览器（/api/open/*）
 * - 上传文件/图片（/api/upload）
 * - 系统截图（/api/screenshot）
 * - 自然语言指令直达（/api/computer/nl）
 *
 * 共享闭包经 FilesystemDeps 注入；serverWorkspaceDir 为可变绑定，以 getter/setter 注入保活。
 * 本模块不得反向 import web/server。
 */
import express, { type Request, type Response } from 'express';
import { exec, spawn } from 'child_process';
import { existsSync, statSync, readdirSync, lstatSync, mkdirSync, renameSync, writeFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { runPowerShell } from './computer';

type ExpressApp = ReturnType<typeof express>;

export interface FilesystemDeps {
  homeDir: string;
  /** 当前 Web 控制台工作区（可变绑定的只读快照） */
  getServerWorkspaceDir: () => string;
  /** 写回当前 Web 控制台工作区（POST /api/workspace 修改） */
  setServerWorkspaceDir: (dir: string) => void;
  assertPathAllowed: (target: string, res: Response) => boolean;
}

export function registerFilesystemRoutes(app: ExpressApp, deps: FilesystemDeps): void {
  const { homeDir, getServerWorkspaceDir, setServerWorkspaceDir, assertPathAllowed } = deps;

  /* ========== 工作区与文件浏览 ========== */
  app.get('/api/workspace', (_req: Request, res: Response) => {
    res.json({ ok: true, cwd: getServerWorkspaceDir() });
  });
  app.post('/api/workspace', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const cwd = typeof body?.cwd === 'string' ? body.cwd.trim() : '';
    if (!cwd) {
      res.status(400).json({ ok: false, error: '缺少 cwd 字段' });
      return;
    }
    const resolved = resolve(cwd);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      res.status(400).json({ ok: false, error: '目录不存在' });
      return;
    }
    setServerWorkspaceDir(resolved);
    res.json({ ok: true, cwd: getServerWorkspaceDir() });
  });

  app.get('/api/workspace/list', (req: Request, res: Response) => {
    const raw = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    // path 为空 / '.' 时回落到服务端工作区，避免 resolve('.') 指向进程 cwd 造成困惑
    const rawPath = !raw || raw === '.' ? getServerWorkspaceDir() : raw;
    const dir = resolve(rawPath);
    if (!assertPathAllowed(dir, res)) return;
    try {
      // withFileTypes 失败时（部分网络盘/权限目录）退回普通 readdir
      const names = readdirSync(dir);
      const entries = names
        .map((name) => {
          const full = join(dir, name);
          try {
            const st = lstatSync(full);
            return {
              name,
              path: full,
              type: st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other',
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      res.json({ ok: true, cwd: dir, entries });
    } catch (e) {
      res.status(500).json({ ok: false, error: '读取目录失败: ' + (e as Error).message });
    }
  });

  // 新建文件夹
  app.post('/api/workspace/mkdir', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const parent = typeof body?.parent === 'string' ? body.parent.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!parent || !name) {
      res.status(400).json({ ok: false, error: '缺少 parent 或 name 字段' });
      return;
    }
    // 文件夹名安全校验：禁止路径分隔符和特殊字符
    if (/[\\/:*?"<>|]/.test(name)) {
      res.status(400).json({ ok: false, error: '文件夹名包含非法字符' });
      return;
    }
    const parentDir = resolve(parent);
    if (!assertPathAllowed(parentDir, res)) return;
    const newDir = join(parentDir, name);
    try {
      if (existsSync(newDir)) {
        res.status(409).json({ ok: false, error: '文件夹已存在' });
        return;
      }
      mkdirSync(newDir, { recursive: true });
      res.json({ ok: true, path: newDir });
    } catch (e) {
      res.status(500).json({ ok: false, error: '创建文件夹失败: ' + (e as Error).message });
    }
  });

  // 重命名文件夹
  app.post('/api/workspace/rename', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const newName = typeof body?.newName === 'string' ? body.newName.trim() : '';
    if (!path || !newName) {
      res.status(400).json({ ok: false, error: '缺少 path 或 newName 字段' });
      return;
    }
    if (/[\\/:*?"<>|]/.test(newName)) {
      res.status(400).json({ ok: false, error: '文件夹名包含非法字符' });
      return;
    }
    const oldPath = resolve(path);
    if (!assertPathAllowed(oldPath, res)) return;
    if (!existsSync(oldPath) || !statSync(oldPath).isDirectory()) {
      res.status(400).json({ ok: false, error: '目标不是文件夹或不存在' });
      return;
    }
    const parentDir = dirname(oldPath);
    const newPath = join(parentDir, newName);
    try {
      if (existsSync(newPath)) {
        res.status(409).json({ ok: false, error: '同名文件夹已存在' });
        return;
      }
      renameSync(oldPath, newPath);
      res.json({ ok: true, path: newPath });
    } catch (e) {
      res.status(500).json({ ok: false, error: '重命名失败: ' + (e as Error).message });
    }
  });

  /* ========== 打开本地文件夹/浏览器 ========== */
  app.post('/api/open/folder', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const dir = typeof body?.path === 'string' ? body.path.trim() : getServerWorkspaceDir();
    if (!dir || !assertPathAllowed(dir, res)) return;
    try {
      openFolder(dir);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: '打开失败: ' + (e as Error).message });
    }
  });

  app.post('/api/open/browser', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      res.status(400).json({ ok: false, error: '缺少 url 字段' });
      return;
    }
    try {
      openBrowser(url);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: '打开失败: ' + (e as Error).message });
    }
  });

  /* ========== 上传文件/图片 ========== */
  const uploadsDir = () => join(homeDir, 'uploads');
  app.post('/api/upload', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const mime = typeof body?.mime === 'string' ? body.mime.trim() : 'application/octet-stream';
    const data = typeof body?.dataBase64 === 'string' ? body.dataBase64.trim() : '';
    if (!name || !data) {
      res.status(400).json({ ok: false, error: '缺少 name 或 dataBase64 字段' });
      return;
    }
    try {
      mkdirSync(uploadsDir(), { recursive: true });
      const safeName = name.replace(/[^a-zA-Z0-9_.\-]/g, '_');
      const dest = join(uploadsDir(), `${Date.now()}_${safeName}`);
      writeFileSync(dest, Buffer.from(data, 'base64'));
      res.json({ ok: true, path: dest, name, mime });
    } catch (e) {
      res.status(500).json({ ok: false, error: '上传失败: ' + (e as Error).message });
    }
  });

  /* ========== 系统截图（调用 Windows 截图工具，不弹浏览器分享框） ========== */
  app.post('/api/screenshot', (_req: Request, res: Response) => {
    try {
      // Windows 10/11 内置截图工具（和 Win+Shift+S 效果一样）
      // 调用后直接进入截图模式，用户截图后图片保存到剪贴板
      if (process.platform === 'win32') {
        exec('explorer.exe ms-screenclip:', (err: Error | null) => {
          if (err) {
            res.status(500).json({ ok: false, error: '启动截图工具失败: ' + err.message });
          } else {
            res.json({ ok: true, message: '截图工具已启动，截图后按 Ctrl+V 粘贴到输入框' });
          }
        });
      } else {
        res.status(400).json({ ok: false, error: '仅支持 Windows 系统' });
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: '启动截图工具失败: ' + (e as Error).message });
    }
  });

  // ========== 自然语言指令直达（手机对话发指令 → 电脑端执行） ==========
  // 解析规则：打开/启动/运行 X → app/open；截图/截屏 → screenshot；
  // 输入 X → keyboard/type；按 X/按键 X → keyboard/press；点击/单击 → mouse/click；其余尝试作为命令执行
  function parseNaturalCommand(text: string): { action: string; params: Record<string, any> } | null {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const lower = t.toLowerCase();
    // 打开类
    const openMatch = /^(打开|启动|运行|开启|帮我打开|帮我启动|帮我运行|open|launch|start|run)\s*[:：]?\s*(.+)$/.exec(t);
    if (openMatch) {
      return { action: 'app/open', params: { app: openMatch[2].trim() } };
    }
    // 截图类
    if (/^(截图|截屏|屏幕截图|screenshot|screen\s*shot|capture)\s*$/.test(lower)) {
      return { action: 'screenshot', params: {} };
    }
    // 输入类
    const typeMatch = /^(输入|键入|打上|type)\s*[:：]?\s*(.+)$/.exec(t);
    if (typeMatch) {
      return { action: 'keyboard/type', params: { text: typeMatch[2].trim() } };
    }
    // 按键类
    const keyMatch = /^(按下|按|按键|press)\s*[:：]?\s*(.+)$/.exec(t);
    if (keyMatch) {
      return { action: 'keyboard/press', params: { key: keyMatch[2].trim() } };
    }
    // 点击类（含坐标）
    const clickMatch = /^(点击|单击|点一下|click)\s*[:：]?\s*(?:\((\d+)[,，\s]+(\d+)\))?\s*$/i.exec(t);
    if (clickMatch) {
      const params: Record<string, any> = {};
      if (clickMatch[2] && clickMatch[3]) {
        params.x = parseInt(clickMatch[2], 10);
        params.y = parseInt(clickMatch[3], 10);
      }
      return { action: 'mouse/click', params };
    }
    // 兜底：视为要执行的命令/打开项（如 "chrome"、"D:\x\a.exe"）
    return { action: 'app/open', params: { app: t } };
  }
  // 自然语言指令直达：POST /api/computer/nl  body: { text: '打开微信' }
  app.post('/api/computer/nl', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const text = String(body?.text ?? '').trim();
      if (!text) {
        res.status(400).json({ ok: false, error: '缺少 text 字段（自然语言指令，如：打开微信）' });
        return;
      }
      const parsed = parseNaturalCommand(text);
      if (!parsed) {
        res.status(400).json({ ok: false, error: '无法解析指令，请换一种说法（如：打开微信 / 截图 / 输入你好）' });
        return;
      }
      // 根据解析结果分发到对应 computer API 执行
      let result: Record<string, any>;
      switch (parsed.action) {
        case 'app/open': {
          const script = `
            $t = '${String(parsed.params.app ?? '').replace(/'/g, "''")}'
            if ($t -match '^https?://' -or $t -match '^shell:') { Start-Process $t }
            elseif (Test-Path $t) { Start-Process $t }
            else {
              try { Start-Process $t -ErrorAction Stop } catch {
                $found = (where.exe $t 2>$null | Select-Object -First 1)
                if ($found) { Start-Process $found } else { throw "应用未找到: $t" }
              }
            }
            Write-Output "ok:$t"
          `;
          const out = await runPowerShell(script);
          result = { ok: true, action: 'app/open', app: parsed.params.app, message: out || `已执行：${text}` };
          break;
        }
        case 'screenshot': {
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
          result = { ok: true, action: 'screenshot', image: 'data:image/png;base64,' + base64, width: 1920, height: 1080 };
          break;
        }
        case 'keyboard/type': {
          const textToType = String(parsed.params.text ?? '');
          const escaped = textToType.replace(/([+^%~(){}])/g, '{$1}');
          const script = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
            Write-Output "ok"
          `;
          await runPowerShell(script);
          result = { ok: true, action: 'keyboard/type', text: textToType };
          break;
        }
        case 'keyboard/press': {
          const key = String(parsed.params.key ?? '');
          const script = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('${key.replace(/'/g, "''")}')
            Write-Output "ok"
          `;
          await runPowerShell(script);
          result = { ok: true, action: 'keyboard/press', key };
          break;
        }
        case 'mouse/click': {
          const x = parsed.params.x;
          const y = parsed.params.y;
          const movePart = (x !== undefined && y !== undefined) ? `[MouseHelper]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -Milliseconds 100;` : '';
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
            [MouseHelper]::mouse_event(0x0002, 0, 0, 0, 0)
            [MouseHelper]::mouse_event(0x0004, 0, 0, 0, 0)
            Write-Output "ok"
          `;
          await runPowerShell(script);
          result = { ok: true, action: 'mouse/click', x: x ?? null, y: y ?? null };
          break;
        }
        default:
          result = { ok: false, error: '未知动作' };
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: '指令执行失败: ' + (e as Error).message });
    }
  });
}

/** 使用系统默认程序打开本地文件夹 */
function openFolder(dir: string): void {
  if (process.platform === 'win32') {
    spawn('explorer', [dir], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** 使用系统默认浏览器打开 URL */
function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

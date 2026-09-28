/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 电脑控制 + 云桥接命令（CLI）
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { createHmac } from 'crypto';
import { Agent as HttpsAgent } from 'https';
import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, type Dirent } from 'fs';
import { homedir, platform, release, arch, uptime, totalmem, freemem, cpus } from 'os';
import { join, dirname, sep } from 'path';

const COMPUTER_APP_MAP: Record<string, string> = {
  '微信': 'WeChat',
  wechat: 'WeChat',
  qq: 'QQ',
  '腾讯会议': 'wemeetapp',
  '浏览器': 'msedge',
  chrome: 'chrome',
  edge: 'msedge',
  '记事本': 'notepad',
  '计算器': 'calc',
  '画图': 'mspaint',
  '文件管理器': 'explorer',
  '资源管理器': 'explorer',
  '任务管理器': 'taskmgr',
  cmd: 'cmd',
  '命令行': 'cmd',
  powershell: 'powershell',
  vscode: 'code',
  word: 'winword',
  excel: 'excel',
  powerpnt: 'powerpnt',
  ppt: 'powerpnt',
  outlook: 'outlook',
  '企业微信': 'WXWork',
  '钉钉': 'DingTalk',
  '飞书': 'Feishu',
};

function computerPowerShell(script: string): Promise<string> {
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
}

function computerPrintHelp(): void {
  console.log(`fhcode computer — 命令行直接控制电脑（Windows）
用法:
  fhcode computer open <应用名|路径|URL>   打开应用（如: fhcode computer open 微信）
  fhcode computer apps                      列出内置应用别名
  fhcode computer screenshot                截取当前屏幕（base64 PNG 输出到终端）
  fhcode computer click [x y]               点击鼠标（可选坐标，如: click 500 400）
  fhcode computer type "<文字>"              在焦点窗口输入文字
  fhcode computer press <键>                 发送按键/快捷键（如: press enter / ctrl+s）
  fhcode computer nl "<自然语言指令>"         自然语言直达（如: nl 打开微信）
  fhcode computer status                    检查 PowerShell 可用性`);
}

/** fhcode computer：命令行直接控制电脑（复用 Web 端同一套 PowerShell 驱动） */
export async function runComputer(action: string, args: string[]): Promise<void> {
  switch (action) {
    case 'help':
    case '-h':
    case '--help':
      computerPrintHelp();
      return;

    case 'open': {
      const target = args.join(' ').trim();
      if (!target) { console.error('缺少应用名：fhcode computer open <应用名|路径|URL>'); process.exitCode = 1; return; }
      const alias = COMPUTER_APP_MAP[target.toLowerCase()] ?? COMPUTER_APP_MAP[target];
      const resolved = alias ?? target;
      const script = `
        $t = '${resolved.replace(/'/g, "''")}'
        if ($t -match '^https?://' -or $t -match '^shell:') { Start-Process $t }
        elseif (Test-Path $t) { Start-Process $t }
        else {
          try { Start-Process $t -ErrorAction Stop } catch {
            $found = (where.exe $t 2>$null | Select-Object -First 1)
            if ($found) { Start-Process $found } else { throw "应用未找到: $t" }
          }
        }
        Write-Output "opened:$t"
      `;
      try {
        const out = await computerPowerShell(script);
        console.log(out || `已尝试打开 ${target}`);
      } catch (e) {
        console.error('打开应用失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'apps': {
      console.log('内置应用别名:');
      const seen = new Set<string>();
      for (const [k, v] of Object.entries(COMPUTER_APP_MAP)) {
        if (seen.has(v)) continue;
        seen.add(v);
        console.log(`  ${k} → ${v}`);
      }
      return;
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
      try {
        const base64 = await computerPowerShell(script);
        console.log('截图已生成（data:image/png;base64,...）长度: ' + base64.length + ' 字符');
        // 不直接打印 base64 到终端（过长），提示可用 Web 端 /api/computer/screenshot 查看
      } catch (e) {
        console.error('截图失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'click': {
      const x = args[0] ? parseInt(args[0], 10) : null;
      const y = args[1] ? parseInt(args[1], 10) : null;
      const movePart = (x !== null && y !== null) ? `[MouseHelper]::SetCursorPos(${x}, ${y}) | Out-Null; Start-Sleep -Milliseconds 100;` : '';
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
      try {
        await computerPowerShell(script);
        console.log(`已点击鼠标${x !== null && y !== null ? ` 坐标(${x}, ${y})` : '（当前光标位置）'}`);
      } catch (e) {
        console.error('点击失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'type': {
      const text = args.join(' ').trim();
      if (!text) { console.error('缺少文字：fhcode computer type "<文字>"'); process.exitCode = 1; return; }
      const escaped = text.replace(/([+^%~(){}])/g, '{$1}');
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
        Write-Output "ok"
      `;
      try {
        await computerPowerShell(script);
        console.log('已输入: ' + text);
      } catch (e) {
        console.error('输入失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'press': {
      const key = args.join(' ').trim();
      if (!key) { console.error('缺少按键：fhcode computer press <键>（如 enter / ctrl+s）'); process.exitCode = 1; return; }
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('${key.replace(/'/g, "''")}')
        Write-Output "ok"
      `;
      try {
        await computerPowerShell(script);
        console.log('已按键: ' + key);
      } catch (e) {
        console.error('按键失败: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    case 'nl': {
      const text = args.join(' ').trim();
      if (!text) { console.error('缺少指令：fhcode computer nl "<自然语言指令>"（如: nl 打开微信）'); process.exitCode = 1; return; }
      // 自然语言 → 动作：打开/启动/运行 X / 截图 / 输入 X / 按 X / 点击
      const openMatch = /^(打开|启动|运行|开启|open|launch|start|run)\s*[:：]?\s*(.+)$/i.exec(text);
      const isShot = /^(截图|截屏|screenshot)$/i.test(text.trim());
      const typeMatch = /^(输入|键入|type)\s*[:：]?\s*(.+)$/i.exec(text);
      const keyMatch = /^(按下|按|按键|press)\s*[:：]?\s*(.+)$/i.exec(text);
      if (openMatch) {
        await runComputer('open', [openMatch[2].trim()]);
      } else if (isShot) {
        await runComputer('screenshot', []);
      } else if (typeMatch) {
        await runComputer('type', [typeMatch[2].trim()]);
      } else if (keyMatch) {
        await runComputer('press', [keyMatch[2].trim()]);
      } else {
        // 兜底：视为打开项（应用名/路径/URL）
        await runComputer('open', [text]);
      }
      return;
    }

    case 'status': {
      try {
        const out = await computerPowerShell('Write-Output "powershell-ok"');
        console.log(out === 'powershell-ok' ? '✅ PowerShell 可用，电脑控制通道正常' : '⚠️ 异常响应: ' + out);
      } catch (e) {
        console.error('❌ PowerShell 不可用: ' + (e instanceof Error ? e.message : String(e)));
        process.exitCode = 1;
      }
      return;
    }

    default:
      console.error('未知子命令: ' + action);
      computerPrintHelp();
      process.exitCode = 1;
  }
}

/* ===================== 云桥接代理（fhcode bridge）：电脑端连云端，拉指令→执行→回传 ===================== */

/** 生成稳定的设备 ID：首次运行生成并存盘，之后复用（同一台电脑固定一个 ID） */
function getBridgeDeviceId(): string {
  const idFile = join(homedir(), '.feihong-code', 'bridge-device-id');
  try {
    if (existsSync(idFile)) {
      const saved = readFileSync(idFile, 'utf-8').trim();
      if (saved) return saved;
    }
    const id = 'pc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    mkdirSync(dirname(idFile), { recursive: true });
    writeFileSync(idFile, id, 'utf-8');
    return id;
  } catch (e) {
    return 'pc-' + Date.now().toString(36);
  }
}

interface BridgeResp {
  ok?: boolean;
  command?: { cmdId: string; text: string } | null;
  devices?: Array<{ deviceId: string; name: string; status: string }>;
  error?: string;
  [k: string]: unknown;
}

let _insecureAgent: HttpsAgent | undefined;
function bridgeInsecureAgent(): HttpsAgent | undefined {
  if (!_insecureAgent) _insecureAgent = new HttpsAgent({ rejectUnauthorized: false });
  return _insecureAgent;
}

async function bridgeFetch(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; signSecret?: string } = {}): Promise<BridgeResp> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const bodyRaw = opts.body !== undefined ? JSON.stringify(opts.body) : '';
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  // 请求签名（第二层安全：防重放）。签名密钥与云端 FH_SIGN_SECRET 一致（默认 = FH_WEB_TOKEN）
  const signSecret = opts.signSecret || process.env.FH_BRIDGE_SIGN_SECRET || opts.headers?.Authorization?.replace(/^Bearer\s+/i, '') || '';
  if (signSecret) {
    const timestamp = String(Date.now());
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const sig = createHmac('sha256', signSecret).update(`${timestamp}|${nonce}|${bodyRaw}`).digest('hex');
    headers['x-fh-ts'] = timestamp;
    headers['x-fh-nonce'] = nonce;
    headers['x-fh-sig'] = sig;
  }
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? bodyRaw : undefined,
    // 内网/测试环境可跳过证书校验（生产默认安全，勿开启）
    ...(process.env.FH_BRIDGE_INSECURE === '1' ? { agent: bridgeInsecureAgent() } : {}),
  });
  if (!res.ok) throw new Error(`云端返回 HTTP ${res.status}`);
  return (await res.json()) as BridgeResp;
}

/**
 * fhcode bridge — 电脑端桥接代理（手机 → 云端 → 电脑端执行的关键一跳）
 *
 * 电脑端运行本命令后：注册设备 → 长轮询云端待执行指令 → 用 runComputer 在本机执行 → 回传结果。
 * 手机端把自然语言指令 POST 到云端 /api/bridge/command，即可远程操作这台电脑。
 *
 * 配置：
 *   FH_BRIDGE_URL   云端地址（默认 http://127.0.0.1:18080，腾讯云部署后填 https://api.klai.top）
 *   FH_BRIDGE_TOKEN 云端 FH_WEB_TOKEN
 *   FH_BRIDGE_NAME  设备显示名（默认「本机-<主机名>」）
 */
export async function runBridge(action: string, _args: string[]): Promise<void> {
  const cloudBase = (process.env.FH_BRIDGE_URL || 'http://127.0.0.1:18080').replace(/\/+$/, '');
  const token = process.env.FH_BRIDGE_TOKEN || '';
  const deviceId = getBridgeDeviceId();
  const hostname = process.env.COMPUTERNAME || process.env.HOSTNAME || 'PC';
  const deviceName = process.env.FH_BRIDGE_NAME || `本机-${hostname}`;
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  function log(msg: string): void {
    console.log(`[bridge ${new Date().toISOString()}] ${msg}`);
  }

  if (action === 'id') {
    console.log(deviceId);
    return;
  }

  if (action === 'devices') {
    try {
      const data = await bridgeFetch(`${cloudBase}/api/bridge/devices`, { headers: authHeaders });
      console.log(JSON.stringify(data.devices ?? [], null, 2));
    } catch (e) {
      console.error('查询设备失败: ' + (e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
    }
    return;
  }

  if (action === 'status') {
    console.log(`云端: ${cloudBase}`);
    console.log(`设备ID: ${deviceId}`);
    console.log(`设备名: ${deviceName}`);
    console.log(`鉴权: ${token ? '已配置' : '未配置（FH_BRIDGE_TOKEN）'}`);
    try {
      await bridgeFetch(`${cloudBase}/api/bridge/register`, {
        method: 'POST',
        headers: authHeaders,
        body: { deviceId, name: deviceName },
      });
      console.log('✅ 已注册到云端');
    } catch (e) {
      console.error('❌ 无法连接云端: ' + (e instanceof Error ? e.message : String(e)));
      process.exitCode = 1;
    }
    return;
  }

  if (action !== 'start' && action !== 'run' && action !== '') {
    console.error(`未知子命令: ${action}（支持: start / status / id / devices）`);
    process.exitCode = 1;
    return;
  }

  // 注册设备
  try {
    await bridgeFetch(`${cloudBase}/api/bridge/register`, {
      method: 'POST',
      headers: authHeaders,
      body: { deviceId, name: deviceName },
    });
    log(`设备已注册: ${deviceName} (${deviceId})`);
  } catch (e) {
    console.error('❌ 注册失败，请检查 FH_BRIDGE_URL / FH_BRIDGE_TOKEN: ' + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
    return;
  }

  log('桥接代理启动，长轮询云端指令中（Ctrl+C 停止）…');
  let running = true;
  const stop = (): void => { running = false; process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // ===== 本地执行器增强：文件/命令/网页/系统状态（与云端执行体 cloud-agent 指令能力对齐） =====
  const LOCAL_WORK = join(homedir(), 'fhcode-cloud-work');
  const BLOCKED_CMDS = [
    /(^|\s)(rm|rmdir)\s+-[a-z]*[rf][a-z]*\s*(\/\s*|\/\*)/i,
    /(^|\s)mkfs/i, /(^|\s)dd\s+if=/i, /(^|\s)shutdown/i,
    /(^|\s)reboot/i, /(^|\s)halt/i, /(^|\s)poweroff/i,
    /(^|\s)init\s+[06]/i, /(^|\s)killall\s/i, /(^|\s)pkill\s/i,
    /(^|\s)chmod\s+-R\s+777\s+\//i, /(^|\s)chown\s+-R/i,
    /(^|\s):\(\)/i, /(^|\s)wget\s+.*\|\s*sh/i, /(^|\s)curl\s+.*\|\s*(ba)?sh/i,
    /(^|\s)systemctl\s+(stop|disable)\s+(docker|nginx|mysql|php|redis)/i,
  ];
  function safeLocalResolve(rel: string): string {
    const abs = join(LOCAL_WORK, rel);
    if (abs !== LOCAL_WORK && !abs.startsWith(LOCAL_WORK + sep)) throw new Error('路径越界：只允许操作本地工作目录 ' + LOCAL_WORK);
    return abs;
  }
  function runLocalCmd(cmdline: string, timeoutMs = 30000): Promise<string> {
    return new Promise((res, rej) => {
      if (!cmdline.trim()) { rej(new Error('空命令')); return; }
      if (BLOCKED_CMDS.some((re) => re.test(cmdline))) { rej(new Error('指令包含危险操作，已拒绝执行')); return; }
      const isWin = platform() === 'win32';
      execFile(isWin ? 'cmd' : 'bash', isWin ? ['/d', '/s', '/c', cmdline] : ['-c', cmdline],
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, cwd: LOCAL_WORK, env: { ...process.env } },
        (err, stdout, stderr) => {
          if (err) { rej(new Error((stderr || stdout || err.message || '').toString().trim().slice(0, 1000) || '命令执行失败')); return; }
          res(stdout.toString().trim());
        });
    });
  }
  /** 云端式指令解析：命中返回执行结果，未命中返回 null（回退 GUI 操作） */
  async function tryLocalExec(text: string): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string } | null> {
    const t = text.trim();
    const MAX = 8000;
    // 1) 创建/写入文件、新建目录
    let m = /^(?:创建|新建|写|写入|生成)(文件|脚本|目录)\s*[:：]?\s*(.+?)(?:\s+(?:内容|内容为|写入内容)\s*[:：]?\s*(.+))?$/i.exec(t);
    if (m) {
      const kind = m[1].toLowerCase();
      const target = m[2].trim();
      const content = (m[3] ?? '').replace(/^['"`]|['"`]$/g, '');
      if (kind === '目录') {
        const dir = safeLocalResolve(target);
        mkdirSync(dir, { recursive: true });
        return { ok: true, result: { action: 'mkdir', path: dir, text: '已创建目录: ' + dir } };
      }
      const file = safeLocalResolve(target);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, 'utf8');
      return { ok: true, result: { action: 'write', path: file, bytes: Buffer.byteLength(content), text: `已写入 ${file}（${Buffer.byteLength(content)} 字节）` } };
    }
    // 2) 读取文件
    m = /^(?:读取|查看|打开|显示|cat)(文件|脚本)\s*[:：]?\s*(.+)$/i.exec(t);
    if (m) {
      const file = safeLocalResolve(m[2].trim());
      if (!existsSync(file)) return { ok: false, error: '文件不存在: ' + file };
      const content = readFileSync(file, 'utf8');
      return { ok: true, result: { action: 'read', path: file, text: content.length > MAX ? content.slice(0, MAX) + '\n…(截断)' : content } };
    }
    // 3) 列出目录
    m = /^(?:列出|查看|浏览)(目录|文件夹)\s*[:：]?\s*(.*)$/i.exec(t);
    if (m || /^(ls|dir)\b/i.test(t)) {
      const rel = m ? ((m[2] || '').trim() || '.') : ((t.replace(/^(ls|dir)\b/i, '').trim()) || '.');
      const dir = safeLocalResolve(rel);
      if (!existsSync(dir)) return { ok: false, error: '目录不存在: ' + dir };
      const entries = readdirSync(dir, { withFileTypes: true }).map((e) => (e.isDirectory() ? '📁 ' : '📄 ') + e.name + (e.isDirectory() ? '/' : ''));
      return { ok: true, result: { action: 'ls', path: dir, text: entries.length ? entries.join('\n') : '（空目录）' } };
    }
    // 4) 执行命令/脚本
    m = /^(?:执行|运行)(命令|脚本|shell|bash|sh|python|python3|node|npm|pip|git)\s*[:：]?\s*(.+)$/i.exec(t);
    if (m) {
      const runner = m[1].toLowerCase();
      let cmdline = m[2].trim();
      if (runner === 'python' || runner === 'python3') cmdline = 'python ' + cmdline;
      else if (runner === 'node') cmdline = 'node ' + cmdline;
      else if (runner === 'npm') cmdline = 'npm ' + cmdline;
      else if (runner === 'pip') cmdline = 'pip ' + cmdline;
      else if (runner === 'git') cmdline = 'git ' + cmdline;
      const out = await runLocalCmd(cmdline);
      return { ok: true, result: { action: 'exec', command: cmdline, text: out.slice(0, MAX) } };
    }
    // 5) 抓取网页（Node 原生 fetch）
    m = /^(?:抓取|下载|访问|fetch)(网页|页面|url)\s*[:：]?\s*(https?:\/\/\S+)$/i.exec(t);
    if (m) {
      try {
        const res = await fetch(m[2], { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'fhcode-local-bridge/1.0' } });
        const txt = (await res.text()).slice(0, MAX);
        return { ok: true, result: { action: 'fetch', url: m[2], status: res.status, text: txt || '（空响应）' } };
      } catch (e) {
        return { ok: false, error: '抓取失败: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }
    // 5.5) 屏幕截图（回传 base64 图片，手机端直接渲染）
    if (/^(截图|截屏|屏幕截图|screen\s*shot)/i.test(t)) {
      try {
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
        const base64 = (await computerPowerShell(script)).trim();
        if (!base64) return { ok: false, error: '截图失败：未获取到图像数据' };
        return { ok: true, result: { action: 'screenshot', image: 'data:image/png;base64,' + base64, text: '屏幕截图已生成（' + Math.round(base64.length / 1024) + ' KB）' } };
      } catch (e) {
        return { ok: false, error: '截图失败: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }
    // 5.6) 保存文件（手机端上传 base64 → 电脑保存）：保存文件 <路径> base64=<data>
    m = /^(?:保存|上传|接收)(文件)\s*[:：]?\s*(.+?)\s+(?:base64|data)\s*=\s*([A-Za-z0-9+/=]+)$/i.exec(t);
    if (m) {
      const file = safeLocalResolve(m[2].trim().replace(/^['"\`]|['"\`]$/g, ''));
      try {
        const buf = Buffer.from(m[3], 'base64');
        if (!buf.length) return { ok: false, error: 'base64 数据为空或无效' };
        if (buf.length > 8 * 1024 * 1024) return { ok: false, error: '文件过大（>8MB），请压缩后重试' };
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, buf);
        return { ok: true, result: { action: 'save-file', path: file, bytes: buf.length, text: '已保存 ' + file + '（' + buf.length + ' 字节）' } };
      } catch (e) {
        return { ok: false, error: '保存失败: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }
    // 5.7) 查看图片 / 读取图片（回传 base64，手机端直接渲染）
    m = /^(?:查看|读取|打开)(图片|照片|image|img)\s*[:：]?\s*(.+)$/i.exec(t);
    if (m) {
      const file = safeLocalResolve(m[2].trim().replace(/^['"\`]|['"\`]$/g, ''));
      if (!existsSync(file)) return { ok: false, error: '文件不存在: ' + file };
      try {
        const buf = readFileSync(file);
        const dot = file.lastIndexOf('.');
        const ext = (dot >= 0 ? file.slice(dot + 1) : '').toLowerCase();
        const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' } as Record<string, string>)[ext] || 'application/octet-stream';
        if (buf.length > 6 * 1024 * 1024) return { ok: false, error: '文件过大（>6MB），无法回传' };
        return { ok: true, result: { action: 'read-image', path: file, image: 'data:' + mime + ';base64,' + buf.toString('base64'), text: '文件已读取（' + Math.round(buf.length / 1024) + ' KB）' } };
      } catch (e) {
        return { ok: false, error: '读取失败: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }
    // 6) 系统状态
    if (/(系统状态|服务器状态|运行状态|内存|磁盘|磁盘空间|uptime|主机)/.test(t) && !/文件/.test(t)) {
      const gb = (n: number) => (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
      const lines = [
        '--- 主机 ---', `${hostname} | ${platform()} ${release()} | ${arch()}`,
        '--- 运行时间 ---', (uptime() / 3600).toFixed(2) + ' 小时',
        '--- 内存 ---', `总 ${gb(totalmem())} / 空闲 ${gb(freemem())} / 已用 ${gb(totalmem() - freemem())}`,
        '--- CPU ---', cpus().length + ' 核 @ ' + cpus()[0].model.trim(),
        '--- 工作目录 ---', LOCAL_WORK,
      ];
      return { ok: true, result: { action: 'sysinfo', text: lines.join('\n') } };
    }
    // 7) 搜索文件
    m = /^(?:搜索|查找|找)(文件|关键词|内容)\s*[:：]?\s*(.+)$/i.exec(t);
    if (m) {
      const kw = m[2].trim();
      const hits: string[] = [];
      (function walk(d: string): void {
        let ents: Dirent[];
        try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (hits.length >= 30) return;
          const p = join(d, e.name);
          if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); }
          else { try { if (readFileSync(p, 'utf8').includes(kw)) hits.push(p); } catch { /* 忽略 */ } }
        }
      })(LOCAL_WORK);
      return { ok: true, result: { action: 'grep', keyword: kw, text: hits.length ? hits.map((h) => h.replace(LOCAL_WORK + sep, '')).join('\n') : '（未找到匹配文件）' } };
    }
    return null;
  }

  // 指令→执行：优先云端式解析（文件/命令/网页/系统状态），未命中回退 runComputer 自然语言（GUI 操作）
  async function execute(text: string): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
    mkdirSync(LOCAL_WORK, { recursive: true });
    try {
      const local = await tryLocalExec(text);
      if (local) return local;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    try {
      await runComputer('nl', [text]);
      return { ok: true, result: { text, executed: true } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  while (running) {
    try {
      const data = await bridgeFetch(`${cloudBase}/api/bridge/pending?deviceId=${encodeURIComponent(deviceId)}`, {
        headers: authHeaders,
      });
      const cmd = data.command;
      if (cmd && cmd.cmdId) {
        log(`收到指令: ${cmd.text}`);
        const outcome = await execute(cmd.text);
        log(`执行完成: ${outcome.ok ? '成功' : '失败'}`);
        await bridgeFetch(`${cloudBase}/api/bridge/result`, {
          method: 'POST',
          headers: authHeaders,
          body: { cmdId: cmd.cmdId, deviceId, ok: outcome.ok, result: outcome.result, error: outcome.error },
        });
      }
      // 轮询间隔 3 秒；云端 18080 本地联调时可改短
      await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      log('轮询出错（' + (e instanceof Error ? e.message : String(e)) + '），5 秒后重试');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

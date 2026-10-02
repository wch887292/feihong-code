#!/usr/bin/env node
/**
 * 飞虹 Code · 浏览器 MCP 服务器（工具提供侧，stdio）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 作用：把本机 Microsoft Edge（Chromium 内核）的网页自动化能力作为 MCP 工具暴露给飞虹 Code。
 *       让智能体能够"打开网页 / 截图取证 / 取 HTML 文本 / 点击填充 / 执行 JS / 读控制台"，
 *       从而验证它改出来的前端效果，形成"改代码 → 跑起来 → 看效果 → 再修"的闭环。
 *
 * 依赖：puppeteer-core（仅 JS，无需下载浏览器；本机已有 Edge）。
 * 传输：MCP stdio（JSON-RPC 2.0, NDJSON），与飞虹 Code 的 McpClient 对齐（protocolVersion 2024-11-05）。
 *
 * 为什么是独立 stdio 服务器（而非桥+socket 两层）：
 *   浏览器自动化完全可在被 spawn 的子进程内完成（puppeteer 直接驱动 Edge），
 *   不像 VS Code 的 vscode.* API 只能在扩展宿主内跑，所以无需拆层。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

/** 依赖解析：优先本地，其次指向隔离的 WorkBuddy node 工作区 */
function req(name) {
  try { return require(name); } catch { /* fallthrough */ }
  return require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/' + name);
}

const puppeteer = req('puppeteer-core');

/** 定位本机 Microsoft Edge 可执行文件 */
function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* noop */ }
  }
  return null;
}

const EDGE_PATH = findEdge();
const FH_HOME = process.env.FH_HOME || path.join(os.homedir(), '.feihong-code');
const SHOT_DIR = path.join(FH_HOME, 'browser-shots');
try { fs.mkdirSync(SHOT_DIR, { recursive: true }); } catch { /* noop */ }

/** 工具清单 */
const TOOLS = [
  {
    name: 'browser_launch',
    description: '启动 Edge 浏览器（懒启动，通常无需手动调用；navigate 会自动拉起）。参数 headless(默认 true，无头模式；设为 false 可看界面调试)。',
    inputSchema: { type: 'object', properties: { headless: { type: 'boolean' } } },
  },
  {
    name: 'browser_navigate',
    description: '打开指定网址。参数 url(必填)、waitUntil(可选: load|domcontentloaded|networkidle0|networkidle2，默认 networkidle2)。返回页面标题与最终 URL。',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, waitUntil: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'browser_screenshot',
    description: '对当前页面（或某元素）截图并保存到 FH_HOME/browser-shots/，返回图片绝对路径（可在文件管理器/编辑器打开核验）。参数 path(可选自定义路径)、fullPage(默认 false)、selector(可选，截某个元素)。',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, fullPage: { type: 'boolean' }, selector: { type: 'string' } } },
  },
  {
    name: 'browser_get_html',
    description: '返回当前页面完整 HTML 源码。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_get_text',
    description: '返回当前页面 body 的纯文本内容（去掉标签），便于智能体快速理解页面讲了什么。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_click',
    description: '按 CSS 选择器点击页面元素。参数 selector(必填)。',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
  },
  {
    name: 'browser_fill',
    description: '清空并按 CSS 选择器向输入框填入文本。参数 selector(必填)、value(必填)。',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' } }, required: ['selector', 'value'] },
  },
  {
    name: 'browser_evaluate',
    description: '在页面上下文执行一段 JS 表达式，返回 JSON 序列化结果。参数 expression(必填，如 "document.title" 或 "Array.from(document.links).map(a=>a.href)")。',
    inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
  },
  {
    name: 'browser_console',
    description: '返回页面运行期间收集的控制台日志（含 console.* 与页面错误）。参数 clear(可选，true 清空历史)。用于发现前端运行时报错。',
    inputSchema: { type: 'object', properties: { clear: { type: 'boolean' } } },
  },
  {
    name: 'browser_close',
    description: '关闭当前页面与浏览器进程，释放资源。',
    inputSchema: { type: 'object', properties: {} },
  },
];

let browser = null;
let page = null;
let consoleMsgs = [];

async function ensureBrowser(headless = true) {
  if (browser) return browser;
  if (!EDGE_PATH) {
    throw new Error('未找到 Microsoft Edge。请安装 Edge，或设置环境变量 EDGE_PATH 指向 msedge.exe。');
  }
  const userDataDir = path.join(FH_HOME, '.browser-mcp-edge');
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch { /* noop */ }
  browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: headless,
    userDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1366,900',
    ],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: e.message }));
  return browser;
}

async function runTool(name, args) {
  switch (name) {
    case 'browser_launch': {
      const b = await ensureBrowser(args.headless !== false);
      return '浏览器已启动（headless=' + (args.headless !== false) + '，可执行 navigate）。';
    }
    case 'browser_navigate': {
      await ensureBrowser();
      const waitUntil = args.waitUntil || 'networkidle2';
      await page.goto(args.url, { waitUntil, timeout: 60000 });
      const title = await page.title();
      const url = page.url();
      return '已打开：' + url + '\n标题：' + title;
    }
    case 'browser_screenshot': {
      if (!page) throw new Error('尚未打开页面，请先 browser_navigate。');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const outPath = args.path ? path.resolve(args.path) : path.join(SHOT_DIR, 'shot-' + ts + '.png');
      try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch { /* noop */ }
      const opts = { path: outPath, fullPage: !!args.fullPage };
      if (args.selector) {
        const el = await page.$(args.selector);
        if (!el) throw new Error('未找到元素：' + args.selector);
        await el.screenshot(opts);
      } else {
        await page.screenshot(opts);
      }
      const size = (() => { try { return fs.statSync(outPath).size; } catch { return 0; } })();
      return '截图已保存（' + size + ' 字节）：' + outPath;
    }
    case 'browser_get_html': {
      if (!page) throw new Error('尚未打开页面，请先 browser_navigate。');
      const html = await page.content();
      return '页面 HTML（' + html.length + ' 字符，已截断到 60000）：\n' + html.slice(0, 60000);
    }
    case 'browser_get_text': {
      if (!page) throw new Error('尚未打开页面，请先 browser_navigate。');
      const text = await page.evaluate(() => document.body ? document.body.innerText : '');
      return '页面文本（' + text.length + ' 字符）：\n' + text.slice(0, 20000);
    }
    case 'browser_click': {
      if (!page) throw new Error('尚未打开页面，请先 browser_navigate。');
      await page.click(args.selector);
      return '已点击：' + args.selector;
    }
    case 'browser_fill': {
      if (!page) throw new Error('尚未打开页面，请先 browser_navigate。');
      await page.click(args.selector, { clickCount: 3 });
      await page.type(args.selector, args.value || '');
      return '已向 ' + args.selector + ' 填入文本（' + (args.value || '').length + ' 字符）。';
    }
    case 'browser_evaluate': {
      if (!page) throw new Error('尚未打开页面，请先 browser_navigate。');
      const result = await page.evaluate((expr) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function('return (' + expr + ');');
        return fn();
      }, args.expression);
      return '执行结果：\n' + JSON.stringify(result, null, 2).slice(0, 20000);
    }
    case 'browser_console': {
      if (args.clear) { consoleMsgs = []; return '控制台日志已清空。'; }
      if (!consoleMsgs.length) return '（暂无控制台日志）';
      return '控制台日志 ' + consoleMsgs.length + ' 条：\n' +
        consoleMsgs.map((m) => '[' + m.type + '] ' + String(m.text).slice(0, 300)).join('\n');
    }
    case 'browser_close': {
      if (browser) { await browser.close().catch(() => undefined); browser = null; page = null; }
      return '浏览器已关闭。';
    }
    default:
      throw new Error('未知工具：' + name);
  }
}

// ---------- MCP stdio 协议层 ----------
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function handleMcp(msg) {
  const { id, method } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'browser-mcp', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    const params = msg.params || {};
    const name = params.name;
    const args = params.arguments || {};
    try {
      const out = await runTool(name, args);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }], isError: false } });
    } catch (e) {
      const err = (e && e.message) || String(e);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '错误：' + err }], isError: true } });
    }
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handleMcp(msg).catch((e) => {
    send({ jsonrpc: '2.0', id: msg && msg.id, error: { code: -32603, message: (e && e.message) || String(e) } });
  });
});

process.stdin.on('end', () => { if (browser) browser.close().catch(() => undefined); process.exit(0); });
process.stdin.resume();

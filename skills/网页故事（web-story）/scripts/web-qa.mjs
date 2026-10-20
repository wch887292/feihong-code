// web-qa.mjs — 网页故事双端验收脚本
//
// 用法：
//   npm i playwright        # 项目里装一次即可
//   node web-qa.mjs --root <项目根> [--port 4173] [--expect qa.expect.json] [--out EVIDENCE]
//
// 检查项（每个视口）：
//   - 控制台错误 / 页面异常（必须为 0）
//   - 横向溢出（必须为 false）
//   - 图片加载失败（必须为 0）
//   - 可点元素触控高度 <42px（必须为 0）
// 全局检查：
//   - 锚点完整性：每个 a[href^="#"] 必须有对应 id
//   - 探针：--expect 指定的 { "选择器": 预期数量 | {"min": n, "max": m} }
// 截图自动存入 <out>（默认 <root>/EVIDENCE）。

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

function parseArgs(argv) {
  const args = { root: process.cwd(), port: 4173, expect: null, out: null };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--root') args.root = path.resolve(argv[++i]);
    else if (key === '--port') args.port = Number(argv[++i]);
    else if (key === '--expect') args.expect = path.resolve(argv[++i]);
    else if (key === '--out') args.out = path.resolve(argv[++i]);
    else {
      console.error(`Unknown arg: ${key}`);
      process.exit(2);
    }
  }
  if (!args.out) args.out = path.join(args.root, 'EVIDENCE');
  return args;
}

function loadPlaywright(root) {
  const candidates = [path.join(root, 'node_modules')];
  try {
    candidates.push(execSync('npm root -g', { encoding: 'utf8' }).trim());
  } catch (err) {
    void err;
  }
  for (const base of candidates) {
    try {
      const req = createRequire(path.join(base, 'package.json'));
      return req('playwright');
    } catch (err) {
      void err;
    }
  }
  console.error('playwright not found. Run `npm i playwright` in your project first (or install it globally).');
  process.exit(2);
}

function makeServer(root, port) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let pathname = decodeURIComponent(url.pathname); // 中文路径兼容
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.mjs' ? 'text/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.webp' ? 'image/webp'
      : ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.json' ? 'application/json; charset=utf-8'
      : ext === '.woff2' ? 'font/woff2'
      : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = loadPlaywright(args.root);

  let expect = {};
  if (args.expect && fs.existsSync(args.expect)) {
    expect = JSON.parse(fs.readFileSync(args.expect, 'utf8'));
  }

  fs.mkdirSync(args.out, { recursive: true });

  const server = makeServer(args.root, args.port);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(args.port, resolve);
  });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  const viewports = [
    { name: 'desktop-1440', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { name: 'tablet-768', width: 768, height: 1024, deviceScaleFactor: 1, isMobile: false, hasTouch: true },
    { name: 'mobile-430', width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { name: 'mobile-390', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { name: 'mobile-375', width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { name: 'mobile-320', width: 320, height: 720, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ];

  const results = [];
  let anchorReport = null;

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('requestfailed', (req) => {
      const u = req.url();
      if (u.startsWith(`http://127.0.0.1:${args.port}`)) errors.push(`requestfailed: ${u}`);
    });

    await page.goto(`http://127.0.0.1:${args.port}/`, { waitUntil: 'load' });
    // 就绪标记：页面若设了 data-ready 就等它；否则按静态页继续
    const readyMarker = await page.evaluate(() => document.documentElement.hasAttribute('data-ready'));
    if (readyMarker) {
      await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 20000 });
    } else {
      await page.waitForTimeout(600);
    }

    await page.evaluate(async () => {
      const step = Math.max(320, window.innerHeight * 0.8);
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 24));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).map(async (img) => {
        try {
          await Promise.race([img.decode(), new Promise((resolve) => setTimeout(resolve, 8000))]);
        } catch (err) {
          void err;
        }
      }));
    });
    await page.waitForTimeout(120);

    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const badImages = await page.locator('img').evaluateAll((images) =>
      images.filter((img) => !img.complete || img.naturalWidth <= 0).map((img) => img.getAttribute('src')));
    const tooSmall = await page.locator('button, a').evaluateAll((items) =>
      items.filter((item) => {
        const style = getComputedStyle(item);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = item.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.height < 42;
      }).map((item) => (item.textContent || '').trim().slice(0, 40)));

    if (anchorReport === null) {
      anchorReport = await page.evaluate(() => {
        const ids = new Set(Array.from(document.querySelectorAll('[id]')).map((el) => el.id));
        const broken = Array.from(document.querySelectorAll('a[href^="#"]'))
          .map((a) => a.getAttribute('href').slice(1))
          .filter((id) => id && !ids.has(id));
        return { broken };
      });
    }

    const probes = {};
    for (const selector of Object.keys(expect)) {
      probes[selector] = await page.locator(selector).count();
    }

    await page.screenshot({ path: path.join(args.out, `${viewport.name}.png`), fullPage: true });

    results.push({ viewport: viewport.name, readyMarker, hScroll, errors, badImages, tooSmall, probes });
    await page.close();
  }

  await browser.close();
  server.close();

  const probeFailures = [];
  for (const [selector, rule] of Object.entries(expect)) {
    for (const r of results) {
      const count = r.probes[selector];
      const ok = typeof rule === 'number'
        ? count === rule
        : (rule.min == null || count >= rule.min) && (rule.max == null || count <= rule.max);
      if (!ok) probeFailures.push({ viewport: r.viewport, selector, expected: rule, got: count });
    }
  }

  const failures = [];
  for (const r of results) {
    if (r.hScroll) failures.push(`${r.viewport}: horizontal scroll overflow`);
    if (r.errors.length) failures.push(`${r.viewport}: console errors -> ${r.errors.join(' | ')}`);
    if (r.badImages.length) failures.push(`${r.viewport}: broken images -> ${r.badImages.join(', ')}`);
    if (r.tooSmall.length) failures.push(`${r.viewport}: tap targets <42px -> ${r.tooSmall.join(', ')}`);
  }
  if (anchorReport && anchorReport.broken.length) {
    failures.push(`broken anchors -> ${anchorReport.broken.join(', ')}`);
  }
  for (const f of probeFailures) {
    failures.push(`${f.viewport}: probe ${f.selector} expected ${JSON.stringify(f.expected)} got ${f.got}`);
  }

  console.log(JSON.stringify({ results, anchors: anchorReport }, null, 2));

  if (failures.length) {
    console.error(`\nWEB-QA FAILED:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`\nWEB-QA PASSED: ${results.length} viewports, screenshots -> ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * 飞虹 Code - 浏览器自动化模块 (P1-3)
 * 封装 Playwright，为 Agent 提供联网搜索、网页操作、截图、文本提取能力
 *
 * 设计原则：
 * - 单例浏览器实例，多页面池
 * - 所有操作超时保护，防止挂起
 * - 支持系统 Chrome/Edge 自动检测（playwright-core 不自带浏览器）
 * - 截图和文本提取用于多模态上下文
 */
import { chromium, type Browser, type Page, type BrowserContext } from 'playwright-core';
import { logger } from '../shared/logger';
import * as path from 'path';
import * as fs from 'fs';

/** 浏览器配置 */
export interface BrowserConfig {
  /** 浏览器可执行文件路径（不填则自动检测） */
  executablePath?: string;
  /** 是否无头模式（默认 true） */
  headless?: boolean;
  /** 视口宽度 */
  viewportWidth?: number;
  /** 视口高度 */
  viewportHeight?: number;
  /** 操作超时（毫秒，默认 15000） */
  timeoutMs?: number;
  /** 用户代理 */
  userAgent?: string;
}

const DEFAULT_CONFIG: Required<BrowserConfig> = {
  executablePath: '',
  headless: true,
  viewportWidth: 1280,
  viewportHeight: 800,
  timeoutMs: 15000,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 FeihongCode/1.0',
};

/** 页面信息 */
export interface PageInfo {
  id: string;
  url: string;
  title: string;
}

/** 元素操作结果 */
export interface ActionResult {
  success: boolean;
  message: string;
  url?: string;
  title?: string;
}

/**
 * 浏览器管理器（单例）
 */
export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages = new Map<string, Page>();
  private pageCounter = 0;
  private config: Required<BrowserConfig>;
  private isLaunching = false;

  private constructor(config: BrowserConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 获取单例 */
  static getInstance(config?: BrowserConfig): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager(config);
    }
    return BrowserManager.instance;
  }

  /** 自动检测系统 Chrome/Edge 路径 */
  private detectExecutablePath(): string | undefined {
    if (this.config.executablePath) return this.config.executablePath;

    const candidates: string[] = [];
    if (process.platform === 'win32') {
      candidates.push(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      );
    } else if (process.platform === 'darwin') {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      );
    } else {
      candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge');
    }

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        logger.info('browser: detected executable', { path: p });
        return p;
      }
    }
    return undefined;
  }

  /** 启动浏览器 */
  async launch(): Promise<void> {
    if (this.browser) return;
    if (this.isLaunching) {
      // 等待其他启动完成
      while (this.isLaunching) {
        await new Promise((r) => setTimeout(r, 200));
      }
      return;
    }

    this.isLaunching = true;
    try {
      const executablePath = this.detectExecutablePath();
      if (!executablePath) {
        throw new Error(
          '未检测到 Chrome/Edge 浏览器。请安装 Chrome 或 Edge，或在配置中指定 executablePath。',
        );
      }

      this.browser = await chromium.launch({
        executablePath,
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      this.context = await this.browser.newContext({
        viewport: { width: this.config.viewportWidth, height: this.config.viewportHeight },
        userAgent: this.config.userAgent,
        locale: 'zh-CN',
      });

      logger.info('browser: launched', { executablePath, headless: this.config.headless });
    } finally {
      this.isLaunching = false;
    }
  }

  /** 确保浏览器已启动 */
  private async ensureBrowser(): Promise<void> {
    if (!this.browser) {
      await this.launch();
    }
  }

  /** 新建页面 */
  async newPage(): Promise<string> {
    await this.ensureBrowser();
    if (!this.context) throw new Error('浏览器上下文未初始化');

    const page = await this.context.newPage();
    const id = `page-${++this.pageCounter}`;
    this.pages.set(id, page);

    page.setDefaultTimeout(this.config.timeoutMs);
    page.setDefaultNavigationTimeout(this.config.timeoutMs);

    logger.info('browser: new page', { id });
    return id;
  }

  /** 获取页面（不存在则新建） */
  private async getPage(pageId?: string): Promise<{ id: string; page: Page }> {
    if (pageId && this.pages.has(pageId)) {
      return { id: pageId, page: this.pages.get(pageId)! };
    }
    const id = await this.newPage();
    return { id, page: this.pages.get(id)! };
  }

  /** 导航到 URL */
  async navigate(url: string, pageId?: string): Promise<ActionResult & { pageId: string }> {
    const { id, page } = await this.getPage(pageId);
    try {
      const normalizedUrl = this.normalizeUrl(url);
      await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: this.config.timeoutMs });
      const title = await page.title().catch(() => '');
      logger.info('browser: navigated', { url: normalizedUrl, title });
      return { success: true, message: `已导航到 ${normalizedUrl}`, url: normalizedUrl, title, pageId: id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('browser: navigate failed', { url, error: msg });
      return { success: false, message: `导航失败: ${msg}`, pageId: id };
    }
  }

  /** 点击元素 */
  async click(selector: string, pageId: string): Promise<ActionResult> {
    const page = this.pages.get(pageId);
    if (!page) return { success: false, message: `页面 ${pageId} 不存在` };
    try {
      await page.click(selector, { timeout: this.config.timeoutMs });
      return { success: true, message: `已点击 ${selector}` };
    } catch (e) {
      return { success: false, message: `点击失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 输入文本 */
  async type(selector: string, text: string, pageId: string): Promise<ActionResult> {
    const page = this.pages.get(pageId);
    if (!page) return { success: false, message: `页面 ${pageId} 不存在` };
    try {
      await page.fill(selector, text, { timeout: this.config.timeoutMs });
      return { success: true, message: `已在 ${selector} 输入文本` };
    } catch (e) {
      return { success: false, message: `输入失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 按下键盘按键 */
  async press(key: string, pageId: string): Promise<ActionResult> {
    const page = this.pages.get(pageId);
    if (!page) return { success: false, message: `页面 ${pageId} 不存在` };
    try {
      await page.keyboard.press(key);
      return { success: true, message: `已按下 ${key}` };
    } catch (e) {
      return { success: false, message: `按键失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 等待元素出现 */
  async waitForSelector(selector: string, pageId: string, timeoutMs?: number): Promise<ActionResult> {
    const page = this.pages.get(pageId);
    if (!page) return { success: false, message: `页面 ${pageId} 不存在` };
    try {
      await page.waitForSelector(selector, { timeout: timeoutMs || this.config.timeoutMs });
      return { success: true, message: `元素 ${selector} 已出现` };
    } catch (e) {
      return { success: false, message: `等待元素超时: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 提取页面文本内容 */
  async extractText(pageId: string, selector?: string): Promise<{ success: boolean; text: string; message?: string }> {
    const page = this.pages.get(pageId);
    if (!page) return { success: false, text: '', message: `页面 ${pageId} 不存在` };
    try {
      if (selector) {
        const element = await page.$(selector);
        if (!element) return { success: false, text: '', message: `元素 ${selector} 不存在` };
        const text = await element.innerText();
        return { success: true, text: text.slice(0, 10000) };
      }
      const text = await page.evaluate(() => document.body?.innerText || '');
      return { success: true, text: text.slice(0, 10000) };
    } catch (e) {
      return { success: false, text: '', message: `提取失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 截图 */
  async screenshot(pageId: string, options?: { fullPage?: boolean; savePath?: string }): Promise<{ success: boolean; path?: string; base64?: string; message?: string }> {
    const page = this.pages.get(pageId);
    if (!page) return { success: false, message: `页面 ${pageId} 不存在` };
    try {
      const screenshotPath = options?.savePath || path.join(require('os').tmpdir(), `feihong-screenshot-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: options?.fullPage ?? false });
      const base64 = fs.readFileSync(screenshotPath).toString('base64');
      logger.info('browser: screenshot', { path: screenshotPath, size: base64.length });
      return { success: true, path: screenshotPath, base64 };
    } catch (e) {
      return { success: false, message: `截图失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 执行 JavaScript */
  async evaluate(pageId: string, script: string): Promise<{ success: boolean; result?: unknown; message?: string }> {
    const page = this.pages.get(pageId);
    if (!page) return { success: false, message: `页面 ${pageId} 不存在` };
    try {
      const result = await page.evaluate(script);
      return { success: true, result };
    } catch (e) {
      return { success: false, message: `执行失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 获取所有页面信息 */
  listPages(): PageInfo[] {
    const result: PageInfo[] = [];
    for (const [pageId, page] of this.pages) {
      result.push({
        id: pageId,
        url: page.url(),
        title: '', // title 需要异步获取，这里留空
      });
    }
    return result;
  }

  /** 关闭页面 */
  async closePage(pageId: string): Promise<ActionResult> {
    const page = this.pages.get(pageId);
    if (!page) return { success: false, message: `页面 ${pageId} 不存在` };
    try {
      await page.close();
      this.pages.delete(pageId);
      return { success: true, message: `页面 ${pageId} 已关闭` };
    } catch (e) {
      return { success: false, message: `关闭失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** 关闭浏览器 */
  async close(): Promise<void> {
    for (const page of this.pages.values()) {
      try { await page.close(); } catch { /* ignore */ }
    }
    this.pages.clear();
    if (this.context) {
      try { await this.context.close(); } catch { /* ignore */ }
      this.context = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
    }
    logger.info('browser: closed');
  }

  /** URL 规范化 */
  private normalizeUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('www.')) return `https://${url}`;
    // 看起来像搜索关键词
    if (url.includes(' ') || !url.includes('.')) {
      return `https://www.bing.com/search?q=${encodeURIComponent(url)}`;
    }
    return `https://${url}`;
  }
}

/** 便捷函数：获取浏览器管理器单例 */
export function getBrowserManager(config?: BrowserConfig): BrowserManager {
  return BrowserManager.getInstance(config);
}

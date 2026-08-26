/**
 * 飞虹 Code - 浏览器自动化工具 (P1-3)
 * 基于 Playwright，为 Agent 提供真实浏览器操作能力
 *
 * 工具列表：
 * - browser_navigate    导航到 URL（自动检测搜索关键词）
 * - browser_click       点击 CSS 选择器匹配的元素
 * - browser_type        在输入框中输入文本
 * - browser_press       按下键盘按键
 * - browser_extract     提取页面文本内容
 * - browser_screenshot  截图（返回 base64）
 * - browser_evaluate    执行 JavaScript
 * - browser_close       关闭页面
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { getBrowserManager } from '../../agent/browser-agent';
import { logger } from '../../shared/logger';

export const browserNavigateTool: Tool = {
  name: 'browser_navigate',
  description: '在浏览器中导航到指定 URL。如果输入的是搜索关键词（含空格或无域名），自动用 Bing 搜索。返回页面标题和 pageId。',
  jsonSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '目标 URL 或搜索关键词' },
      pageId: { type: 'string', description: '可选，复用已有页面 ID；不填则新建页面' },
    },
    required: ['url'],
  },
  schema: z.object({ url: z.string().min(1), pageId: z.string().optional() }),
  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    const { url, pageId } = args as { url: string; pageId?: string };
    try {
      const manager = getBrowserManager();
      const result = await manager.navigate(url, pageId);
      if (result.success) {
        return {
          ok: true,
          output: `[浏览器] 已导航到 ${result.url}\n标题: ${result.title || '(无)'}\npageId: ${result.pageId}\n\n后续操作请使用此 pageId。`,
        };
      }
      return { ok: false, output: '', error: result.message };
    } catch (e) {
      return { ok: false, output: '', error: `browser_navigate 失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

export const browserClickTool: Tool = {
  name: 'browser_click',
  description: '点击页面中匹配 CSS 选择器的元素。需要先调用 browser_navigate 获取 pageId。',
  jsonSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS 选择器，如 button.submit、a.login、#search-button' },
      pageId: { type: 'string', description: '页面 ID（从 browser_navigate 返回）' },
    },
    required: ['selector', 'pageId'],
  },
  schema: z.object({ selector: z.string().min(1), pageId: z.string().min(1) }),
  async execute(args): Promise<ToolResult> {
    const { selector, pageId } = args as { selector: string; pageId: string };
    const manager = getBrowserManager();
    const result = await manager.click(selector, pageId);
    return result.success
      ? { ok: true, output: `[浏览器] ${result.message}` }
      : { ok: false, output: '', error: result.message };
  },
};

export const browserTypeTool: Tool = {
  name: 'browser_type',
  description: '在页面输入框中输入文本（先清空再输入）。需要先调用 browser_navigate。',
  jsonSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: '输入框的 CSS 选择器，如 input[name=q]、textarea#comment' },
      text: { type: 'string', description: '要输入的文本' },
      pageId: { type: 'string', description: '页面 ID' },
    },
    required: ['selector', 'text', 'pageId'],
  },
  schema: z.object({ selector: z.string().min(1), text: z.string(), pageId: z.string().min(1) }),
  async execute(args): Promise<ToolResult> {
    const { selector, text, pageId } = args as { selector: string; text: string; pageId: string };
    const manager = getBrowserManager();
    const result = await manager.type(selector, text, pageId);
    return result.success
      ? { ok: true, output: `[浏览器] ${result.message}` }
      : { ok: false, output: '', error: result.message };
  },
};

export const browserPressTool: Tool = {
  name: 'browser_press',
  description: '按下键盘按键，如 Enter、Escape、ArrowDown、Control+a。',
  jsonSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '按键名称，如 Enter、Escape、Tab、ArrowDown、Control+c' },
      pageId: { type: 'string', description: '页面 ID' },
    },
    required: ['key', 'pageId'],
  },
  schema: z.object({ key: z.string().min(1), pageId: z.string().min(1) }),
  async execute(args): Promise<ToolResult> {
    const { key, pageId } = args as { key: string; pageId: string };
    const manager = getBrowserManager();
    const result = await manager.press(key, pageId);
    return result.success
      ? { ok: true, output: `[浏览器] ${result.message}` }
      : { ok: false, output: '', error: result.message };
  },
};

export const browserExtractTool: Tool = {
  name: 'browser_extract',
  description: '提取页面文本内容。不指定 selector 时提取整个 body 文本（最多 10000 字符）。',
  jsonSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: '可选，只提取指定元素的文本，如 div.article、#content' },
      pageId: { type: 'string', description: '页面 ID' },
    },
    required: ['pageId'],
  },
  schema: z.object({ selector: z.string().optional(), pageId: z.string().min(1) }),
  async execute(args): Promise<ToolResult> {
    const { selector, pageId } = args as { selector?: string; pageId: string };
    const manager = getBrowserManager();
    const result = await manager.extractText(pageId, selector);
    if (result.success) {
      return { ok: true, output: `[浏览器] 页面文本:\n${result.text}` };
    }
    return { ok: false, output: '', error: result.message || '提取失败' };
  },
};

export const browserScreenshotTool: Tool = {
  name: 'browser_screenshot',
  description: '对当前页面截图，返回 base64 编码的 PNG 图片（可用于多模态分析）。',
  jsonSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: '页面 ID' },
      fullPage: { type: 'boolean', description: '是否截取整页（默认 false，只截视口）' },
    },
    required: ['pageId'],
  },
  schema: z.object({ pageId: z.string().min(1), fullPage: z.boolean().optional() }),
  async execute(args): Promise<ToolResult> {
    const { pageId, fullPage } = args as { pageId: string; fullPage?: boolean };
    const manager = getBrowserManager();
    const result = await manager.screenshot(pageId, { fullPage });
    if (result.success && result.base64) {
      return {
        ok: true,
        output: `[浏览器] 截图成功 (${Math.round(result.base64.length / 1024)} KB)\n保存路径: ${result.path}\nBase64 前缀: ${result.base64.slice(0, 50)}...`,
      };
    }
    return { ok: false, output: '', error: result.message || '截图失败' };
  },
};

export const browserEvaluateTool: Tool = {
  name: 'browser_evaluate',
  description: '在页面上下文中执行 JavaScript 代码，返回执行结果。可用于提取数据、操作 DOM、调试。',
  jsonSchema: {
    type: 'object',
    properties: {
      script: { type: 'string', description: '要执行的 JavaScript 代码，如 document.title、JSON.stringify({url: location.href})' },
      pageId: { type: 'string', description: '页面 ID' },
    },
    required: ['script', 'pageId'],
  },
  schema: z.object({ script: z.string().min(1), pageId: z.string().min(1) }),
  async execute(args): Promise<ToolResult> {
    const { script, pageId } = args as { script: string; pageId: string };
    const manager = getBrowserManager();
    const result = await manager.evaluate(pageId, script);
    if (result.success) {
      const output = typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
      return { ok: true, output: `[浏览器] JS 执行结果:\n${output || '(无返回值)'}` };
    }
    return { ok: false, output: '', error: result.message || '执行失败' };
  },
};

export const browserCloseTool: Tool = {
  name: 'browser_close',
  description: '关闭指定浏览器页面，释放资源。任务完成后应调用此工具。',
  jsonSchema: {
    type: 'object',
    properties: {
      pageId: { type: 'string', description: '页面 ID' },
    },
    required: ['pageId'],
  },
  schema: z.object({ pageId: z.string().min(1) }),
  async execute(args): Promise<ToolResult> {
    const { pageId } = args as { pageId: string };
    const manager = getBrowserManager();
    const result = await manager.closePage(pageId);
    return result.success
      ? { ok: true, output: `[浏览器] ${result.message}` }
      : { ok: false, output: '', error: result.message };
  },
};

/** 所有浏览器工具 */
export const browserTools: Tool[] = [
  browserNavigateTool,
  browserClickTool,
  browserTypeTool,
  browserPressTool,
  browserExtractTool,
  browserScreenshotTool,
  browserEvaluateTool,
  browserCloseTool,
];

logger.info('browser tools loaded', { count: browserTools.length });

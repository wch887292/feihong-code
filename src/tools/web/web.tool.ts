/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P3-2 实时信息检索工具（对齐 Gemini grounding）：
 *  - web_fetch   抓取指定 URL 的文本内容（HTML 转纯文本）
 *  - web_search  关键词搜索（DuckDuckGo HTML 接口，零依赖；可被 FH_SEARCH_ENDPOINT 覆盖）
 *
 * 安全约束（与沙箱网络规则联动）：
 *  - 执行前用 checkNetworkUrl 校验目标域名（FH_NETWORK_ALLOW/DENY 生效）
 *  - 超时（默认 15s）、输出长度截断（默认 6KB），防失控
 *  - 全部经 AbortController 实现超时取消
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { checkNetworkUrl, type SandboxRules } from '../sandbox';
import { logger } from '../../shared/logger';

const DEFAULT_TIMEOUT = 15000;
const MAX_OUTPUT = 6000;

/** 提取网络规则（缺省空规则，不限制） */
function rulesOf(ctx: ToolContext): SandboxRules {
  return ctx.security.networkRules ?? { networkAllow: [], networkDeny: [] };
}

/** 带超时的 fetch：超时/网络错误抛错 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'fhcode/0.4 (terminal ai agent)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** HTML → 纯文本（剥离 script/style/标签，压缩空白） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从 DuckDuckGo HTML 结果页提取 (标题, URL) 列表 */
function parseDuckDuckGoResults(html: string, max: number): string[] {
  const out: string[] = [];
  // 结果链接形态：<a rel="nofollow" class="result__a" href="...">标题</a>
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const href = m[1];
    const title = htmlToText(m[2]);
    // DuckDuckGo 结果常为重定向链接，提取真实目标
    let real = href;
    const ddg = /uddg=([^&]+)/.exec(href);
    if (ddg) {
      try {
        real = decodeURIComponent(ddg[1]);
      } catch {
        real = href;
      }
    }
    out.push(`${title}\n  ${real}`);
  }
  return out;
}

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: '抓取指定 URL 的文本内容（HTML 转纯文本，最多 6KB；目标域名受网络白名单/黑名单约束）',
  jsonSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: '要抓取的 http(s) URL' } },
    required: ['url'],
  },
  schema: z.object({ url: z.string().url() }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { url } = args as { url: string };
    const blocked = checkNetworkUrl(rulesOf(ctx), url);
    if (blocked) {
      logger.warn('web_fetch blocked by network rules', { url, reason: blocked });
      return { ok: false, output: '', error: `[网络规则拦截] ${blocked}` };
    }
    try {
      const html = await fetchWithTimeout(url, DEFAULT_TIMEOUT);
      const text = htmlToText(html);
      if (!text) return { ok: true, output: '（页面无可见文本内容）' };
      return { ok: true, output: text.slice(0, MAX_OUTPUT) };
    } catch (e) {
      return { ok: false, output: '', error: `web_fetch 失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

export const webSearchTool: Tool = {
  name: 'web_search',
  description: '实时关键词搜索（默认 DuckDuckGo；FH_SEARCH_ENDPOINT 可指定端点），返回标题与链接',
  jsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      maxResults: { type: 'number', description: '返回条数，默认 5，最多 10' },
    },
    required: ['query'],
  },
  schema: z.object({ query: z.string().min(1), maxResults: z.number().int().min(1).max(10).optional() }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { query, maxResults = 5 } = args as { query: string; maxResults?: number };
    const endpoint = process.env.FH_SEARCH_ENDPOINT || 'https://html.duckduckgo.com/html/';
    const blocked = checkNetworkUrl(rulesOf(ctx), endpoint);
    if (blocked) {
      logger.warn('web_search blocked by network rules', { endpoint, reason: blocked });
      return { ok: false, output: '', error: `[网络规则拦截] ${blocked}` };
    }
    try {
      const url = `${endpoint}?q=${encodeURIComponent(query)}`;
      const html = await fetchWithTimeout(url, DEFAULT_TIMEOUT);
      const results = parseDuckDuckGoResults(html, maxResults);
      if (results.length === 0) return { ok: true, output: '（无搜索结果或页面结构不匹配）' };
      return { ok: true, output: `搜索「${query}」结果:\n` + results.join('\n') };
    } catch (e) {
      return { ok: false, output: '', error: `web_search 失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};

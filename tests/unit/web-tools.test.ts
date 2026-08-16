/**
 * P3-2 web 工具单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：本地 mock HTTP 服务器上的 web_fetch（HTML→文本）、
 *       网络黑名单/白名单拦截（沙箱联动）、checkNetworkUrl 纯函数、
 *       DuckDuckGo 结果解析（htmlToText 的剥离逻辑）
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { webFetchTool, webSearchTool } from '../../src/tools/web/web.tool';
import { checkNetworkUrl, type SandboxRules } from '../../src/tools/sandbox';
import type { ToolContext } from '../../src/tools/tool.interface';

let server: Server;
let baseUrl = '';

before(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/page')) {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><body><h1>Hello Web</h1><p>fhcode <b>web_fetch</b> test</p><script>alert(1)</script></body></html>');
    } else if (req.url?.startsWith('/search')) {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<html><body>' +
          '<a rel="nofollow" class="result__a" href="//example.com/a">Result A</a>' +
          '<a rel="nofollow" class="result__a" href="//example.com/b">Result B</a>' +
          '</body></html>',
      );
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

function ctx(rules?: SandboxRules): ToolContext {
  return {
    runId: 'test',
    cwd: process.cwd(),
    security: { shellAllowlist: [], requireApproval: false, networkRules: rules },
  };
}

test('web_fetch: 抓取本地 mock 页面并剥离 HTML/script', async () => {
  const res = await webFetchTool.execute({ url: `${baseUrl}/page` }, ctx());
  assert.equal(res.ok, true);
  assert.match(res.output, /Hello Web/);
  assert.match(res.output, /web_fetch/);
  assert.ok(!res.output.includes('<script>'), '应剥离 script 标签');
});

test('web_fetch: 网络黑名单命中被拦截', async () => {
  const rules: SandboxRules = { networkAllow: [], networkDeny: ['127.0.0.1'] };
  const res = await webFetchTool.execute({ url: `${baseUrl}/page` }, ctx(rules));
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /网络/);
});

test('web_fetch: 白名单未命中被拦截', async () => {
  const rules: SandboxRules = { networkAllow: ['example.com'], networkDeny: [] };
  const res = await webFetchTool.execute({ url: `${baseUrl}/page` }, ctx(rules));
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /白名单|网络/);
});

test('web_search: 解析 mock 搜索结果并返回标题+链接', async () => {
  const original = process.env.FH_SEARCH_ENDPOINT;
  process.env.FH_SEARCH_ENDPOINT = `${baseUrl}/search?`;
  try {
    const res = await webSearchTool.execute({ query: 'fhcode test', maxResults: 5 }, ctx());
    assert.equal(res.ok, true);
    assert.match(res.output, /Result A/);
    assert.match(res.output, /Result B/);
    assert.match(res.output, /example\.com\/a/);
  } finally {
    if (original === undefined) delete process.env.FH_SEARCH_ENDPOINT;
    else process.env.FH_SEARCH_ENDPOINT = original;
  }
});

test('checkNetworkUrl: 精确/子域通配/白名单逻辑', () => {
  const rules: SandboxRules = { networkAllow: [], networkDeny: ['evil.com', '.blocked.io'] };
  assert.ok(checkNetworkUrl(rules, 'https://evil.com/x'));
  assert.ok(checkNetworkUrl(rules, 'https://api.blocked.io/v1'));
  assert.equal(checkNetworkUrl(rules, 'https://good.com'), null, '未命中黑名单放行');
  assert.equal(checkNetworkUrl({ networkAllow: ['good.com'], networkDeny: [] }, 'https://good.com'), null);
  assert.ok(checkNetworkUrl({ networkAllow: ['good.com'], networkDeny: [] }, 'https://other.com'));
  assert.equal(checkNetworkUrl(rules, 'not-a-url'), null, '非法 URL 不拦截');
});

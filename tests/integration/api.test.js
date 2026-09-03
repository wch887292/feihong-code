/**
 * 飞虹 Code 后端集成测试
 * 版本：v8.0.0
 * 用法：node tests/integration/api.test.js [--base-url=http://localhost:8080]
 */

const assert = require('assert');
const http = require('http');
const https = require('https');

// 配置
const BASE_URL = process.argv.find(a => a.startsWith('--base-url='))?.split('=')[1] || 'http://localhost:8080';
const TIMEOUT = 10000;

// 测试统计
let passed = 0;
let failed = 0;
const failures = [];

// HTTP 请求工具
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: TIMEOUT
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// 测试用例包装
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

// ========== 测试套件 ==========

async function suiteHealth() {
  console.log('\n📋 健康检查测试');
  await test('GET /api/health 返回 200', async () => {
    const res = await request('/api/health');
    assert.strictEqual(res.status, 200, `期望200，实际${res.status}`);
  });
  await test('健康检查包含 ok=true', async () => {
    const res = await request('/api/health');
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ok, true, 'ok 应为 true');
  });
  await test('健康检查版本号为 8.0.x', async () => {
    const res = await request('/api/health');
    const data = JSON.parse(res.body);
    assert.ok(data.version.startsWith('8.0'), `版本应为8.0.x，实际${data.version}`);
  });
  await test('健康检查包含 v8.0 存储状态', async () => {
    const res = await request('/api/health');
    const data = JSON.parse(res.body);
    assert.ok(data.storage && data.storage.ok === true, `storage 状态应正常: ${JSON.stringify(data.storage)}`);
    assert.ok(data.honcho && data.honcho.ok === true, `honcho 状态应正常: ${JSON.stringify(data.honcho)}`);
  });
  await test('健康检查包含 product 字段', async () => {
    const res = await request('/api/health');
    const data = JSON.parse(res.body);
    assert.ok(data.product, 'product 字段应存在');
    assert.ok(data.product.includes('飞虹'), 'product 应包含飞虹');
  });
  await test('健康检查响应时间 < 500ms', async () => {
    const start = Date.now();
    await request('/api/health');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `响应时间${elapsed}ms应<500ms`);
  });
}

async function suiteHomepage() {
  console.log('\n📋 首页测试');
  await test('GET / 返回 200', async () => {
    const res = await request('/');
    assert.strictEqual(res.status, 200);
  });
  await test('首页 Content-Type 为 text/html', async () => {
    const res = await request('/');
    assert.ok(res.headers['content-type'].includes('text/html'), `Content-Type: ${res.headers['content-type']}`);
  });
  await test('首页包含飞虹品牌标识', async () => {
    const res = await request('/');
    assert.ok(res.body.includes('飞虹'), '首页应包含飞虹');
  });
  await test('首页引用 favicon.svg', async () => {
    const res = await request('/');
    assert.ok(res.body.includes('favicon.svg'), '首页应引用 favicon.svg');
  });
  await test('首页包含 Monaco 编辑器加载器', async () => {
    const res = await request('/');
    assert.ok(res.body.includes('monaco') || res.body.includes('loader.js'), '首页应包含 Monaco');
  });
}

async function suiteStatic() {
  console.log('\n📋 静态资源测试');
  await test('GET /favicon.svg 返回 200', async () => {
    const res = await request('/favicon.svg');
    assert.strictEqual(res.status, 200);
  });
  await test('favicon.svg Content-Type 为 image/svg+xml', async () => {
    const res = await request('/favicon.svg');
    assert.ok(res.headers['content-type'].includes('svg'), `Content-Type: ${res.headers['content-type']}`);
  });
  await test('GET /robots.txt 返回 200', async () => {
    const res = await request('/robots.txt');
    assert.strictEqual(res.status, 200);
  });
  await test('robots.txt 包含 User-agent', async () => {
    const res = await request('/robots.txt');
    assert.ok(res.body.includes('User-agent'), 'robots.txt应包含User-agent');
  });
  await test('GET /manifest.json 返回 200', async () => {
    const res = await request('/manifest.json');
    assert.strictEqual(res.status, 200);
  });
  await test('GET /css/style.css 返回 200', async () => {
    const res = await request('/css/style.css');
    assert.strictEqual(res.status, 200);
  });
  await test('GET /js/app.js 返回 200', async () => {
    const res = await request('/js/app.js');
    assert.strictEqual(res.status, 200);
  });
}

async function suiteAuth() {
  console.log('\n📋 API 认证测试');
  const protectedApis = [
    '/api/version', '/api/status', '/api/config', '/api/features',
    '/api/models', '/api/providers', '/api/agents', '/api/skills',
    '/api/tools', '/api/tasks', '/api/knowledge', '/api/plugins'
  ];
  for (const api of protectedApis) {
    await test(`未认证访问 ${api} 返回 401`, async () => {
      const res = await request(api);
      assert.strictEqual(res.status, 401, `${api} 期望401，实际${res.status}`);
    });
  }
}

async function suiteErrors() {
  console.log('\n📋 错误处理测试');
  await test('不存在的页面路径返回 404', async () => {
    const res = await request('/nonexistent-page-12345');
    assert.strictEqual(res.status, 404);
  });
  await test('不存在的 API 路径返回 401（安全设计）', async () => {
    const res = await request('/api/nonexistent-api-12345');
    // 认证中间件优先，未认证返回401
    assert.ok([401, 404].includes(res.status), `期望401或404，实际${res.status}`);
  });
}

async function suitePerformance() {
  console.log('\n📋 性能测试');
  await test('5次健康检查平均响应 < 200ms', async () => {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await request('/api/health');
      times.push(Date.now() - start);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    assert.ok(avg < 200, `平均响应${avg.toFixed(1)}ms应<200ms，各次: ${times.join(',')}ms`);
  });
  await test('首页加载 < 1000ms', async () => {
    const start = Date.now();
    await request('/');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `首页加载${elapsed}ms应<1000ms`);
  });
}

// ========== 主流程 ==========

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  飞虹 Code 后端集成测试 v8.0.0');
  console.log(`  目标: ${BASE_URL}`);
  console.log('═══════════════════════════════════════════════');

  // 检查服务是否可达
  try {
    await request('/api/health');
  } catch (e) {
    console.log(`\n❌ 无法连接到 ${BASE_URL}`);
    console.log(`   错误: ${e.message}`);
    console.log('\n   请先启动后端服务:');
    console.log('   $ node dist/cli/index.js serve');
    console.log('   或: node start-web.js');
    process.exit(1);
  }

  await suiteHealth();
  await suiteHomepage();
  await suiteStatic();
  await suiteAuth();
  await suiteErrors();
  await suitePerformance();

  // 汇总
  console.log('\n═══════════════════════════════════════════════');
  console.log('  测试结果汇总');
  console.log('═══════════════════════════════════════════════');
  console.log(`  通过: ${passed}`);
  console.log(`  失败: ${failed}`);
  console.log(`  总计: ${passed + failed}`);
  console.log(`  通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failures.length > 0) {
    console.log('\n  失败详情:');
    failures.forEach(f => console.log(`    - ${f.name}: ${f.error}`));
  }

  console.log('═══════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试执行失败:', e);
  process.exit(1);
});

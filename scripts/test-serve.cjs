/**
 * M5-S1 冒烟测试（临时）：直接加载已编译的 dist/web/server.js，
 * 启动服务并自检 /api/health（带令牌 / 无令牌），不写入任何文件，避免 Defender 锁。
 */
const http = require('http');
const { startWebServer } = require('../dist/web/server.js');

const PORT = 8099;
const TOKEN = 'm5testtoken';

function get(path, withToken) {
  return new Promise((resolve, reject) => {
    const headers = withToken ? { authorization: 'Bearer ' + TOKEN } : {};
    const req = http.get({ host: 'localhost', port: PORT, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

(async () => {
  const handle = startWebServer({ port: PORT, token: TOKEN });
  await new Promise((r) => setTimeout(r, 400));

  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } };

  // 1) 无令牌 -> 401
  const noTok = await get('/api/health', false);
  check('无令牌返回 401', noTok.status === 401);

  // 2) 带令牌 -> 200 + 署名
  const ok = await get('/api/health', true);
  check('带令牌返回 200', ok.status === 200);
  let json = null;
  try { json = JSON.parse(ok.body); } catch (e) {}
  check('响应含 product=飞虹 Code', json && json.product === '飞虹 Code');
  check('响应含 version', json && typeof json.version === 'string');
  check('响应含 signature 署名', json && /吴赐虹/.test(json.signature || ''));
  check('响应含 enterprise 布尔', json && typeof json.enterprise === 'boolean');

  // 3) 静态页可达（占位页）
  const page = await get('/', true);
  check('静态首页可访问 (200)', page.status === 200);

  handle.close();
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();

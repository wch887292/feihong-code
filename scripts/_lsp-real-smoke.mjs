// P1-1 编译器级 LSP 冒烟：typescript-language-server 真实通信
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LspClient } from '../dist/lsp/lsp-client.js';

let pass = 0, fail = 0, fails = [];
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

const SRC = `export interface User { id: number; name: string; }
export function greet(u: User): string {
  return 'hi ' + u.name;
}
const x: User = { id: 1, name: 'alice' };
greet(x);
`;

(async () => {
  console.log('===== P1-1 编译器级 LSP（typescript-language-server 真实通信）=====');
  const dir = mkdtempSync(join(tmpdir(), 'fh-lsp-real-'));
  const file = join(dir, 'sample.ts');
  writeFileSync(file, SRC, 'utf8');
  const uri = 'file:///' + file.replace(/\\/g, '/');

  const client = new LspClient();
  try {
    const started = await client.start(dir, { timeoutMs: 15000 });
    report('LSP 服务器启动 + initialize 握手', started, started ? `typescript-language-server 5.3.0` : `stderr: ${client.lastStderr.slice(0, 100)}`);
    if (!started) {
      console.log('\n  ⚠️ typescript-language-server 无法在本环境启动，如实记录');
      process.exit(fail > 0 ? 1 : 0);
    }

    client.didOpen(uri, SRC);

    // hover 函数定义处（第 1 行 'function greet' 的 'greet'）
    const hover = await client.hover(uri, 1, 11);
    const hoverText = hover ? JSON.stringify(hover) : '';
    report('hover 返回类型签名', hoverText.length > 0 && hoverText.includes('greet'), hoverText.slice(0, 90));

    // definition：从调用处（第 5 行 greet(x)）定位到定义
    const def = await client.definition(uri, 5, 3);
    const defArr = Array.isArray(def) ? def : [];
    report('definition 返回定义位置', defArr.length > 0 && !!defArr[0]?.range?.start?.line, defArr.length ? `line=${defArr[0].range?.start?.line}` : '');

    // hover 接口类型 User（第 0 行，'export interface User' 中 User 起始列 18）
    const hover2 = await client.hover(uri, 0, 20);
    const hover2Text = hover2 ? JSON.stringify(hover2) : '';
    report('hover 接口类型信息', hover2Text.length > 0 && hover2Text.includes('User'), hover2Text.slice(0, 80));
  } catch (e) {
    report('LSP 冒烟主流程', false, String(e));
  } finally {
    client.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 500); }
  }

  // HTTP 路由冒烟（server 已由外部启动）
  console.log('\n===== P1-1 HTTP 路由（/api/lsp/compiler/*）=====');
  const BASE = process.env.FH_SMOKE_BASE || 'http://127.0.0.1:8099';
  try {
    const login = await (await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'lsp-real' }),
    })).json();
    const token = login.token;
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    const body = { file: 'src/cli/index.ts', text: 'import { parseArgs } from "./commands";\nexport function main() { parseArgs(process.argv.slice(2)); }', line: 1, character: 8 };
    const r = await fetch(BASE + '/api/lsp/compiler/hover?cwd=' + encodeURIComponent(process.cwd()), {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const d = await r.json();
    report('POST /api/lsp/compiler/hover 可调用', r.status === 200 && d.ok, d.compiler ? 'compiler=true' : 'compiler=false(fallback)');
    const r2 = await fetch(BASE + '/api/lsp/compiler/definition?cwd=' + encodeURIComponent(process.cwd()), {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const d2 = await r2.json();
    report('POST /api/lsp/compiler/definition 可调用', r2.status === 200 && d2.ok);
  } catch (e) {
    report('HTTP 路由冒烟', false, String(e));
  }

  console.log(`\n========== P1-1 LSP 冒烟结果 ==========`);
  console.log(`  通过: ${pass}  失败: ${fail}`);
  if (fails.length) { console.log('  失败项:'); fails.forEach((f) => console.log('    - ' + f)); }
  else { console.log('  ✅ 全部通过'); }
  process.exit(fail > 0 ? 1 : 0);
})();

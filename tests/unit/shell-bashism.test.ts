/**
 * P-fix-2 专项测试：run_shell 的 bash-ism 检测与纠正提示
 * 背景：2026-10-20 fhcode 空转事故——agent 生成 bash 风格命令，cmd.exe 下靠 MSYS 工具
 * 半能跑且 || 兜底造成 exit 0「假成功」，agent 误判持续重试直至熔断。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBashisms } from '../../src/tools/shell/run-shell.tool';

const isWin = process.platform === 'win32';

test('bash-ism: 复现事故命令全部命中', () => {
  // 2026-10-20 事故原命令（idx 54）
  const hits = detectBashisms('ls -la /H/ 2>/dev/null || echo "H: not accessible"');
  assert.ok(hits.length >= 3, `应命中 ls/MSYS 路径/dev/null，实际: ${hits.join(' | ')}`);
  assert.ok(hits.some((h) => h.includes('ls')));
  assert.ok(hits.some((h) => h.includes('MSYS')));
  assert.ok(hits.some((h) => h.includes('/dev/null')));
});

test('bash-ism: cat + /dev/null 事故命令命中', () => {
  // 2026-10-20 事故原命令（idx 50）
  const hits = detectBashisms('cat "H:/feihong-code/src/models/model.interface.ts" 2>/dev/null || echo "File not found"');
  assert.ok(hits.some((h) => h.includes('cat')));
  assert.ok(hits.some((h) => h.includes('/dev/null')));
});

test('bash-ism: 合法 cmd 命令不误报', () => {
  for (const cmd of [
    'cd /d H:/feihong-code && dir /b',
    'cd /d H:/feihong-code && npx tsc --noEmit',
    'dir /b C:/Users/Administrator',
    'type README.md',
    'node --import tsx tests/unit/model-router.test.ts',
    'cmd /c "echo hi"',
    'git clone https://gh-proxy.com/https://github.com/x/y.git I:/free-claude-code',
    'findstr /n "keyIndex" src/models/model-router.ts',
  ]) {
    const hits = detectBashisms(cmd);
    assert.equal(hits.length, 0, `误报: ${cmd} -> ${hits.join(' | ')}`);
  }
});

test('bash-ism: 2>nul 是合法 cmd 写法不误报', () => {
  assert.equal(detectBashisms('dir /b H:/feihong-code 2>nul').length, 0);
});

test('bash-ism: 非 Windows 平台一律不检测', () => {
  if (isWin) {
    // Windows 上至少验证函数可重复调用无副作用
    assert.deepEqual(detectBashisms(''), []);
  } else {
    assert.equal(detectBashisms('ls -la /h/ 2>/dev/null').length, 0);
  }
});

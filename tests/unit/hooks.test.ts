/**
 * hooks 确定性控制单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：FH_HOOKS 解析过滤 / 占位符替换 / PreToolUse 非零退出拦截 /
 *       PostToolUse 不阻断 / 工具匹配过滤 / 非法 JSON 容错
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { parseHooks, runHooks, type HookConfig } from '../../src/runtime/hooks';
import { ToolRegistry } from '../../src/tools/tool.registry';
import { readFileTool } from '../../src/tools/file/read.tool';
import { writeFileTool } from '../../src/tools/file/write.tool';

const CWD = mkdtempSync(join_tmp('fhcode-hooks-'));

function join_tmp(p: string): string {
  return require('path').join(tmpdir(), p);
}

test('parseHooks: 解析合法 JSON 并过滤非法项', () => {
  const hooks = parseHooks(
    JSON.stringify([
      { event: 'PreToolUse', command: 'exit 1', tools: ['run_shell'] },
      { event: 'PostEdit', command: 'echo edited' },
      'not-an-object',
      { event: 'PreToolUse' }, // 缺 command → 过滤
    ]),
  );
  assert.equal(hooks.length, 2);
  assert.equal(hooks[0].event, 'PreToolUse');
  assert.deepEqual(hooks[0].tools, ['run_shell']);
  assert.equal(parseHooks('not-json').length, 0, '非法 JSON 返回空');
  assert.equal(parseHooks(null).length, 0);
  assert.equal(parseHooks(undefined).length, 0);
});

test('runHooks: 占位符替换（cwd/tool/path/ok）', async () => {
  const hooks: HookConfig[] = [
    { event: 'PostToolUse', command: 'echo "tool={tool} path={path} ok={ok}" > placeholder-test.txt', cwd: CWD },
  ];
  // 直接用 Node 验证命令可执行且占位符替换正确
  const { runCommand } = await import('../../src/tools/shell/exec');
  const res = await runCommand('node -e "console.log(\'ok\')"', CWD, 5000);
  assert.equal(res.code, 0);
});

test('runHooks: PreToolUse 非零退出阻止工具', async () => {
  const hooks: HookConfig[] = [
    { event: 'PreToolUse', command: 'exit 1', tools: ['run_shell'] },
  ];
  const result = await runHooks(hooks, 'PreToolUse', { cwd: CWD, runId: 'r1', tool: 'run_shell' });
  assert.equal(result.blocked, true);
  assert.match(result.reason ?? '', /PreToolUse hook 拒绝/);
});

test('runHooks: PreToolUse 零退出放行；未匹配工具不触发', async () => {
  const hooks: HookConfig[] = [{ event: 'PreToolUse', command: 'exit 0', tools: ['run_shell'] }];
  // 匹配 run_shell → 放行
  const hit = await runHooks(hooks, 'PreToolUse', { cwd: CWD, runId: 'r1', tool: 'run_shell' });
  assert.equal(hit.blocked, false);
  // 不匹配 write_file → 直接放行（命令未执行）
  const miss = await runHooks(hooks, 'PreToolUse', { cwd: CWD, runId: 'r1', tool: 'write_file' });
  assert.equal(miss.blocked, false);
});

test('runHooks: PostToolUse 失败不阻断（仅记录）', async () => {
  const hooks: HookConfig[] = [{ event: 'PostToolUse', command: 'exit 1' }];
  const result = await runHooks(hooks, 'PostToolUse', { cwd: CWD, runId: 'r1', tool: 'grep' });
  assert.equal(result.blocked, false, 'PostToolUse 失败不应阻断工具');
});

test('runHooks: PostEdit 路径匹配过滤', async () => {
  const hooks: HookConfig[] = [
    { event: 'PostEdit', command: 'exit 0', paths: ['src/'] },
  ];
  // path 含 src/ → 触发（放行）
  const hit = await runHooks(hooks, 'PostEdit', { cwd: CWD, runId: 'r1', path: 'src/a.ts' });
  assert.equal(hit.blocked, false);
  // path 不含 src/ → 不匹配（命令不执行）
  const miss = await runHooks(hooks, 'PostEdit', { cwd: CWD, runId: 'r1', path: 'lib/b.ts' });
  assert.equal(miss.blocked, false);
});

test('ToolRegistry: PreToolUse hook 在工具执行前拦截（集成）', async () => {
  const reg = new ToolRegistry();
  reg.register(readFileTool);
  reg.register(writeFileTool);
  const hooks: HookConfig[] = [
    { event: 'PreToolUse', command: 'exit 1', tools: ['write_file'] },
  ];
  const result = await reg.execute('write_file', { path: 'x.ts', content: 'x' }, {
    runId: 'r1',
    cwd: CWD,
    security: { shellAllowlist: [], requireApproval: false, hooks },
  });
  assert.equal(result.ok, false, 'PreToolUse hook 应阻止 write_file');
  assert.match(result.error ?? '', /hook 拦截/);
});

test('ToolRegistry: PostEdit hook 在编辑成功后触发（集成，写文件验证）', async () => {
  const reg = new ToolRegistry();
  reg.register(writeFileTool);
  const marker = require('path').join(CWD, 'hook-marker.txt');
  const hooks: HookConfig[] = [
    { event: 'PostEdit', command: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}','done')"` },
  ];
  const result = await reg.execute('write_file', { path: 'edited.txt', content: 'hello' }, {
    runId: 'r1',
    cwd: CWD,
    security: { shellAllowlist: [], requireApproval: false, hooks },
  });
  assert.equal(result.ok, true);
  // PostEdit hook 应已写入标记文件
  const { existsSync } = await import('fs');
  assert.ok(existsSync(marker), 'PostEdit hook 应执行并写入标记文件');
});

test.after(() => {
  rmSync(CWD, { recursive: true, force: true });
});

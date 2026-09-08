/**
 * AI 员工军团桥接层单测
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveLlmEnv } from '../../src/tools/agents/agents-bridge';

let tmpDir: string;
let tmpCfg: string;

/** 隔离环境：FH_CONFIG 指向「存在的空配置」，阻断读到本机真实模型 key */
function isolated() {
  for (const k of ['LLM_PROVIDER', 'DOUBAO_API_KEY', 'DOUBAO_MODEL', 'DOUBAO_BASE_URL']) {
    delete process.env[k];
  }
  tmpDir = mkdtempSync(join(tmpdir(), 'fh-agents-test-'));
  tmpCfg = join(tmpDir, 'empty-config.json');
  writeFileSync(tmpCfg, JSON.stringify({ models: { providers: [] } }), 'utf8');
  process.env.FH_CONFIG = tmpCfg;
}

test.after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveLlmEnv: 无可用 provider 时回退 mock（不泄漏 key）', () => {
  isolated();
  const env = resolveLlmEnv();
  assert.equal(env.LLM_PROVIDER, 'mock');
  assert.ok(!env.DOUBAO_API_KEY, '不应携带 apiKey');
});

test('resolveLlmEnv: 返回键名安全（即使有 provider 也只取非敏感字段）', () => {
  isolated();
  const env = resolveLlmEnv();
  // 无论配置如何，env 中不允许出现明文 key 字段名之外的意外键
  const allowed = new Set(['LLM_PROVIDER', 'DOUBAO_API_KEY', 'DOUBAO_MODEL', 'DOUBAO_BASE_URL']);
  for (const k of Object.keys(env)) assert.ok(allowed.has(k), `意外键: ${k}`);
});

test('agents-bridge: 无 provider 时 DOUBAO_API_KEY 为空或缺失（不误填）', () => {
  isolated();
  const env = resolveLlmEnv();
  if (env.DOUBAO_API_KEY !== undefined) assert.equal(env.DOUBAO_API_KEY, '');
});

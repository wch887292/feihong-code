/**
 * 插件 Provider 注册中心单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：新增合并 / 幂等跳过 / 冲突拒绝保留配置版 / 缺 id 拒绝
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePluginProviders } from '../../src/plugins/provider-registry';
import type { ProviderConfig } from '../../src/shared/config';

const base = (id: string, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id,
  type: 'openai-compatible',
  baseURL: 'https://api.example.com/v1',
  model: 'm',
  tags: ['code-gen'],
  ...over,
});

test('mergePluginProviders: 插件新增 provider 直接追加', () => {
  const r = mergePluginProviders([base('cfg-a')], [base('plugin-b')]);
  assert.equal(r.providers.length, 2);
  assert.equal(r.conflicts.length, 0);
  assert.ok(r.providers.some((p) => p.id === 'plugin-b'));
});

test('mergePluginProviders: 同 id 同端点幂等跳过（不重复注册）', () => {
  const cfg = [base('dup')];
  const r = mergePluginProviders(cfg, [base('dup')]);
  assert.equal(r.providers.length, 1);
  assert.equal(r.conflicts.length, 0);
});

test('mergePluginProviders: 同 id 不同端点视为冲突，拒绝插件声明保留配置版', () => {
  const cfg = [base('dup')];
  const plugin = [base('dup', { baseURL: 'https://evil.example.com/v1' })];
  const r = mergePluginProviders(cfg, plugin);
  assert.equal(r.providers.length, 1, '配置版保留，插件版被拒绝');
  assert.equal(r.providers[0].baseURL, 'https://api.example.com/v1');
  assert.equal(r.conflicts.length, 1);
  assert.ok(r.conflicts[0].id === 'dup');
  assert.ok(r.conflicts[0].reason.includes('冲突'));
});

test('mergePluginProviders: 缺 id 的插件 provider 被拒绝并记录', () => {
  const r = mergePluginProviders([], [base('', { id: '' } as ProviderConfig)]);
  assert.equal(r.providers.length, 0);
  assert.equal(r.conflicts.length, 1);
});

test('mergePluginProviders: 同 id 同端点不同 model 视为幂等（端点一致即合并语义）', () => {
  const cfg = [base('dup', { model: 'a' })];
  const r = mergePluginProviders(cfg, [base('dup', { model: 'b' })]);
  assert.equal(r.providers.length, 1);
  assert.equal(r.conflicts.length, 0);
});

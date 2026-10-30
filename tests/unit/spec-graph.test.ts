/**
 * 飞虹 Code (对标 JetBrains ThinkRail · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * tests/unit/spec-graph.test.ts — SPEC 意图图谱单测
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { discoverSpecs, specGrep, specGraph, specValidate, specUpdate } from '../../src/agent/spec-graph.js';

const TEST_DIR = resolve('tests/unit/fixtures/spec-graph');

if (existsSync(TEST_DIR)) {
  rmSync(TEST_DIR, { recursive: true });
}
mkdirSync(TEST_DIR, { recursive: true });

const spec1 = `---
id: auth-module
parent: core
status: active
title: 认证模块
description: 用户登录与 token 管理
---

认证模块负责用户登录、token 生成与验证。`;

const spec2 = `---
id: user-service
parent: core
deps: [auth-module]
status: draft
title: 用户服务
---

用户服务提供 CRUD 接口。`;

const spec3 = `---
id: payment-gateway
status: deprecated
---

支付网关已废弃。`;

function seed() {
  mkdirSync(join(TEST_DIR, 'core'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'services', 'user'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'modules', 'payment'), { recursive: true });
  writeFileSync(join(TEST_DIR, 'core', 'SPEC.md'), spec1);
  writeFileSync(join(TEST_DIR, 'services', 'user', 'SPEC.md'), spec2);
  writeFileSync(join(TEST_DIR, 'modules', 'payment', 'SPEC.md'), spec3);
}

describe('spec-graph', () => {
  seed();

  it('discoverSpecs: 发现所有 SPEC.md 并构建图谱', () => {
    const { nodes } = discoverSpecs(TEST_DIR);
    assert.strictEqual(nodes.size, 3, '应发现 3 个 SPEC.md');
    assert.ok(nodes.has('auth-module'), '应包含 auth-module');
    assert.ok(nodes.has('user-service'), '应包含 user-service');
    assert.ok(nodes.has('payment-gateway'), '应包含 payment-gateway');

    const node = nodes.get('auth-module')!;
    assert.strictEqual(node.frontmatter.id, 'auth-module');
    assert.strictEqual(node.frontmatter.parent, 'core');
    assert.strictEqual(node.frontmatter.status, 'active');
    assert.strictEqual(node.frontmatter.title, '认证模块');
    assert.ok(node.body.includes('认证模块负责'));
  });

  it('specGrep: 关键词检索标题/正文/status', () => {
    const { nodes } = discoverSpecs(TEST_DIR);
    const res = specGrep(nodes, '登录');
    assert.ok(res.nodeIds.length > 0, '应命中至少一条');
    assert.ok(res.nodeIds.includes('auth-module'), '应命中 auth-module');
    assert.ok(res.hits.some((h) => h.nodeId === 'auth-module'));

    const draft = specGrep(nodes, 'draft');
    assert.ok(draft.nodeIds.includes('user-service'), '应命中 user-service');
  });

  it('specGraph: 输出父子 + 依赖关系树', () => {
    const { nodes } = discoverSpecs(TEST_DIR);
    const graph = specGraph(nodes);
    assert.ok(graph.includes('auth-module'), '图谱应包含 auth-module');
    assert.ok(graph.includes('user-service'), '图谱应包含 user-service');
    assert.ok(graph.includes('依赖'), '图谱应显示依赖关系');
  });

  it('specValidate: 校验 frontmatter 完整性（含缺失 parent 报错）', () => {
    const { nodes } = discoverSpecs(TEST_DIR);
    const issues = specValidate(nodes);
    // parent="core" 在图谱中不存在，应报出 parent 引用问题
    assert.ok(issues.some((i) => i.message.includes('parent')), '应检测到无效的 parent 引用');
    assert.ok(issues.some((i) => i.message.includes('core')), '应指出 core 不存在');
  });

  it('specUpdate: 更新元数据（节点存在）', () => {
    const res = specUpdate(TEST_DIR, { id: 'auth-module', updates: { status: 'archived' } });
    assert.ok(res.ok, res.message);
    const { nodes } = discoverSpecs(TEST_DIR);
    assert.strictEqual(nodes.get('auth-module')!.frontmatter.status, 'archived', 'status 应更新为 archived');
    // 恢复原值
    specUpdate(TEST_DIR, { id: 'auth-module', updates: { status: 'active' } });
  });

  it('specUpdate: 节点不存在时按 id 创建空骨架', () => {
    const newId = 'new-feature-' + Date.now();
    const res = specUpdate(TEST_DIR, { id: newId, updates: { title: '新功能' } });
    assert.ok(res.ok, res.message);
    const { nodes } = discoverSpecs(TEST_DIR);
    assert.ok(nodes.has(newId), '应创建新节点');
    assert.strictEqual(nodes.get(newId)!.frontmatter.title, '新功能');
    rmSync(join(TEST_DIR, 'specs', newId), { recursive: true, force: true });
  });

  it('纯函数性：同输入两次结果一致，无副作用', () => {
    const a = discoverSpecs(TEST_DIR);
    const b = discoverSpecs(TEST_DIR);
    assert.strictEqual(a.nodes.size, b.nodes.size);
    for (const id of a.nodes.keys()) {
      const n1 = a.nodes.get(id)!;
      const n2 = b.nodes.get(id)!;
      assert.strictEqual(n1.frontmatter.id, n2.frontmatter.id);
      assert.strictEqual(n1.frontmatter.status, n2.frontmatter.status);
    }
  });
});

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1 自我认知测试（T1.1-T1.4，共 8 用例）：tool-schema 自省 + 降级路径
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadToolSchema,
  capabilitiesFromSchema,
  capabilitiesFromRegistry,
  formatCapabilityLine,
  buildCapabilitySection,
  buildSystemPrompt,
} from '../../src/agent/self-awareness';
import { SYSTEM_PROMPT } from '../../src/agent/prompts';
import { ToolRegistry } from '../../src/tools/tool.registry';
import type { Tool } from '../../src/tools/tool.interface';
import { z } from 'zod';

/** 测试专用真实 schema 路径（npm test 固定以包根为 cwd） */
const realSchemaPath = join(process.cwd(), 'tool-schema.json');

// ---------- T1.1 schema 加载完整性 ----------

test('T1.1a 真实 tool-schema.json 加载：tools 非空且每项含非空 name', () => {
  const r = loadToolSchema(realSchemaPath);
  assert.strictEqual(r.ok, true);
  assert.ok(r.schema, '应返回 schema');
  assert.ok(r.schema!.tools.length > 0, 'tools 数组不应为空');
  for (const t of r.schema!.tools) {
    assert.strictEqual(typeof t.name, 'string');
    assert.ok(t.name.length > 0, '工具 name 不应为空');
  }
});

test('T1.1b 真实 schema 工具名唯一（重复名会让自省清单误导模型）', () => {
  const r = loadToolSchema(realSchemaPath);
  assert.strictEqual(r.ok, true);
  const names = r.schema!.tools.map((t) => t.name);
  assert.strictEqual(new Set(names).size, names.length, `存在重复工具名: ${names.join(',')}`);
});

// ---------- T1.2 system prompt 注入 ----------

test('T1.2a buildSystemPrompt 注入能力清单：含头部说明与真实工具名', () => {
  const r = buildSystemPrompt({ schemaPath: realSchemaPath });
  assert.strictEqual(r.introspected, true);
  assert.strictEqual(r.source, 'schema');
  assert.ok(r.prompt.includes('能力清单（共'), '应包含清单标题');
  assert.ok(r.prompt.includes('write_file'), '应包含真实工具名 write_file');
  assert.ok(r.prompt.includes('禁止编造不存在的工具'), '应包含自省纪律约束');
});

test('T1.2b 注入不破坏基础 prompt：以 SYSTEM_PROMPT 全文开头', () => {
  const r = buildSystemPrompt({ schemaPath: realSchemaPath });
  assert.ok(r.prompt.startsWith(SYSTEM_PROMPT), '基础 prompt 必须原样保留在前');
  assert.ok(r.prompt.length > SYSTEM_PROMPT.length, '注入后应长于基础 prompt');
});

// ---------- T1.3 自述构造 ----------

test('T1.3a 能力清单构造：每条目一行，含名称与描述摘要', () => {
  const entries = capabilitiesFromSchema({
    name: 'x',
    tools: [
      { name: 'write_file', description: '写入文件' },
      { name: 'run_shell', description: '执行命令' },
    ],
  });
  const section = buildCapabilitySection(entries);
  const lines = section.split('\n').filter((l) => l.startsWith('- '));
  assert.strictEqual(lines.length, 2, '每个工具恰好一行');
  assert.ok(lines[0].includes('write_file') && lines[0].includes('写入文件'));
  assert.ok(lines[1].includes('run_shell') && lines[1].includes('执行命令'));
});

test('T1.3b 长描述截断 80 字符且空白归一（防 prompt 膨胀）', () => {
  const line = formatCapabilityLine({ name: 'foo', description: `a\n b${'c'.repeat(200)}` });
  assert.strictEqual(line, '- foo：a b' + 'c'.repeat(77));
});

// ---------- T1.4 降级路径 ----------

test('T1.4a schema 文件不存在：降级回基础 prompt，不抛异常', () => {
  const r = buildSystemPrompt({ schemaPath: join(tmpdir(), 'fhcode-no-such-schema.json') });
  assert.strictEqual(r.introspected, false);
  assert.strictEqual(r.prompt, SYSTEM_PROMPT);
  assert.ok(r.error, '应携带错误说明');
});

test('T1.4b 损坏的 JSON：降级回基础 prompt，不抛异常', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-selfaware-'));
  const badPath = join(dir, 'bad-schema.json');
  writeFileSync(badPath, '{ this is not valid json !!', 'utf-8');
  try {
    const r = buildSystemPrompt({ schemaPath: badPath });
    assert.strictEqual(r.introspected, false);
    assert.strictEqual(r.prompt, SYSTEM_PROMPT);
    assert.ok(r.error, '应携带错误说明');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- 补充：运行时来源与开关（不计入 T1 矩阵，保障双来源契约） ----------

test('补充 registry 来源：优先于 schema 文件，且空清单降级', () => {
  const t = (name: string, description: string): Tool => ({
    name,
    description,
    jsonSchema: { type: 'object', properties: {} },
    schema: z.object({}),
    execute: async () => ({ ok: true, output: '' }),
  });
  const reg = new ToolRegistry();
  reg.register(t('alpha_tool', '测试工具甲'));
  const r = buildSystemPrompt({ registry: reg, schemaPath: realSchemaPath });
  assert.strictEqual(r.source, 'registry');
  assert.ok(r.prompt.includes('alpha_tool'));
  assert.ok(!r.prompt.includes('write_file'), 'registry 来源时不应混入 schema 清单');

  const empty = buildSystemPrompt({ registry: new ToolRegistry() });
  assert.strictEqual(empty.introspected, false, '空清单应降级');
});

test('补充 disable 开关：显式关闭后与现状行为一致', () => {
  const r = buildSystemPrompt({ disable: true });
  assert.strictEqual(r.introspected, false);
  assert.strictEqual(r.prompt, SYSTEM_PROMPT);
});

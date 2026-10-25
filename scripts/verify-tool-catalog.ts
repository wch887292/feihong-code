/**
 * 飞虹 Code — 工具目录一致性校验
 *
 * 背景（对标 Today 桌面端的 tool-manifest-identity）：
 * Today 在 resources/tool-manifest-identity.json 里用 `toolCount + catalogVersion(sha256) + sourceRevision`
 * 三件套锁定"当前客户端到底暴露了哪些工具"，任何工具增减或 JSON Schema 变更都会改变指纹，
 * 从而在打包/联调阶段立刻暴露漂移，而不是等模型调用一个不存在的工具才报错。
 *
 * fhcode 之前只有 tool-schema.json 这一份产物，且长期停留在 8.5.0 / 21 个工具（运行时已 22 个），
 * 属于"文档与代码两套事实"。本脚本把校验固化进 npm run verify，漂移即阻塞。
 *
 * 校验项：
 *   1. tool-schema.json 的 version     === package.json version
 *   2. tool-schema.json 的 toolCount   === 运行时注册表工具数
 *   3. tool-schema.json 的 catalogVersion === 运行时重新计算的 sha256
 *   4. 工具名集合完全一致（超出只比数量，能定位到具体工具）
 *
 * 用法：npx tsx scripts/verify-tool-catalog.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { createDefaultRegistry } from '../src/tools';

type ToolEntry = { name: string; description: string; parameters: unknown };
type ToolSchema = {
  version: string;
  catalogVersion?: string;
  toolCount: number;
  tools: ToolEntry[];
};

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { version: string };
const schema = JSON.parse(readFileSync(join(root, 'tool-schema.json'), 'utf-8')) as ToolSchema;

const defs = createDefaultRegistry().definitions();
const tools: ToolEntry[] = defs.map((d) => ({
  name: d.name,
  description: d.description,
  parameters: d.parameters,
}));

const canonical = tools
  .map((t) => [t.name, t.parameters])
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
const catalogVersion = 'sha256:' + createHash('sha256').update(JSON.stringify(canonical)).digest('hex');

const errors: string[] = [];

if (schema.version !== pkg.version) {
  errors.push(`tool-schema.json version=${schema.version} != package.json ${pkg.version}`);
}
if (schema.toolCount !== tools.length) {
  errors.push(`tool-schema.json toolCount=${schema.toolCount} != 运行时 ${tools.length}`);
}
if (!schema.catalogVersion) {
  errors.push('tool-schema.json 缺少 catalogVersion 字段（请重新生成）');
} else if (schema.catalogVersion !== catalogVersion) {
  errors.push(`tool-schema.json catalogVersion=${schema.catalogVersion} != 运行时 ${catalogVersion}`);
}

const declared = new Set(schema.tools.map((t) => t.name));
const actual = new Set(tools.map((t) => t.name));
const missing = [...actual].filter((n) => !declared.has(n));
const extra = [...declared].filter((n) => !actual.has(n));
if (missing.length) errors.push(`tool-schema.json 缺少工具: ${missing.join(', ')}`);
if (extra.length) errors.push(`tool-schema.json 多出工具（注册表已无）: ${extra.join(', ')}`);

if (errors.length) {
  console.error('✗ 工具目录校验失败（阻塞）:');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\n修复: npx tsx scripts/gen-tool-schema.ts');
  process.exit(1);
}

console.log(
  `✓ 工具目录一致：${tools.length} 个工具 · ${catalogVersion.slice(0, 19)}… · v${pkg.version}`,
);

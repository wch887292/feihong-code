/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 从运行时 ToolRegistry 生成 tool-schema.json（v8.6.0 P1 配套修复）。
 * 背景：原 tool-schema.json 编码损坏（UTF-8→GBK 乱码 + 引号被吞，JSON 不合法），
 * 本脚本确立「代码为单一事实源」：schema 一律由 createDefaultRegistry() 生成，
 * 不再手写，杜绝编码漂移与版本漂移。
 *
 * 用法：npx tsx scripts/gen-tool-schema.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { createDefaultRegistry } from '../src/tools';

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
  name: string;
  version: string;
  description: string;
};

const reg = createDefaultRegistry();
const defs = reg.definitions();

const tools = defs.map((d) => ({
  name: d.name,
  description: d.description,
  parameters: d.parameters,
}));

/** 工具目录指纹：对「工具名 + 入参 schema」的稳定序列化结果做 sha256。
 *  对齐 Today 桌面端的 tool-manifest-identity.catalogVersion，
 *  用于校验客户端/服务端工具目录是否漂移，而不是只比对数量。 */
const canonical = tools
  .map((t) => [t.name, t.parameters])
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
const catalogVersion = 'sha256:' + createHash('sha256').update(JSON.stringify(canonical)).digest('hex');

let sourceRevision = 'unknown';
try {
  sourceRevision = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  /* 非 git 环境（npm 包解压目录）时降级为 unknown，不阻塞生成 */
}

const schema = {
  name: pkg.name,
  version: pkg.version,
  description: 'Terminal AI Coding Agent — 终端 AI 编程智能体（由 scripts/gen-tool-schema.ts 从运行时工具注册表自动生成）',
  generatedAt: new Date().toISOString().slice(0, 10),
  sourceRevision,
  catalogVersion,
  toolCount: tools.length,
  tools,
};

const out = join(root, 'tool-schema.json');
const outArg = process.argv.find((a) => a.startsWith('--out='));
if (process.argv.includes('--stdout')) {
  process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
  process.exit(0);
}
if (outArg) {
  writeFileSync(outArg.slice('--out='.length), JSON.stringify(schema, null, 2) + '\n', 'utf-8');
  process.exit(0);
}
writeFileSync(out, JSON.stringify(schema, null, 2) + '\n', 'utf-8');

// 写入后回读自校验，确保产物永远合法
const verify = JSON.parse(readFileSync(out, 'utf-8')) as { tools: unknown[] };
if (!Array.isArray(verify.tools) || verify.tools.length !== defs.length) {
  throw new Error('生成后自校验失败：tools 数量不一致');
}
console.log(`tool-schema.json 已生成：${verify.tools.length} 个工具，版本 ${pkg.version}，UTF-8 合法 JSON`);

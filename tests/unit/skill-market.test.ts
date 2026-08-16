/**
 * Skills 市场模块单元测试
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 覆盖：fetchMarketIndex 解析（本地 mock 服务器）/
 *       schema 兼容判定 / 搜索评分排序 / URL 解析（绝对/根相对/相对）/
 *       digest 校验 / skill-md 安装 / tar.gz 归档安装与路径穿越防护 /
 *       未知 schema 告警路径
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import {
  fetchMarketIndex,
  isSchemaSupported,
  searchMarket,
  resolveSkillUrl,
  sha256Hex,
  verifyDigest,
  installMarketSkill,
  unpackTarGz,
  WELL_KNOWN_PATH,
  type MarketIndex,
} from '../../src/skills/skill-market';

/** 构造一个 tar.gz 缓冲区（手写 tar 头，供安装测试） */
function makeTarGz(files: Array<{ name: string; content: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const content = Buffer.from(f.content, 'utf8');
    const header = Buffer.alloc(512);
    nameBuf.copy(header, 0, 0, Math.min(nameBuf.length, 100));
    header.write('0000644', 100, 7, 'utf8'); // mode
    header.write('0000000', 108, 7, 'utf8'); // uid
    header.write('0000000', 116, 7, 'utf8'); // gid
    header.write(content.length.toString(8).padStart(11, '0'), 124, 12, 'utf8'); // size（八进制）
    header.write('00000000000', 136, 12, 'utf8'); // mtime
    header[156] = '0'.charCodeAt(0); // type: regular file
    header.write('ustar', 257, 5, 'utf8');
    header.write('00', 263, 2, 'utf8');
    // checksum（octal 6 位 + nul + space）
    header.write('        ', 148, 8, 'utf8');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0'), 148, 6, 'utf8');
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header);
    blocks.push(content);
    // 填充到 512 边界
    const pad = 512 - (content.length % 512 || 512);
    if (pad > 0 && pad < 512) blocks.push(Buffer.alloc(pad));
  }
  // 结束块（两个 512 零块）
  blocks.push(Buffer.alloc(512));
  blocks.push(Buffer.alloc(512));
  return gzipSync(Buffer.concat(blocks));
}

let server: Server;
let baseUrl = '';
const SKILL_MD = '---\nname: demo\n---\n演示技能指令\n';

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url === WELL_KNOWN_PATH) {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
          skills: [
            { name: 'code-review', type: 'skill-md', description: '代码审查', url: '/.well-known/agent-skills/code-review/SKILL.md' },
            { name: 'pdf', type: 'archive', description: 'PDF 处理', url: '/.well-known/agent-skills/pdf.tar.gz' },
            { name: 'junk', type: 'skill-md', description: '测试 digest 校验', url: '/.well-known/agent-skills/junk/SKILL.md' },
          ],
        }),
      );
    } else if (url.startsWith('/.well-known/agent-skills/code-review/SKILL.md')) {
      res.setHeader('Content-Type', 'text/markdown');
      res.end(SKILL_MD);
    } else if (url.startsWith('/.well-known/agent-skills/pdf.tar.gz')) {
      const tar = makeTarGz([
        { name: 'SKILL.md', content: '---\nname: pdf\n---\nPDF 技能\n' },
        { name: 'scripts/parse.js', content: 'console.log("parse")' },
      ]);
      res.setHeader('Content-Type', 'application/gzip');
      res.end(tar);
    } else if (url.startsWith('/.well-known/agent-skills/junk/SKILL.md')) {
      res.setHeader('Content-Type', 'text/markdown');
      res.end('---\nname: junk\n---\n被篡改内容\n');
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

test('fetchMarketIndex: 拉取并解析 well-known 索引', async () => {
  const index = await fetchMarketIndex(baseUrl);
  assert.equal(index.skills.length, 3);
  assert.ok(index.skills.some((s) => s.name === 'code-review'));
  assert.equal(index.source, baseUrl + WELL_KNOWN_PATH);
});

test('isSchemaSupported: 0.2.0/0.1.0 兼容，未知告警', () => {
  assert.equal(isSchemaSupported('https://schemas.agentskills.io/discovery/0.2.0/schema.json'), true);
  assert.equal(isSchemaSupported('https://schemas.agentskills.io/discovery/0.1.0/schema.json'), true);
  assert.equal(isSchemaSupported(undefined), true, '无 schema 视为 0.1.0');
  assert.equal(isSchemaSupported('https://evil.example/schema.json'), false);
});

test('searchMarket: 名称精确 > 前缀 > 包含 > 描述匹配', async () => {
  const index: MarketIndex = {
    source: baseUrl,
    skills: [
      { name: 'code-review', type: 'skill-md', description: 'review code' },
      { name: 'code-gen', type: 'skill-md', description: 'generate code' },
      { name: 'pdf-parse', type: 'skill-md', description: 'parse pdf files with code' },
    ],
  };
  const r = searchMarket(index, 'code');
  assert.equal(r[0].name, 'code-gen', '前缀匹配应排最前');
  assert.ok(r.some((s) => s.name === 'code-review'));
  assert.ok(r.some((s) => s.name === 'pdf-parse'));
  assert.equal(searchMarket(index, '').length, 3, '空查询返回全部');
});

test('resolveSkillUrl: 绝对 / 根相对 / 相对 三种形态', async () => {
  const index: MarketIndex = { source: `${baseUrl}${WELL_KNOWN_PATH}`, skills: [] };
  assert.equal(resolveSkillUrl(index, { name: 'a', type: 'skill-md', description: '', url: 'https://cdn.example.com/x' }), 'https://cdn.example.com/x');
  assert.equal(resolveSkillUrl(index, { name: 'a', type: 'skill-md', description: '', url: '/.well-known/agent-skills/a/SKILL.md' }), `${baseUrl}/.well-known/agent-skills/a/SKILL.md`);
  assert.equal(resolveSkillUrl(index, { name: 'a', type: 'skill-md', description: '', url: 'b/SKILL.md' }), `${baseUrl}/.well-known/agent-skills/b/SKILL.md`);
});

test('verifyDigest: sha256 匹配通过，不匹配拒绝，无 digest 放行', () => {
  const buf = Buffer.from('hello');
  const good = `sha256:${sha256Hex(buf)}`;
  assert.equal(verifyDigest(buf, good), true);
  assert.equal(verifyDigest(buf, 'sha256:' + '0'.repeat(64)), false);
  assert.equal(verifyDigest(buf, undefined), true);
  assert.equal(verifyDigest(buf, 'md5:abc'), false, '非 sha256 格式拒绝');
});

test('installMarketSkill: skill-md 安装到目标目录', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'fhcode-mkt-'));
  try {
    const index = await fetchMarketIndex(baseUrl);
    const skill = index.skills.find((s) => s.name === 'code-review')!;
    const target = await installMarketSkill(index, skill, dest);
    assert.equal(existsSync(join(target, 'SKILL.md')), true);
    assert.match(readFileSync(join(target, 'SKILL.md'), 'utf8'), /name: demo/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test('installMarketSkill: archive 解包（含 scripts 子目录）', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'fhcode-mkt-'));
  try {
    const index = await fetchMarketIndex(baseUrl);
    const skill = index.skills.find((s) => s.name === 'pdf')!;
    const target = await installMarketSkill(index, skill, dest);
    assert.equal(existsSync(join(target, 'SKILL.md')), true);
    assert.equal(existsSync(join(target, 'scripts', 'parse.js')), true);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test('installMarketSkill: digest 不匹配拒绝安装', async () => {
  const dest = mkdtempSync(join(tmpdir(), 'fhcode-mkt-'));
  try {
    const index = await fetchMarketIndex(baseUrl);
    const skill = index.skills.find((s) => s.name === 'code-review')!;
    await assert.rejects(
      () => installMarketSkill(index, { ...skill, digest: 'sha256:' + '0'.repeat(64) }, dest),
      /digest 校验失败/,
    );
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test('unpackTarGz: 路径穿越项被丢弃', () => {
  const dest = mkdtempSync(join(tmpdir(), 'fhcode-mkt-'));
  try {
    const tar = makeTarGz([
      { name: '../evil.txt', content: 'pwn' },
      { name: 'safe.txt', content: 'ok' },
    ]);
    unpackTarGz(tar, dest);
    assert.equal(existsSync(join(dest, 'safe.txt')), true);
    assert.equal(existsSync(join(dest, '..', 'evil.txt')), false, '路径穿越应被拦截');
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

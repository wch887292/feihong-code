/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Skills 市场对接（agentskills.io discovery index 规范 0.2.0）：
 *  - 市场源 = 任意站点，暴露 `/.well-known/agent-skills/index.json`
 *  - 索引条目：{ name, type: "skill-md"|"archive", description, url, digest }
 *  - skill-md 直接下载 SKILL.md；archive 下载后校验 digest 并解包（零依赖手写 tar.gz）
 *  - 渐进式披露：发现只取 name/description，安装才下载完整技能
 *  - 未知 $schema 告警跳过；digest 不匹配拒绝安装（防投毒）
 *
 * 设计：零第三方依赖（全局 fetch + zlib + 手写 tar 解析），离线/内网可自建市场源。
 */
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

/** 发现索引的 well-known 路径 */
export const WELL_KNOWN_PATH = '/.well-known/agent-skills/index.json';
/** 当前支持的 schema 版本 */
const SUPPORTED_SCHEMAS = [
  'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  'https://schemas.agentskills.io/discovery/0.1.0/schema.json',
];

export interface MarketSkill {
  name: string;
  type: 'skill-md' | 'archive' | string;
  description: string;
  url: string;
  digest?: string;
}

export interface MarketIndex {
  schema?: string;
  skills: MarketSkill[];
  /** 索引来源 URL（相对 url 解析基址） */
  source: string;
}

/** 抓取并解析市场索引（未知 $schema 告警但返回，由调用方决定） */
export async function fetchMarketIndex(marketBaseUrl: string): Promise<MarketIndex> {
  // 本地种子市场源：local:<name> → 读取 templates/market/<name>-index.json（离线可用，零网络）
  if (marketBaseUrl.startsWith('local:')) {
    const name = marketBaseUrl.slice('local:'.length).trim() || 'index';
    const seedPath = join(__dirname, '../../templates/market', `${name}-index.json`);
    if (!existsSync(seedPath)) throw new Error(`本地市场源不存在：${seedPath}`);
    const parsed: { $schema?: string; skills?: unknown[] } = JSON.parse(readFileSync(seedPath, 'utf8'));
    const skills: MarketSkill[] = Array.isArray(parsed.skills)
      ? parsed.skills.filter(
          (s): s is MarketSkill =>
            !!s && typeof s === 'object' && typeof (s as MarketSkill).name === 'string' && typeof (s as MarketSkill).url === 'string',
        )
      : [];
    return { schema: parsed.$schema, skills, source: `local:${name}` };
  }
  const base = marketBaseUrl.replace(/\/+$/, '');
  const indexUrl = base + WELL_KNOWN_PATH;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let raw: string;
  try {
    const res = await fetch(indexUrl, { signal: controller.signal, headers: { 'User-Agent': 'fhcode/0.4' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}（${indexUrl}）`);
    raw = await res.text();
  } finally {
    clearTimeout(timer);
  }
  let parsed: { $schema?: string; skills?: unknown[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('市场索引不是合法 JSON');
  }
  const skills: MarketSkill[] = Array.isArray(parsed.skills)
    ? parsed.skills.filter(
        (s): s is MarketSkill =>
          !!s && typeof s === 'object' && typeof (s as MarketSkill).name === 'string' && typeof (s as MarketSkill).url === 'string',
      )
    : [];
  return { schema: parsed.$schema, skills, source: indexUrl };
}

/** 是否兼容当前实现（未知 schema 返回 false，调用方告警） */
export function isSchemaSupported(schema?: string): boolean {
  if (!schema) return true; // 无 schema 视为 0.1.0
  return SUPPORTED_SCHEMAS.includes(schema);
}

/** 按 RFC 3986 把条目 url 解析为绝对地址（相对索引源） */
export function resolveSkillUrl(index: MarketIndex, skill: MarketSkill): string {
  const base = index.source;
  const url = skill.url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) {
    const u = new URL(base);
    return u.origin + url;
  }
  // 相对：基于索引 URL 目录
  const slash = base.lastIndexOf('/');
  return base.slice(0, slash + 1) + url;
}

/** 在索引中按关键词搜索（name 精确/前缀优先，description 包含） */
export function searchMarket(index: MarketIndex, query: string, limit = 10): MarketSkill[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.skills.slice(0, limit);
  const scored = index.skills
    .map((s) => {
      const name = s.name.toLowerCase();
      const desc = s.description.toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 60;
      else if (name.includes(q)) score = 40;
      else if (desc.includes(q)) score = 20;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    // 同分按名称升序（确定性排序，避免依赖插入序）
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((x) => x.s);
}

/** 计算字节流的 sha256（digest 校验） */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 校验 digest（格式 sha256:<hex>）；无 digest 跳过 */
export function verifyDigest(buf: Buffer, digest?: string): boolean {
  if (!digest) return true;
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest);
  if (!m) return false;
  return sha256Hex(buf) === m[1].toLowerCase();
}

async function download(url: string, timeoutMs = 30000): Promise<Buffer> {
  // 首选 Node 原生 fetch（零依赖）；失败时回退 curl 子进程——
  // 部分受限网络下 Node undici 连接 raw.githubusercontent 会超时/被重置，而 curl 走系统栈可通。
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'fhcode/0.4' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  } catch (fetchErr) {
    try {
      return await downloadViaCurl(url, timeoutMs);
    } catch {
      throw fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
    }
  }
}

/** curl 子进程下载（回退通道）：-sL 跟随重定向，--max-time 超时，输出到临时文件后读回 */
async function downloadViaCurl(url: string, timeoutMs: number): Promise<Buffer> {
  const { execFile } = await import('child_process');
  const { tmpdir } = await import('os');
  const { mkdtempSync, readFileSync, rmSync } = await import('fs');
  const { join } = await import('path');
  const { randomUUID } = await import('crypto');
  const dir = mkdtempSync(join(tmpdir(), 'fhcode-dl-'));
  const out = join(dir, randomUUID() + '.bin');
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'curl',
        ['-sL', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-o', out, url],
        { timeout: timeoutMs + 5000 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 手写 tar.gz 解包（零依赖）：仅提取普通文件，忽略符号链接/设备/目录项 */
export function unpackTarGz(buf: Buffer, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const tar = gunzipSync(buf); // 先解 gzip
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    // 全零块 = 结束
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeField, 8) || 0;
    const type = String.fromCharCode(header[156] || 0);
    const fileData = tar.subarray(offset + 512, offset + 512 + size);
    // '0' 或 '\0' = 普通文件
    if ((type === '0' || type === '\0') && name && !name.endsWith('/')) {
      // 防路径穿越
      const safeName = name.replace(/^\/+/, '');
      if (!safeName.includes('..')) {
        const out = join(destDir, safeName);
        mkdirSync(resolve(out, '..'), { recursive: true });
        writeFileSync(out, fileData);
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

/** 安装一个市场技能到本地技能目录（返回安装路径） */
export async function installMarketSkill(
  market: MarketIndex,
  skill: MarketSkill,
  destDir: string,
): Promise<string> {
  const target = join(destDir, skill.name);
  const url = resolveSkillUrl(market, skill);
  const buf = await download(url);

  if (!verifyDigest(buf, skill.digest)) {
    throw new Error(`技能 ${skill.name} 的 digest 校验失败（可能被篡改），已拒绝安装`);
  }

  if (skill.type === 'archive') {
    // 支持 .tar.gz / .tgz；其它格式报错（zip 等后续）
    if (/\.(tar\.gz|tgz)$/i.test(url)) {
      unpackTarGz(buf, target);
      if (!existsSync(join(target, 'SKILL.md'))) {
        throw new Error(`技能 ${skill.name} 的归档缺少 SKILL.md`);
      }
    } else {
      throw new Error(`暂不支持该归档格式（${url.split('.').pop()}），仅支持 .tar.gz/.tgz`);
    }
  } else {
    // skill-md：直接写 SKILL.md
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), buf);
  }
  // 基本校验：SKILL.md 存在且含 name frontmatter
  const md = readFileSync(join(target, 'SKILL.md'), 'utf8');
  if (!/^\s*---[\s\S]*?name\s*:/m.test(md)) {
    throw new Error(`技能 ${skill.name} 的 SKILL.md 缺少 name frontmatter，已拒绝`);
  }
  return target;
}

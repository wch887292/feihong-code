/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 凭据引用机制（对标 DeepSeek Harness credentials seam）：
 *  - 配置文件只写"引用名"（apiKeyEnv），不落明文密钥
 *  - 密钥存 $FH_HOME/.credentials.json（version 1 + refs 映射）
 *    （POSIX 平台建议 chmod 600；Windows 依赖用户目录 ACL，代码不强制改权限）
 *  - 解析优先级：凭据存储 → 进程环境变量 → .env（loadDotEnv 已注入 process.env）
 *  - 引用名必须是 POSIX 标识符（/^[A-Za-z_][A-Za-z0-9_]*$/），与 dsh 的 CredentialRef 文法一致
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveHomeDir } from '../shared/config';

export const CREDENTIALS_FILENAME = '.credentials.json';

/** 引用名文法（与 dsh CredentialRef 一致：POSIX shell 标识符） */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 凭据文档结构 */
export interface CredentialsDocument {
  version: number;
  refs: Record<string, string>;
}

export function isCredentialRefName(value: string): boolean {
  return REF_PATTERN.test(value);
}

/** 凭据文件路径（缺省 $FH_HOME/.credentials.json） */
export function credentialsPath(homeDir = resolveHomeDir()): string {
  return join(homeDir, CREDENTIALS_FILENAME);
}

/** 解析凭据文档；缺失/损坏返回空文档（损坏时保留备份避免覆盖） */
export function loadCredentialsDocument(homeDir = resolveHomeDir()): CredentialsDocument {
  const file = credentialsPath(homeDir);
  if (!existsSync(file)) return { version: 1, refs: {} };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as CredentialsDocument;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { version: 1, refs: {} };
    return { version: 1, refs: typeof raw.refs === 'object' && raw.refs !== null ? (raw.refs as Record<string, string>) : {} };
  } catch {
    return { version: 1, refs: {} };
  }
}

/**
 * 解析单个凭据引用（不抛错，未配置返回 undefined）：
 *   1) $FH_HOME/.credentials.json refs
 *   2) 进程环境变量（loadDotEnv 已把 cwd/.env 注入 process.env，天然覆盖）
 * 空字符串视为未配置。
 */
export function resolveCredential(ref: string, homeDir = resolveHomeDir()): string | undefined {
  if (!isCredentialRefName(ref)) return undefined;
  const stored = loadCredentialsDocument(homeDir).refs[ref];
  if (typeof stored === 'string' && stored.length > 0) return stored;
  const env = process.env[ref];
  if (typeof env === 'string' && env.length > 0) return env;
  return undefined;
}

/**
 * 按 provider 配置解析实际密钥：apiKeyEnv 优先（seam 解析），
 * 未配置时回退旧 apiKey 字段（兼容存量配置，迁移后不再需要）。
 */
export function resolveProviderApiKey(
  cfg: { apiKeyEnv?: string; apiKey?: string },
  homeDir = resolveHomeDir(),
): string | undefined {
  if (cfg.apiKeyEnv) {
    const resolved = resolveCredential(cfg.apiKeyEnv, homeDir);
    if (resolved !== undefined) return resolved;
    // 引用存在但解析为空：按未配置处理（上游会以 401 拒绝并给出明确报错）
    return undefined;
  }
  return cfg.apiKey;
}

/** 原子写凭据文档：先写临时文件再 rename，避免半截文件；旧文件先备份 */
function writeCredentialsDocument(doc: CredentialsDocument, homeDir: string): void {
  mkdirSync(homeDir, { recursive: true });
  const file = credentialsPath(homeDir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify({ version: 1, refs: doc.refs }, null, 2) + '\n', 'utf8');
  if (existsSync(file)) {
    try {
      renameSync(file, `${file}.bak-${Date.now()}`);
    } catch {
      /* 备份失败不阻断写入（原文件将被替换） */
    }
  }
  renameSync(tmp, file);
}

/** 存储一个引用值（非空；空值请用 unset） */
export function setCredential(ref: string, value: string, homeDir = resolveHomeDir()): void {
  if (!isCredentialRefName(ref)) throw new Error(`凭据引用名非法（需 POSIX 标识符）: ${ref}`);
  if (typeof value !== 'string' || value.length === 0) throw new Error(`凭据值不能为空: ${ref}`);
  const doc = loadCredentialsDocument(homeDir);
  doc.refs[ref] = value;
  writeCredentialsDocument(doc, homeDir);
}

/** 移除一个引用（不存在的引用为 no-op） */
export function unsetCredential(ref: string, homeDir = resolveHomeDir()): boolean {
  if (!isCredentialRefName(ref)) return false;
  const doc = loadCredentialsDocument(homeDir);
  if (!(ref in doc.refs)) return false;
  delete doc.refs[ref];
  writeCredentialsDocument(doc, homeDir);
  return true;
}

/**
 * 列出全部已配置引用（只暴露引用名与存储/环境状态，绝不暴露值）。
 * 只列「本工具会解析」的引用：凭据存储中的全部引用 + 环境变量中 FH_/FHC_ 前缀的显式配置，
 * 避免把系统几十个无关环境变量刷屏。
 */
export function listCredentials(homeDir = resolveHomeDir()): Array<{ ref: string; stored: boolean; env: boolean }> {
  const stored = loadCredentialsDocument(homeDir).refs;
  const envRefs = Object.keys(process.env).filter(
    (k) => isCredentialRefName(k) && /^(FH_|FHC_)/.test(k) && typeof process.env[k] === 'string' && process.env[k].length > 0,
  );
  const refs = new Set<string>([...Object.keys(stored), ...envRefs]);
  return [...refs]
    .sort()
    .map((ref) => ({ ref, stored: ref in stored, env: envRefs.includes(ref) }));
}

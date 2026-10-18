/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 凭据引用机制（对标 DeepSeek Harness credentials seam / Codex secrets scope）：
 *  - 配置文件只写"引用名"（apiKeyEnv），不落明文密钥
 *  - 密钥存 <账号目录>/.credentials.json
 *    （POSIX 平台建议 chmod 600；Windows 依赖用户目录 ACL，代码不强制改权限）
 *  - v2 文档：scopes{ global, env:<scope> }——全局 + 项目/环境级作用域（对标 Codex SecretScope）
 *    v1 文档（refs 顶层）自动迁移为 global 作用域，向后兼容
 *  - 账号隔离：默认存储目录为 resolveAccountHome()（激活手机号 → 该账号目录），每手机号独立凭据
 *  - 解析优先级：凭据存储（环境作用域 → 全局）→ 进程环境变量 → .env（loadDotEnv 已注入 process.env）
 *  - 引用名必须是 POSIX 标识符（/^[A-Za-z_][A-Za-z0-9_]*$/），与 dsh 的 CredentialRef 文法一致
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveAccountHome } from './account';
import { deriveProjectId } from '../shared/project-env';

export const CREDENTIALS_FILENAME = '.credentials.json';
export const CREDENTIALS_VERSION = 2;

/** 引用名文法（与 dsh CredentialRef 一致：POSIX shell 标识符） */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 环境作用域名文法（与租户/账号 id 一致：字母数字 . _ -） */
const SCOPE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** 显式作用域引用语法：env:<scope>/<REF> */
const SCOPED_REF_PATTERN = /^env:([A-Za-z0-9._-]{1,64})\/([A-Za-z_][A-Za-z0-9_]*)$/;

/** 凭据文档结构（v2：scopes{global, env}；兼容 v1 refs） */
export interface CredentialsDocument {
  version: number;
  /** v2 作用域存储 */
  scopes?: {
    global: Record<string, string>;
    env: Record<string, Record<string, string>>;
  };
  /** v1 兼容字段（读取时迁移进 global） */
  refs?: Record<string, string>;
}

export function isCredentialRefName(value: string): boolean {
  return REF_PATTERN.test(value);
}

export function isValidCredentialScope(value: string): boolean {
  return SCOPE_PATTERN.test(value);
}

/** 凭据文件路径（缺省 <账号目录>/.credentials.json，账号隔离） */
export function credentialsPath(homeDir = resolveAccountHome()): string {
  return join(homeDir, CREDENTIALS_FILENAME);
}

/** 解析凭据文档；缺失/损坏返回空文档（损坏时保留备份避免覆盖）；v1 自动归一为 v2 */
export function loadCredentialsDocument(homeDir = resolveAccountHome()): CredentialsDocument {
  const file = credentialsPath(homeDir);
  if (!existsSync(file)) return { version: CREDENTIALS_VERSION, scopes: { global: {}, env: {} } };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as CredentialsDocument;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { version: CREDENTIALS_VERSION, scopes: { global: {}, env: {} } };
    }
    // v1 → v2 迁移：顶层 refs 归入 global 作用域
    if (raw.version !== CREDENTIALS_VERSION || !raw.scopes) {
      const global = (raw.refs ?? {}) as Record<string, string>;
      return { version: CREDENTIALS_VERSION, scopes: { global, env: {} } };
    }
    return {
      version: CREDENTIALS_VERSION,
      scopes: {
        global: (raw.scopes.global ?? {}) as Record<string, string>,
        env: (raw.scopes.env ?? {}) as Record<string, Record<string, string>>,
      },
    };
  } catch {
    return { version: CREDENTIALS_VERSION, scopes: { global: {}, env: {} } };
  }
}

/** 作用域引用 → {scope, ref}；裸引用 → 项目作用域（自动派生）再回退全局 */
function parseRef(ref: string): { scope?: string; name: string } {
  const m = SCOPED_REF_PATTERN.exec(ref);
  if (m) return { scope: m[1], name: m[2] };
  return { name: ref };
}

/**
 * 解析单个凭据引用（不抛错，未配置返回 undefined）：
 *   1) 显式 env:<scope>/REF → scopes.env[scope]
 *   2) 裸 REF → 当前项目作用域（deriveProjectId，对标 Codex environment_id_from_cwd）→ 全局
 *   3) 进程环境变量（loadDotEnv 已把 cwd/.env 注入 process.env，天然覆盖）
 * 空字符串视为未配置。
 */
export function resolveCredential(ref: string, homeDir = resolveAccountHome(), cwd = process.cwd()): string | undefined {
  const { scope, name } = parseRef(ref);
  if (!isCredentialRefName(name)) return undefined;
  const doc = loadCredentialsDocument(homeDir);

  if (scope !== undefined) {
    const envScope = doc.scopes?.env?.[scope];
    if (envScope && typeof envScope[name] === 'string' && envScope[name].length > 0) return envScope[name];
    return undefined; // 显式作用域不命中时不回退全局（避免跨环境误用）
  }

  // 裸引用：项目作用域 → 全局
  const projectId = deriveProjectId(cwd);
  const projectScope = doc.scopes?.env?.[projectId];
  if (projectScope && typeof projectScope[name] === 'string' && projectScope[name].length > 0) {
    return projectScope[name];
  }
  const global = doc.scopes?.global?.[name];
  if (typeof global === 'string' && global.length > 0) return global;

  const env = process.env[name];
  if (typeof env === 'string' && env.length > 0) return env;
  return undefined;
}

/**
 * 按 provider 配置解析实际密钥：apiKeyEnv 优先（seam 解析），
 * 未配置时回退旧 apiKey 字段（兼容存量配置，迁移后不再需要）。
 */
export function resolveProviderApiKey(
  cfg: { apiKeyEnv?: string; apiKey?: string },
  homeDir = resolveAccountHome(),
  cwd = process.cwd(),
): string | undefined {
  if (cfg.apiKeyEnv) {
    const resolved = resolveCredential(cfg.apiKeyEnv, homeDir, cwd);
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
  writeFileSync(tmp, JSON.stringify({ version: CREDENTIALS_VERSION, scopes: doc.scopes }, null, 2) + '\n', 'utf8');
  if (existsSync(file)) {
    try {
      renameSync(file, `${file}.bak-${Date.now()}`);
    } catch {
      /* 备份失败不阻断写入（原文件将被替换） */
    }
  }
  renameSync(tmp, file);
}

/** 存储一个引用值（非空；空值请用 unset）；scope 缺省 = global */
export function setCredential(ref: string, value: string, scope?: string, homeDir = resolveAccountHome()): void {
  if (!isCredentialRefName(ref)) throw new Error(`凭据引用名非法（需 POSIX 标识符）: ${ref}`);
  if (scope !== undefined && !isValidCredentialScope(scope)) {
    throw new Error(`凭据作用域非法（仅字母数字 . _ -，1-64 位）: ${scope}`);
  }
  if (typeof value !== 'string' || value.length === 0) throw new Error(`凭据值不能为空: ${ref}`);
  const doc = loadCredentialsDocument(homeDir);
  if (scope === undefined) {
    doc.scopes!.global[ref] = value;
  } else {
    if (!doc.scopes!.env[scope]) doc.scopes!.env[scope] = {};
    doc.scopes!.env[scope][ref] = value;
  }
  writeCredentialsDocument(doc, homeDir);
}

/** 移除一个引用（不存在的引用为 no-op）；scope 缺省 = global */
export function unsetCredential(ref: string, scope?: string, homeDir = resolveAccountHome()): boolean {
  if (!isCredentialRefName(ref)) return false;
  const doc = loadCredentialsDocument(homeDir);
  if (scope === undefined) {
    if (!(ref in doc.scopes!.global)) return false;
    delete doc.scopes!.global[ref];
  } else {
    const envScope = doc.scopes!.env[scope];
    if (!envScope || !(ref in envScope)) return false;
    delete envScope[ref];
  }
  writeCredentialsDocument(doc, homeDir);
  return true;
}

/**
 * 列出全部已配置引用（只暴露引用名/作用域/状态，绝不暴露值）。
 * 只列「本工具会解析」的引用：凭据存储中的全部引用 + 环境变量中 FH_/FHC_ 前缀的显式配置。
 */
export function listCredentials(homeDir = resolveAccountHome()): Array<{
  ref: string;
  scope: string;
  stored: boolean;
  env: boolean;
}> {
  const doc = loadCredentialsDocument(homeDir);
  const envRefs = new Set(
    Object.keys(process.env).filter(
      (k) => isCredentialRefName(k) && /^(FH_|FHC_)/.test(k) && typeof process.env[k] === 'string' && process.env[k].length > 0,
    ),
  );
  const rows: Array<{ ref: string; scope: string; stored: boolean; env: boolean }> = [];
  for (const ref of Object.keys(doc.scopes!.global)) {
    rows.push({ ref, scope: 'global', stored: true, env: envRefs.has(ref) });
  }
  for (const [scope, refs] of Object.entries(doc.scopes!.env)) {
    for (const ref of Object.keys(refs)) {
      rows.push({ ref, scope, stored: true, env: envRefs.has(ref) });
    }
  }
  for (const ref of envRefs) {
    if (!rows.some((r) => r.ref === ref && r.stored)) rows.push({ ref, scope: 'env', stored: false, env: true });
  }
  return rows.sort((a, b) => a.scope.localeCompare(b.scope) || a.ref.localeCompare(b.ref));
}

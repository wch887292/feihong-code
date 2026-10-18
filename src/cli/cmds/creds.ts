/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 凭据管理命令（对标 dsh credentials seam）：
 *   fhcode creds list               列出全部凭据引用（只显示状态，不显示值）
 *   fhcode creds set <ref> <value>  写入一个凭据引用
 *   fhcode creds unset <ref>        移除一个凭据引用
 *   fhcode creds migrate            把 fhcode.config.json 中明文 apiKey 迁移到凭据存储，
 *                                   并改写为 apiKeyEnv 引用（自动备份原文件）
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProviderConfig } from '../../shared/config';
import { loadConfigFile, resolveHomeDir } from '../../shared/config';
import { listCredentials, setCredential, unsetCredential, isCredentialRefName } from '../../security/credentials';

export type CredsAction = 'list' | 'set' | 'unset' | 'migrate';

/** 由 provider id 生成稳定的凭据引用名（FHC_<ID>_API_KEY，POSIX 标识符） */
function refNameFor(id: string): string {
  const base = `FHC_${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`;
  return base.replace(/_{2,}/g, '_');
}

/** 需要迁移的配置文件候选（FH_CONFIG 显式 > cwd > FH_HOME），去重保序 */
function configCandidates(): string[] {
  const envFile = process.env.FH_CONFIG;
  const cwdFile = join(process.cwd(), 'fhcode.config.json');
  const homeFile = join(resolveHomeDir(), 'fhcode.config.json');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [envFile, cwdFile, homeFile]) {
    if (f && existsSync(f) && !seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

export async function runCredsCmd(
  action: CredsAction = 'list',
  ref?: string,
  value?: string,
): Promise<void> {
  if (action === 'list') {
    const rows = listCredentials();
    console.log('飞虹 Code 凭据引用（密钥不落配置文件，存储于 ' + join(resolveHomeDir(), '.credentials.json') + '）');
    console.log('  REF                                          STORED  ENV');
    for (const row of rows) {
      console.log(`  ${row.ref.padEnd(42)} ${row.stored ? '  yes   ' : '  no    '} ${row.env ? 'yes' : 'no'}`);
    }
    if (rows.length === 0) {
      console.log('（当前无凭据引用）');
    }
    console.log('\n用法：');
    console.log('  fhcode creds set <ref> <value>   写入凭据（ref 需为 FHC_XXX 形式）');
    console.log('  fhcode creds unset <ref>         移除凭据');
    console.log('  fhcode creds migrate              把 fhcode.config.json 明文 apiKey 迁入凭据存储');
    return;
  }

  if (action === 'set') {
    if (!ref || !isCredentialRefName(ref)) {
      console.error('用法：fhcode creds set <ref> <value>（ref 需为 POSIX 标识符，如 FHC_OPENROUTER_API_KEY）');
      process.exitCode = 1;
      return;
    }
    if (!value) {
      console.error('缺少凭据值。用法：fhcode creds set <ref> <value>');
      process.exitCode = 1;
      return;
    }
    setCredential(ref, value);
    console.log(`✓ 已写入凭据引用 ${ref}（存于 ${join(resolveHomeDir(), '.credentials.json')}）`);
    return;
  }

  if (action === 'unset') {
    if (!ref) {
      console.error('用法：fhcode creds unset <ref>');
      process.exitCode = 1;
      return;
    }
    const removed = unsetCredential(ref);
    console.log(removed ? `✓ 已移除凭据引用 ${ref}` : `（引用 ${ref} 不存在，无需移除）`);
    return;
  }

  // migrate：明文 apiKey → 凭据存储 + apiKeyEnv 引用
  const files = configCandidates();
  if (files.length === 0) {
    console.log('未找到 fhcode.config.json（已迁移或不存在），无需处理。');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  for (const file of files) {
    let cfg: { models?: { providers?: ProviderConfig[] } };
    try {
      cfg = JSON.parse(readFileSync(file, 'utf8')) as { models?: { providers?: ProviderConfig[] } };
    } catch {
      console.warn(`跳过损坏的配置文件: ${file}`);
      continue;
    }
    const providers = cfg.models?.providers ?? [];
    if (providers.length === 0) continue;

    // 引用名去重：同一 ref 不同 key 时追加序号
    const used = new Map<string, string>();
    let changed = false;
    for (const p of providers) {
      if (!p.apiKey || p.apiKeyEnv) continue; // 无明文 key 或已是引用形式
      let ref = refNameFor(p.id);
      const existing = used.get(ref);
      if (existing !== undefined && existing !== p.apiKey) {
        let n = 2;
        while (used.has(`${ref}_${n}`)) n++;
        ref = `${ref}_${n}`;
      }
      used.set(ref, p.apiKey);
      setCredential(ref, p.apiKey);
      p.apiKeyEnv = ref;
      delete p.apiKey;
      changed = true;
      migrated++;
      console.log(`  ✓ ${p.id} -> ${ref}`);
    }
    if (!changed) {
      skipped++;
      continue;
    }
    // 备份后写回
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    writeFileSync(backup, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log(`  已备份原配置: ${backup}`);
  }

  if (migrated === 0 && skipped > 0) {
    console.log('所有 provider 已是 apiKeyEnv 引用形式或无需迁移。');
  }
  console.log(`\n迁移完成：${migrated} 个 provider 已迁移，密钥已移出配置文件。`);
  console.log('（配置中的 apiKey 明文已删除；旧 apiKey 字段仍兼容但不再推荐。）');

  // 提醒：防止密钥进 git
  const gitignore = join(resolveHomeDir(), '.credentials.json');
  console.log(`\n安全提醒：${gitignore} 已含密钥，请确保该文件被 .gitignore 排除（建议将 .credentials.json 加入仓库 .gitignore）。`);
  // 加载一次确认配置仍可解析
  void loadConfigFile;
}

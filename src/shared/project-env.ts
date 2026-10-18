/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 项目环境标识（对标 Codex secrets::environment_id_from_cwd）：
 *  - 运行目录在 git 仓库内 → 仓库目录名（如 feihong-code）
 *  - 否则 → cwd 规范化路径 SHA-256 前 12 位（cwd-<hash>）
 * 用于项目级凭据/记忆命名空间：同一仓库名在不同机器上保持一致，
 * 非仓库目录退化为路径哈希，避免目录名冲突。
 */
import { execSync } from 'child_process';
import { createHash } from 'crypto';

/** 解析 git 仓库根目录（失败返回 null） */
export function gitRepoRoot(cwd = process.cwd()): string | null {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const root = out.trim();
    return root || null;
  } catch {
    return null;
  }
}

/** 派生当前目录的项目标识（同步，供 CLI/记忆/凭据复用） */
export function deriveProjectId(cwd = process.cwd()): string {
  const root = gitRepoRoot(cwd);
  if (root) {
    const name = root.split(/[\\/]/).filter(Boolean).pop()?.trim();
    if (name) return name;
  }
  // 非 git 目录：规范化路径哈希前 12 位（对标 Codex cwd-<short>）
  let canonical = cwd;
  try {
    canonical = require('fs').realpathSync(cwd);
  } catch {
    /* 保留原路径 */
  }
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `cwd-${hash.slice(0, 12)}`;
}

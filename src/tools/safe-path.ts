/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 路径安全：工具只能在工作区范围内操作，防止 ../ 穿越越权
 */
import { resolve, relative, isAbsolute } from 'path';
import { realpathSync } from 'fs';
import { SecurityError } from '../shared/errors';

/**
 * 若路径已存在则规范化符号链接（realpath），否则原样返回。
 * 用于对已存在的文件/目录做符号链接逃逸检测，而新建文件场景不受影响。
 */
function canonicalIfExists(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 将 target 解析为绝对路径，并校验未超出 base（防 ../ 穿越 + 符号链接逃逸） */
export function safeJoin(base: string, target: string): string {
  const absBase = canonicalIfExists(resolve(base));
  const rawTarget = isAbsolute(target) ? resolve(target) : resolve(absBase, target);
  const absTarget = canonicalIfExists(rawTarget);
  const rel = relative(absBase, absTarget);
  if (rel.startsWith('..') || (rel !== '' && isAbsolute(rel))) {
    throw new SecurityError(`路径越权: ${target} 超出工作区 ${base}`);
  }
  return absTarget;
}

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 产物静态校验器（2026-11-09 新增，治「不可运行代码却报 done」）
 *
 * 背景：任务收尾原本只在仓库存在 package.json 时跑 build/test；写一个独立
 * HTML/JS 网页（无 package.json）直接 skipped，于是 `const` 被累加、变量未定义、
 * 括号闭合错误、停在半行的残缺文件都能顺利报成功。本模块对本次改动过的
 * Web/JS 产物做零依赖静态校验，并复用 swe-verifier 的 VerifyResult 结构，
 * 让收尾验证矩阵有真实的「用例 / 状态 / 退出码」可核对。
 */
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { Script } from 'vm';
import type { VerifyResult, VerifyStep } from './swe-verifier';

const ARTIFACT_EXT = /\.(html?|js|mjs|cjs|json|css)$/i;

/** 纯函数：判断一段脚本是否为 ESM（vm.Script 只能编译脚本，不能编译模块） */
export function looksLikeModule(code: string): boolean {
  return /^\s*(import|export)\s/m.test(code) || /\bimport\s*\(/.test(code);
}

/** 纯函数：编译一段脚本，返回语法错误说明；通过返回 null */
export function scriptSyntaxError(code: string): string | null {
  try {
    new Script(code);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 提取 HTML 中所有内联 <script>（排除外链 src 与 type=module 的 ESM） */
function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1] ?? '';
    if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*["']?module/i.test(attrs)) continue;
    const code = m[2] ?? '';
    if (!code.trim() || looksLikeModule(code)) continue;
    out.push(code);
  }
  return out;
}

/**
 * 校验本次任务改动过的产物文件。
 * - 无可校验类型 → skipped（不空跑、不误判）
 * - 任一文件失败 → fail，errorSummary 列出具体文件与原因
 * - cwd 之外的路径一律跳过，防止模型借路径逃逸读取工作区外文件
 */
export function verifyArtifacts(cwd: string, files: string[]): VerifyResult {
  const started = Date.now();
  const root = resolve(cwd);
  const steps: VerifyStep[] = [];
  const problems: string[] = [];
  const targets = (files ?? []).filter((f) => typeof f === 'string' && ARTIFACT_EXT.test(f));

  if (targets.length === 0) {
    return {
      overall: 'skipped',
      steps: [],
      errorSummary: '（本次改动无 HTML/JS/JSON/CSS 类可静态校验产物）',
      durationMs: Date.now() - started,
      log: 'no artifact to verify',
    };
  }

  for (const rel of targets) {
    const abs = resolve(join(root, rel));
    if (abs !== root && !abs.startsWith(root + '\\') && !abs.startsWith(root + '/')) {
      steps.push({ name: `artifact:${rel}`, command: 'static', status: 'skipped', exitCode: 0, output: '路径越界，跳过', durationMs: 0 });
      continue;
    }
    const reasons: string[] = [];
    if (!existsSync(abs)) {
      reasons.push('文件不存在');
    } else {
      let text = '';
      try {
        text = readFileSync(abs, 'utf8');
      } catch (e) {
        reasons.push(`读取失败: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!reasons.length) {
        if (!text.trim()) reasons.push('文件为空');
        const ext = rel.toLowerCase().split('.').pop() ?? '';
        if (ext === 'html' || ext === 'htm') {
          const head = text.trimStart().slice(0, 400).toLowerCase();
          if ((head.startsWith('<!doctype html') || head.startsWith('<html')) && !/<\/html\s*>/i.test(text)) {
            reasons.push('缺少 </html> 闭合标签（疑似输出被截断）');
          }
          const opens = (text.match(/<script\b/gi) ?? []).length;
          const closes = (text.match(/<\/script\s*>/gi) ?? []).length;
          if (opens > closes) reasons.push(`<script> 标签未配对（开 ${opens} / 闭 ${closes}）`);
          for (const [i, code] of inlineScripts(text).entries()) {
            const err = scriptSyntaxError(code);
            if (err) reasons.push(`内联 script #${i + 1} 语法错误: ${err.slice(0, 200)}`);
          }
        } else if (ext === 'json') {
          try {
            JSON.parse(text);
          } catch (e) {
            reasons.push(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else if (ext === 'css') {
          const opens = (text.match(/\{/g) ?? []).length;
          const closes = (text.match(/\}/g) ?? []).length;
          if (opens !== closes) reasons.push(`花括号未配对（开 ${opens} / 闭 ${closes}）`);
        } else if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
          if (!looksLikeModule(text)) {
            const err = scriptSyntaxError(text);
            if (err) reasons.push(`JS 语法错误: ${err.slice(0, 200)}`);
          }
        }
      }
    }
    const status = reasons.length > 0 ? 'fail' : 'pass';
    const detail = reasons.length > 0 ? reasons.join('；') : '结构闭合、语法通过';
    steps.push({
      name: `artifact:${rel}`,
      command: 'static',
      status,
      exitCode: reasons.length > 0 ? 1 : 0,
      output: detail,
      durationMs: 0,
    });
    if (reasons.length > 0) problems.push(`- ${rel}: ${detail}`);
  }

  const overall = problems.length > 0 ? 'fail' : 'pass';
  return {
    overall,
    steps,
    errorSummary: problems.length > 0 ? problems.join('\n') : '（全部通过）',
    durationMs: Date.now() - started,
    log: `verifyArtifacts: ${steps.length} files, ${overall}`,
  };
}

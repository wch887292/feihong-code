#!/usr/bin/env node
/**
 * 合规宣称扫描：防止对外材料违规宣称"已获第三方认证"。
 *
 * 背景：安全材料（安全白皮书 / DPA / 合规清单）均为**内部自评估**属性，
 * 项目当前未获得 SOC 2 / ISO 27001 等认证。本脚本扫描所有对外文档，
 * 拦截"已通过/已获得/已取得 … 认证"类违规表述（白名单文件内的"未获得 /
 * 计划 / 目标"等合法上下文已通过否定词过滤）。
 *
 * 拦截模式（违规宣称）：
 *   - 已(通过|获得|取得|拿到|完成)…(SOC ?2|ISO ?27001|等保|认证)
 *   - (SOC ?2|ISO ?27001)…(已)?(通过|认证|合规)（无否定词修饰）
 *   - certified / fully compliant（无否定词）
 *
 * 用法：node scripts/check-compliance-claims.mjs   （CI security job 调用）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'bench', 'funasr-server', 'android',
  '_android_tpl', 'fhcode-android', 'release', 'release2', 'release-new',
  '.workbuddy', '.backup_p0', 'feihong-code', 'firecrawl',
]);
const EXTS = new Set(['.md', '.html', '.txt']);
const violations = [];

// 违规：肯定式宣称已获认证（后面紧跟认证名，或前面紧跟认证名）
const CLAIM_PATTERNS = [
  /已(?:经)?(?:通过|获得|取得|拿到|完成|具备)[^。；\n]{0,24}(?:SOC\s?2|ISO\s?\/?IEC?\s?27001|ISO\s?27001|等保(?:三级|三级认证)?|C?MM?C|第三方(?:合规)?认证)/gi,
  /(?:SOC\s?2(?:\s?Type\s?(?:I|II))?|ISO\s?\/?IEC?\s?27001|等保三级)[^。；\n]{0,24}?(?:已)?(?:通过|获得|取得|完成)[^。；\n]{0,10}(?:审计|认证|测评)/gi,
  /\bis\s+(?:now\s+)?(?:fully\s+)?certified\b/gi,
];

// 否定词护栏：同一句内出现即视为合法（不宣称）
const NEGATION = /未|尚未|没有|没有获得|暂未|不(?:宣称|构成|代表|承诺)|非(?!常)|无(?!障碍)|计划|目标|规划|待|差距|准备|申请中|评估中|路线|自评估|待办|future|planned|not\s+yet|self-?assess/i;

function scanFile(rel, text) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const pat of CLAIM_PATTERNS) {
      pat.lastIndex = 0;
      const m = pat.exec(line);
      if (m && !NEGATION.test(line)) {
        violations.push(`${rel}:${i + 1}  「${line.trim().slice(0, 100)}」`);
        break;
      }
    }
  });
}

function walk(dir, rel = '') {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    const st = existsSync(abs);
    if (!st) continue;
    if (SKIP_DIRS.has(name)) continue;
    let isDir = false;
    try { isDir = readdirSync(abs).constructor === Array; } catch { isDir = false; }
    if (isDir) { walk(abs, r); continue; }
    if (EXTS.has(path.extname(name).toLowerCase())) {
      try { scanFile(r, readFileSync(abs, 'utf8')); } catch { /* 跳过不可读 */ }
    }
  }
}

walk(root);

console.log('合规宣称扫描 · 检查对外材料不得宣称已获第三方认证（当前为自评估属性）');
if (violations.length) {
  console.error(`\n✗ 发现 ${violations.length} 处疑似违规宣称（须改为"自评估/计划"表述）:`);
  for (const v of violations) console.error(`  ${v}`);
  console.error('\n正确表述示例：「本文档为厂商内部自评估，不构成 SOC 2 / ISO 27001 认证背书」');
  process.exit(1);
}
console.log('✓ 未发现违规认证宣称');

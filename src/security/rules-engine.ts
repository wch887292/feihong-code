/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P4 三级规则引擎（v8.6.0「Always-on 飞虹 dots」收官期）
 *
 * dots 范式核心：Agent 每个动作先过三级判定——allow（直接放行）/ ask（进审批收件箱）/ deny（直接拦截）。
 *
 * 判定顺序（红线永远最高，用户规则不可放行红线）：
 *   1) 硬红线四类（内置，不可配置、不可覆盖）     → deny
 *   2) 精确匹配规则（全等 pattern）               → deny > ask > allow（同动作用户配置了显式规则）
 *   3) 通配匹配规则（pattern 含 *，前缀/后缀通配）→ deny > ask > allow
 *   4) 默认 fail-safe：无规则命中                  → ask（宁可多问，不可放行）
 */

export type RuleEffect = 'allow' | 'ask' | 'deny';

/** 硬红线四类：改密码 / 转账 / 永久删除 / 外发 */
export type RedlineKind = 'password_change' | 'transfer' | 'permanent_delete' | 'exfiltration';

export interface UserRule {
  /** 规则 id（用户自定义，需唯一） */
  id: string;
  /** 动作模式：精确字符串，或含 * 的通配模式（仅支持前后缀通配，如 shell:rm *） */
  pattern: string;
  effect: RuleEffect;
  enabled?: boolean;
}

export interface RuleDecision {
  /** deny > ask > allow；红线一律 deny */
  effect: RuleEffect;
  /** 判定来源：redline / exact / wildcard / default */
  source: 'redline' | 'exact' | 'wildcard' | 'default';
  /** 命中的规则 id（default 时无） */
  ruleId?: string;
  /** 命中的红线类别（仅 redline 时有） */
  redline?: RedlineKind;
  /** 人类可读判定理由（已可安全展示，不含密钥明文——调用方仍应过 redact） */
  reason: string;
}

/* ==================== 硬红线词表（中英双语，大小写不敏感） ==================== */

const REDLINE_PATTERNS: Array<{ kind: RedlineKind; label: string; re: RegExp }> = [
  {
    kind: 'password_change',
    label: '改密码',
    re: /(passwd|chpasswd|htpasswd|修改密码|更改密码|改动密码|重置密码|改密码|change\s*password|password\s*change|set\s*password|update\s*password)/i,
  },
  {
    kind: 'transfer',
    label: '转账',
    re: /(转账|汇款|打款|付款给|transfer\s*(money|funds|to)|wire\s*transfer|remittance|make\s*a?\s*payment)/i,
  },
  {
    kind: 'permanent_delete',
    label: '永久删除',
    re: /(rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)|del\s+\/[fs]|rd\s+\/s|rmdir\s+\/s|格式化|format\s+[a-z]:|永久删除|彻底删除|不可恢复地删除|shred\s|wipe\s|diskpart|mkfs|drop\s+(table|database|schema))/i,
  },
  {
    kind: 'exfiltration',
    label: '外发',
    re: /(外发|发送到外部|传到外部|泄露|上传到(云|公网|外部)|导出到外部|post\s+https?:\/\/(?!localhost|127\.0\.0\.1)|curl\s+[^|]*(-d|--data|-t|--upload-file)|scp\s+\S+@|rsync\s+[^|]*::|webhook\.(site|io)|ngrok)/i,
  },
];

/** 硬红线检测：命中返回类别，否则 null。对所有用户规则生效前置，不可绕过。 */
export function detectRedline(action: string): RedlineKind | null {
  if (!action) return null;
  for (const p of REDLINE_PATTERNS) {
    if (p.re.test(action)) return p.kind;
  }
  return null;
}

export const REDLINE_LABELS: Record<RedlineKind, string> = {
  password_change: '改密码',
  transfer: '转账',
  permanent_delete: '永久删除',
  exfiltration: '外发',
};

/* ==================== 规则匹配 ==================== */

/** 效果严重度：deny(3) > ask(2) > allow(1)——同动作命中多条规则时取最严 */
const EFFECT_RANK: Record<RuleEffect, number> = { deny: 3, ask: 2, allow: 1 };

/** 通配匹配：pattern 仅支持首尾各至多一个 *（中缀通配不支持，防 ReDoS 与误配） */
function wildcardMatch(pattern: string, action: string): boolean {
  const star = pattern.indexOf('*');
  if (star === -1) return false;
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  if (tail.includes('*')) return false; // 仅支持单 *
  if (!action.startsWith(head)) return false;
  if (!action.endsWith(tail)) return false;
  return action.length >= head.length + tail.length;
}

/**
 * 三级规则判定。
 * @param rules 用户规则集（顺序无关，内部按「精确 > 通配、同层级取最严效果」裁决）
 * @param action 待判定的动作描述（如 `run_shell: rm -rf /`）
 */
export function evaluateRules(rules: UserRule[], action: string): RuleDecision {
  // 1) 硬红线：优先于一切用户规则（T4.2）
  const redline = detectRedline(action);
  if (redline) {
    return {
      effect: 'deny',
      source: 'redline',
      redline,
      reason: `命中硬红线「${REDLINE_LABELS[redline]}」——任何规则不可放行`,
    };
  }

  const active = rules.filter((r) => r.enabled !== false && r.pattern);

  // 2) 精确匹配（全等）
  const exact = active.filter((r) => !r.pattern.includes('*') && r.pattern === action);
  if (exact.length > 0) {
    const best = exact.reduce((a, b) => (EFFECT_RANK[b.effect] > EFFECT_RANK[a.effect] ? b : a));
    return {
      effect: best.effect,
      source: 'exact',
      ruleId: best.id,
      reason: `精确匹配规则 ${best.id} → ${best.effect}`,
    };
  }

  // 3) 通配匹配
  const wild = active.filter((r) => r.pattern.includes('*') && wildcardMatch(r.pattern, action));
  if (wild.length > 0) {
    const best = wild.reduce((a, b) => (EFFECT_RANK[b.effect] > EFFECT_RANK[a.effect] ? b : a));
    return {
      effect: best.effect,
      source: 'wildcard',
      ruleId: best.id,
      reason: `通配匹配规则 ${best.id}（${best.pattern}）→ ${best.effect}`,
    };
  }

  // 4) fail-safe 默认：进审批（宁可多问，不可放行）
  return { effect: 'ask', source: 'default', reason: '无规则命中——默认进入审批（fail-safe）' };
}

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 执行策略前缀规则（对标 Codex execpolicy/rule.rs）：
 *  - FH_SHELL_ALLOW / FH_SHELL_DENY 的规则解析与匹配
 *  - 无空格条目 = 命令名匹配（向后兼容旧白名单语义）
 *  - 有空格条目 = 前缀规则：命令 token 序列以规则 token 序列为前缀逐 token 精确匹配
 *    （如 "git pull" 只放行 git pull，不放行 git push --force）
 * 匹配不区分大小写，Windows 路径分隔符归一化。
 */

/** 解析逗号分隔的策略环境变量（trim + 去空 + 去重，大小写不归一，匹配时归一） */
export function parseShellPolicy(envValue: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of envValue.split(',')) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/** 把规则拆成 token 序列（连续空白折叠，仅作分隔） */
export function ruleTokens(rule: string): string[] {
  return rule.trim().replace(/\s+/g, ' ').split(' ');
}

/** 命令文本拆成 token 序列（空白折叠，前导/尾随空白剔除） */
export function commandTokens(cmd: string): string[] {
  return cmd.trim().replace(/\s+/g, ' ').split(' ');
}

/**
 * 单条规则是否命中命令：
 *  - 规则无空格：命令首 token 相等（旧语义）
 *  - 规则有空格：命令 token 序列以规则 token 序列为前缀（逐 token 相等）
 * 大小写不敏感；Windows 反斜杠归一为斜杠后比较（命令 token 多为程序名，归一兜底）。
 */
export function matchShellRule(rule: string, tokens: string[]): boolean {
  const rt = ruleTokens(rule);
  if (rt.length === 0) return false;
  if (rt.length > tokens.length) return false;
  for (let i = 0; i < rt.length; i++) {
    const a = rt[i].replace(/\\/g, '/').toLowerCase();
    const b = tokens[i].replace(/\\/g, '/').toLowerCase();
    if (a !== b) return false;
  }
  return true;
}

/**
 * 在规则列表中查找首个命中命令的规则。
 * 返回命中的规则原文（供审计 reason 使用）；未命中返回 null。
 */
export function matchShellRules(rules: string[], cmd: string): string | null {
  if (!rules || rules.length === 0 || !cmd.trim()) return null;
  const tokens = commandTokens(cmd);
  if (tokens.length === 0) return null;
  for (const rule of rules) {
    if (matchShellRule(rule, tokens)) return rule;
  }
  return null;
}

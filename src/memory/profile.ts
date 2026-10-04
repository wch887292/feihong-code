/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ④ 业务画像（对标纳米Work「工作记忆跨会话复用」的可视化出口）：
 * 把跨会话沉淀的项目记忆（ProjectMemoryEntry[]）聚合成一张可读的业务画像，
 * 纯函数实现（无 IO），便于单测与复用（CLI / Web / 后续 Agent 自省）。
 */
import type { ProjectMemoryEntry } from '../agent/layered-memory';

export interface BusinessProfile {
  /** 累计任务数 */
  totalTasks: number;
  /** 首次任务时间 */
  firstAt: string | null;
  /** 最近任务时间 */
  lastAt: string | null;
  /** 高频领域/标签（Top N） */
  topDomains: Array<{ tag: string; count: number }>;
  /** 去重后的关键决策 */
  keyDecisions: string[];
  /** 产物路径 */
  artifacts: string[];
  /** 最近任务目标（最新在前） */
  recentGoals: string[];
  /** 沉淀的用户偏好 */
  userPreferences: string[];
}

function dedupe(list: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const t = s.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** 聚合项目记忆 → 业务画像（纯函数） */
export function aggregateProfile(entries: ProjectMemoryEntry[]): BusinessProfile {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    return {
      totalTasks: 0, firstAt: null, lastAt: null, topDomains: [],
      keyDecisions: [], artifacts: [], recentGoals: [], userPreferences: [],
    };
  }

  // 高频标签
  const tagCount = new Map<string, number>();
  for (const e of list) {
    for (const tag of e.tags ?? []) {
      const t = tag.trim();
      if (!t) continue;
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }
  const topDomains = [...tagCount.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // 决策 / 产物 / 偏好
  const decisions = list.flatMap((e) => e.decisions ?? []);
  const artifacts = list.flatMap((e) => e.artifacts ?? []);
  const prefs = list.flatMap((e) => e.userPreferences ?? []);

  // 时间跨度
  const times = list.map((e) => new Date(e.timestamp).getTime()).filter((t) => !isNaN(t));
  const firstAt = times.length ? new Date(Math.min(...times)).toISOString() : null;
  const lastAt = times.length ? new Date(Math.max(...times)).toISOString() : null;

  // 最近目标（最新在前）
  const recentGoals = [...list]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8)
    .map((e) => e.goal);

  return {
    totalTasks: list.length,
    firstAt,
    lastAt,
    topDomains,
    keyDecisions: dedupe(decisions, 10),
    artifacts: dedupe(artifacts, 10),
    recentGoals,
    userPreferences: dedupe(prefs, 8),
  };
}

/** 业务画像 → 控制台可读文本 */
export function formatProfile(p: BusinessProfile): string {
  const lines: string[] = [];
  lines.push('飞虹 Code 业务画像（工作记忆跨会话复用 · 对标纳米Work）');
  lines.push('================================================');
  if (p.totalTasks === 0) {
    lines.push('暂无项目记忆。完成一次任务后，决策/产物会自动沉淀到这里。');
    return lines.join('\n');
  }
  lines.push(`累计任务：${p.totalTasks}　时间跨度：${(p.firstAt ?? '').slice(0, 10)} ~ ${(p.lastAt ?? '').slice(0, 10)}`);
  if (p.topDomains.length) {
    lines.push(`\n【高频领域】${p.topDomains.map((d) => `${d.tag}(${d.count})`).join('  ')}`);
  }
  if (p.keyDecisions.length) {
    lines.push('\n【关键决策】');
    p.keyDecisions.forEach((d, i) => lines.push(`  ${i + 1}. ${d}`));
  }
  if (p.userPreferences.length) {
    lines.push('\n【用户偏好】');
    p.userPreferences.forEach((d) => lines.push(`  • ${d}`));
  }
  if (p.artifacts.length) {
    lines.push('\n【主要产物】');
    p.artifacts.forEach((a) => lines.push(`  • ${a}`));
  }
  if (p.recentGoals.length) {
    lines.push('\n【最近任务】');
    p.recentGoals.forEach((g, i) => lines.push(`  ${i + 1}. ${g}`));
  }
  return lines.join('\n');
}

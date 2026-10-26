/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2-1 分发层地基（对齐 anthropics/claude-plugins-official 的分发语义）：
 *  - name：不可变 slug（稳定标识，决定目录/引用名，禁止改动）
 *  - displayName：可变的人类可读标签（可随时改，不影响 name）
 *  - 顶层 renames：{ 旧name -> 新name }，安装/解析时透明改写旧引用（含链式 + 环防护）
 *  - marketplace.json：市场清单解析（一个市场的元数据：名称 + plugins[]）
 *  - skill 注册名：由 skill 目录路径派生 slug（稳定、可预期）
 *
 * 纯函数 + 零外部依赖（不读盘 / 不发网 / 不碰 fs），仅做字符串与数据变换，
 * 便于单测与在 CLI/市场服务/插件管理器中复用。本切片不动 manager.ts 的 mock 市场。
 */

/** 校验 name 是否为合法不可变 slug：小写字母/数字/点/下划线/连字符，不以连字符开头，长度 1~64 */
export function isValidSlug(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 64) return false;
  if (name.startsWith('-')) return false;
  return /^[a-z0-9._-]+$/.test(name);
}

/**
 * 解析人类可读显示名：
 *  - 显式传入 displayName（非空白字符串）→ 优先采用（截断到 128 字符）
 *  - 否则回退到 slug name（保证总有可显示值）
 */
export function resolveDisplayName(name: string, displayName?: string): string {
  if (typeof displayName === 'string') {
    const trimmed = displayName.trim();
    if (trimmed.length > 0) return trimmed.slice(0, 128);
  }
  return name;
}

/** 单跳改写：若 renames 命中则返回新名，否则原样返回 */
function renameOnce(name: string, renames: Record<string, string>): string {
  return Object.prototype.hasOwnProperty.call(renames, name) ? renames[name] : name;
}

/**
 * 透明改写旧引用：沿链式 renames（a→b→c）解析到最终名。
 *  - 环防护：同一 name 在一次解析链中重复出现即视为环，停止并返回当前值（不抛错）。
 *  - 步数上限 MAX_RENAME_STEPS 防止恶意/异常配置死循环。
 */
export function applyRenames(name: string, renames: Record<string, string> | undefined | null): string {
  if (!renames) return name;
  const MAX_RENAME_STEPS = 100;
  const seen = new Set<string>([name]);
  let current = name;
  for (let step = 0; step < MAX_RENAME_STEPS; step++) {
    const next = renameOnce(current, renames);
    if (next === current) return current; // 未命中，解析完成
    if (seen.has(next)) return next; // 命中已见节点 → 环，安全停止
    seen.add(next);
    current = next;
  }
  return current;
}

/** 市场清单中单个插件条目（name 必须为合法 slug；displayName 可选标签） */
export interface MarketplacePlugin {
  /** 不可变 slug（稳定标识；与已安装插件的 name 对齐，用于自动迁移匹配） */
  name: string;
  /** 人类可读标签（可改，不影响 name） */
  displayName?: string;
  description?: string;
  version?: string;
  /** 市场/来源（便于溯源与分发） */
  source?: string;
  /**
   * 透传字段：marketplace.json 条目可携带宿主消费的额外字段
   * （如 fhcode 的 MarketPlugin：id/keywords/categories/publisher/verified/...），
   * 解析时原样保留，由消费侧按需读取。
   */
  [key: string]: unknown;
}

/** 市场清单解析结果 */
export interface MarketplaceManifest {
  name: string;
  displayName?: string;
  description?: string;
  plugins: MarketplacePlugin[];
  /** 顶层 renames：{ 旧name -> 新name }（安装/解析时自动迁移旧引用） */
  renames: Record<string, string>;
}

/**
 * 解析 marketplace.json 原始对象（防御式，损坏/缺失不抛错，返回 null）。
 * 仅接受字符串/数组形态；非字符串字段在保留原样前提下降级（不阻断其余可用字段）。
 */
export function parseMarketplaceManifest(raw: unknown): MarketplaceManifest | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name : '';
  if (!isValidSlug(name)) return null; // 市场自身 name 必须为合法 slug，否则拒绝

  const result: MarketplaceManifest = { name, plugins: [], renames: {} };
  const displayName = resolveDisplayName(name, obj.displayName as string | undefined);
  if (displayName) result.displayName = displayName;
  if (typeof obj.description === 'string') result.description = obj.description;

  // 插件条目：仅保留 name 为合法 slug 的条目（脏数据静默剔除，不阻断整表）；
  // 透传全部字段（id/keywords/categories/publisher/... 由宿主按需读取，见 MarketplacePlugin 索引签名）
  if (Array.isArray(obj.plugins)) {
    for (const entry of obj.plugins) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.name !== 'string' || !isValidSlug(e.name)) continue;
      const plugin: MarketplacePlugin = { ...e, name: e.name };
      result.plugins.push(plugin);
    }
  }

  // 顶层 renames：{ 旧 -> 新 }（字符串映射）；值需为合法 slug 才接受
  if (obj.renames && typeof obj.renames === 'object' && !Array.isArray(obj.renames)) {
    for (const [k, v] of Object.entries(obj.renames as Record<string, unknown>)) {
      if (typeof v === 'string' && isValidSlug(v)) result.renames[k] = v;
    }
  }
  return result;
}

/**
 * 由 skill 目录路径派生稳定注册 slug（供 skill 注册名 / 引用一致性使用）：
 *  1. 取最后一个非空路径段（目录名）
 *  2. 规范化：去空白、转小写、非 [a-z0-9._-] 一律替换为连字符、折叠重复连字符
 *  3. 结果保证为合法 slug；若退化为空则回退为 'skill'
 */
export function slugFromSkillPath(skillPath: string): string {
  const segments = String(skillPath)
    .split(/[\\/]+/)
    .filter(Boolean);
  const last = segments.length > 0 ? segments[segments.length - 1] : '';
  const normalized = last
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized || normalized === '.') return 'skill';
  return normalized;
}

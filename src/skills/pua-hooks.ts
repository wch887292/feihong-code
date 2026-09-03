/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * pua-ext 技能 hooks 实现：
 *  - SessionStart：加载 ~/.pua/config.json，注入 [PUA Always-On] + Current Flavor 到系统提示
 *  - PostToolUse：检测工具失败，更新失败计数，按 L1-L4 等级注入压力旁白到工具输出
 *  - PreCompact：上下文压缩前，保存失败计数和状态到 ~/.pua/builder-journal.md
 *
 * 状态管理：
 *  - ~/.pua/config.json：用户配置（flavor/alwaysOn/自定义旁白）
 *  - ~/.pua/builder-journal.md：失败计数持久化（跨会话恢复）
 *  - 内存状态：当前会话失败计数、当前活跃味道
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../shared/logger';
import { registerSkillHook, type HookCtx, type SkillHookResult } from '../runtime/hooks';

const PUA_DIR = join(homedir(), '.pua');
const CONFIG_FILE = join(PUA_DIR, 'config.json');
const JOURNAL_FILE = join(PUA_DIR, 'builder-journal.md');

/** 支持的味道列表（与 pua-ext references/flavors.md 对齐） */
export const PUA_FLAVORS = [
  'alibaba', 'bytedance', 'huawei', 'tencent', 'meituan', 'pinduoduo',
  'baidu', 'netflix', 'apple', 'tesla', 'amazon', 'jd', 'xiaomi',
] as const;

export type PuaFlavor = (typeof PUA_FLAVORS)[number];

/** 味道显示名和图标 */
const FLAVOR_META: Record<PuaFlavor, { icon: string; name: string; keywords: string[] }> = {
  alibaba: { icon: '🟠', name: '阿里味', keywords: ['底层逻辑', '抓手', '闭环', '颗粒度', 'owner意识'] },
  bytedance: { icon: '🟡', name: '字节味', keywords: ['ROI', 'Always Day 1', '坦诚清晰', '务实敢为'] },
  huawei: { icon: '🔴', name: '华为味', keywords: ['力出一孔', '自我批判', '让听得见炮声的人呼唤炮火'] },
  tencent: { icon: '🟢', name: '腾讯味', keywords: ['赛马机制', '小步快跑', '用户价值'] },
  meituan: { icon: '🔵', name: '美团味', keywords: ['做难而正确的事', '猛将必发于卒伍', '长期有耐心'] },
  pinduoduo: { icon: '🟣', name: '拼多多味', keywords: ['本分', '拼命不是拼凑', '你不干有的是人'] },
  baidu: { icon: '⚫', name: '百度味', keywords: ['简单可依赖', '技术信仰', '基本盘'] },
  netflix: { icon: '🟤', name: 'Netflix味', keywords: ['Keeper Test', 'pro sports team', 'generous severance'] },
  apple: { icon: '⬜', name: 'Jobs味', keywords: ['A players', 'real artists ship', '减法优先'] },
  tesla: { icon: '⬛', name: 'Musk味', keywords: ['extremely hardcore', 'ship or die', 'the algorithm'] },
  amazon: { icon: '🔶', name: 'Amazon味', keywords: ['Customer Obsession', 'Bias for Action', 'Dive Deep'] },
  jd: { icon: '🟦', name: '京东味', keywords: ['只做第一', '客户体验零容忍', '一线指挥'] },
  xiaomi: { icon: '🟧', name: '小米味', keywords: ['专注极致口碑快', '和用户交朋友', '性价比'] },
};

/** pua-ext 配置 */
interface PuaConfig {
  /** 是否始终启用 PUA（默认 true） */
  alwaysOn: boolean;
  /** 当前活跃味道（用户手动设置时持久化；自动路由选择的味道不覆盖此字段） */
  flavor: PuaFlavor;
  /** 旁白密度：simple=简单任务2句，normal=每里程碑1句，verbose=每步都有 */
  density: 'simple' | 'normal' | 'verbose';
  /** 自定义旁白（覆盖默认） */
  customAsides?: Record<string, string>;
}

/** 内存状态（当前会话） */
interface PuaState {
  /** 当前会话失败计数 */
  failureCount: number;
  /** 当前活跃味道（自动路由选择的，不写入 config） */
  activeFlavor: PuaFlavor;
  /** 上一次失败的工具名 */
  lastFailedTool?: string;
  /** 会话开始时间 */
  sessionStart: string;
}

const DEFAULT_CONFIG: PuaConfig = {
  alwaysOn: true,
  flavor: 'alibaba',
  density: 'normal',
};

let config: PuaConfig | null = null;
let state: PuaState | null = null;

/** 确保 ~/.pua 目录存在 */
function ensureDir(): void {
  if (!existsSync(PUA_DIR)) {
    mkdirSync(PUA_DIR, { recursive: true });
  }
}

/** 加载配置（带缓存） */
export function loadPuaConfig(): PuaConfig {
  if (config) return config;
  ensureDir();
  let loaded: PuaConfig = { ...DEFAULT_CONFIG };
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      loaded = { ...DEFAULT_CONFIG, ...parsed };
      if (!PUA_FLAVORS.includes(loaded.flavor)) loaded.flavor = 'alibaba';
    } catch (e) {
      logger.warn('pua config parse failed, using default', { error: e instanceof Error ? e.message : String(e) });
      loaded = { ...DEFAULT_CONFIG };
    }
  } else {
    savePuaConfig(loaded);
  }
  config = loaded;
  return config;
}

/** 保存配置 */
export function savePuaConfig(cfg: PuaConfig): void {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  config = cfg;
}

/** 切换味道（用户手动设置时持久化） */
export function setPuaFlavor(flavor: PuaFlavor): void {
  const cfg = loadPuaConfig();
  cfg.flavor = flavor;
  savePuaConfig(cfg);
  if (state) state.activeFlavor = flavor;
  logger.info('pua flavor changed', { flavor });
}

/** 初始化内存状态（SessionStart 时调用） */
function initState(): PuaState {
  const cfg = loadPuaConfig();
  // 尝试从 builder-journal.md 恢复上次失败计数
  let restoredCount = 0;
  if (existsSync(JOURNAL_FILE)) {
    try {
      const raw = readFileSync(JOURNAL_FILE, 'utf8');
      const match = raw.match(/失败计数[：:]\s*(\d+)/);
      if (match) restoredCount = parseInt(match[1], 10) || 0;
    } catch { /* 忽略 */ }
  }
  state = {
    failureCount: restoredCount,
    activeFlavor: cfg.flavor,
    sessionStart: new Date().toISOString(),
  };
  logger.info('pua state initialized', { flavor: state.activeFlavor, restoredFailures: restoredCount });
  return state;
}

/** 获取当前状态（懒初始化） */
function getState(): PuaState {
  if (!state) state = initState();
  return state;
}

/** 根据失败次数获取压力等级和旁白 */
function getPressureAside(count: number, flavor: PuaFlavor): { level: string; aside: string } | null {
  const meta = FLAVOR_META[flavor];
  const kw = meta.keywords[Math.floor(Math.random() * meta.keywords.length)];

  if (count <= 1) return null; // 第1次失败不注入旁白

  const asides: Record<number, { level: string; aside: string }> = {
    2: {
      level: 'L1 温和失望',
      aside: `> [${meta.icon} ${meta.name}] 第 ${count} 次了。${kw}——换个本质不同的方案，别在原地打转。`,
    },
    3: {
      level: 'L2 灵魂拷问',
      aside: `> [${meta.icon} ${meta.name}] 第 ${count} 次。${kw}——搜过了吗？读过源码了吗？列3个假设再动手。`,
    },
    4: {
      level: 'L3 绩效审视',
      aside: `> [${meta.icon} ${meta.name}] 第 ${count} 次。${kw}——7项检查清单走完了吗？没走完=3.25。`,
    },
    5: {
      level: 'L4 毕业警告',
      aside: `> [${meta.icon} ${meta.name}] 第 ${count} 次。${kw}——拼命模式。你可能就要毕业了。`,
    },
  };

  if (count >= 5) return asides[5];
  return asides[count] || null;
}

/** 保存失败计数到 builder-journal.md（PreCompact 和会话结束时调用） */
export function savePuaJournal(): void {
  if (!state) return;
  ensureDir();
  const content = [
    '# PUA Builder Journal',
    '',
    `> 会话开始: ${state.sessionStart}`,
    `> 当前味道: ${FLAVOR_META[state.activeFlavor].icon} ${FLAVOR_META[state.activeFlavor].name}`,
    `> 失败计数: ${state.failureCount}`,
    `> 上次失败工具: ${state.lastFailedTool ?? '无'}`,
    `> 更新时间: ${new Date().toISOString()}`,
    '',
    '## 失败记录',
    '',
    ...(state.lastFailedTool ? [`- ${new Date().toISOString()}: ${state.lastFailedTool} (累计 ${state.failureCount} 次)`] : ['- 暂无']),
    '',
  ].join('\n');
  writeFileSync(JOURNAL_FILE, content, 'utf8');
}

/* ===================== Hook 实现 ===================== */

/** SessionStart hook：加载配置，注入 [PUA Always-On] + Current Flavor */
async function sessionStartHook(_ctx: HookCtx): Promise<SkillHookResult> {
  const cfg = loadPuaConfig();
  if (!cfg.alwaysOn) return {};

  const st = getState();
  const meta = FLAVOR_META[st.activeFlavor];

  const injection = [
    `[PUA Always-On 🔥]`,
    `当前味道: ${meta.icon} ${meta.name}（${meta.keywords.slice(0, 2).join(' · ')}）`,
    `行为协议: 闭环验证 · 事实驱动 · 穷尽一切 · Owner意识`,
    `失败计数: ${st.failureCount}（从 builder-journal 恢复）`,
    `方法论路由: 根据任务类型自动选择味道和方法论，用户手动设置的味道优先`,
  ].join('\n');

  return { systemInjection: injection };
}

/** PostToolUse hook：检测工具失败，更新计数，注入压力旁白 */
async function postToolUseHook(ctx: HookCtx): Promise<SkillHookResult> {
  const cfg = loadPuaConfig();
  if (!cfg.alwaysOn) return {};

  const st = getState();

  // 只关注实际执行的工具（Bash/Write/Edit 等），忽略只读工具
  const actionableTools = ['run_shell', 'write_file', 'edit_file', 'execute_command', 'bash'];
  const isActionable = ctx.tool && actionableTools.some((t) => ctx.tool?.toLowerCase().includes(t.toLowerCase()));

  if (ctx.ok === false && isActionable) {
    st.failureCount++;
    st.lastFailedTool = ctx.tool;
    logger.info('pua failure detected', { tool: ctx.tool, count: st.failureCount });

    const pressure = getPressureAside(st.failureCount, st.activeFlavor);
    if (pressure) {
      return {
        outputInjection: `\n${pressure.aside}\n`,
      };
    }
  } else if (ctx.ok === true && isActionable && st.failureCount > 0) {
    // 成功后重置失败计数（连续成功才重置，这里简单处理）
    st.failureCount = Math.max(0, st.failureCount - 1);
  }

  return {};
}

/** PreCompact hook：压缩前保存状态到 builder-journal.md */
async function preCompactHook(ctx: HookCtx): Promise<SkillHookResult> {
  const cfg = loadPuaConfig();
  if (!cfg.alwaysOn) return {};

  savePuaJournal();
  logger.info('pua state persisted before compaction', {
    messageCount: ctx.messageCount,
    failureCount: state?.failureCount ?? 0,
  });
  return {};
}

/* ===================== 注册与初始化 ===================== */

let registered = false;

/**
 * 注册 pua-ext 技能 hooks（幂等，只注册一次）。
 * 在 CLI 入口或技能加载时调用。
 */
export function registerPuaHooks(): void {
  if (registered) return;
  registered = true;

  registerSkillHook('SessionStart', sessionStartHook, 'pua-ext');
  registerSkillHook('PostToolUse', postToolUseHook, 'pua-ext');
  registerSkillHook('PreCompact', preCompactHook, 'pua-ext');

  // 确保目录和默认配置存在
  loadPuaConfig();
  logger.info('pua-ext hooks registered');
}

/** 获取当前 PUA 状态（用于调试/测试） */
export function getPuaState(): { flavor: PuaFlavor; failureCount: number; alwaysOn: boolean; lastFailedTool?: string } | null {
  if (!state) return null;
  return {
    flavor: state.activeFlavor,
    failureCount: state.failureCount,
    alwaysOn: loadPuaConfig().alwaysOn,
    lastFailedTool: state.lastFailedTool,
  };
}

/** 重置状态（仅用于测试） */
export function __resetPuaStateForTest(): void {
  state = null;
  config = null;
  registered = false;
}

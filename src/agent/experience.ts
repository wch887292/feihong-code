/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 经验学习（Experience Learning）— 强化学习式经验系统：
 * - 会话完成后自动提取经验（成功模式、失败教训、高效工具调用序列、自愈修复经验）
 * - 存储到 FH_HOME/experiences/*.jsonl，并以「稳定 id + upsert 合并」实现强化学习
 *   （同一模式被多次验证会累积 sessionCount 与成功率权重，而非无限追加重复记录）
 * - 下次任务开始时用 retrieveRelevantExperiences 做加权检索（标签重叠 + 新鲜度 + 成功率）
 *   注入 system prompt，形成「执行 → 反思 → 回流 → 更强执行」的闭环
 */
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { ChatMessage } from '../models/model.interface';
import { logger } from '../shared/logger';
import { classifyError } from './self-heal';

/**
 * 文件级 Promise 锁：防止两个 run 同时完成时 upsertExperience 互相覆盖。
 * 同一 experiences.jsonl 路径的写入串行化，不同路径互不阻塞。
 */
const fileLocks = new Map<string, Promise<unknown>>();
async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  fileLocks.set(filePath, prev.then(() => next, () => next));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    // 锁队列空时清理 Map 条目，避免内存泄漏
    if (fileLocks.get(filePath) === next) fileLocks.delete(filePath);
  }
}

export type ExperienceType =
  | 'tool-efficiency'      // 高效工具调用模式
  | 'error-pattern'        // 错误模式与规避
  | 'path-planning'        // 文件路径规划技巧
  | 'success-pattern'      // 成功执行序列 / 自愈修复经验
  | 'performance-tip';     // 性能优化建议

export interface Experience {
  id: string;
  type: ExperienceType;
  title: string;
  content: string;
  metadata: {
    sessionCount: number;
    successRate: number;
    tags: string[];
    createdAt: string;
    lastUsedAt: string;
  };
}

/** 稳定短哈希（用于经验去重 id） */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 由类型 + 归一化键生成稳定 id（跨 run 一致，支撑去重与 usage 追踪） */
export function normalizeExperienceId(type: ExperienceType, key: string): string {
  return `exp-${shortHash(`${type}:${key}`)}`;
}

/** 从会话历史中提取经验（强化学习素材） */
/** 经验提取器：declare -> (ctx) => Experience | null。表驱动替代长 if 链，便于增删规则 */
interface ExperienceExtractor {
  key: string;
  extract(ctx: ExtractCtx): Experience | null;
}

interface ExtractCtx {
  toolCalls: Array<{ name: string; args: unknown; success: boolean }>;
  errors: ChatMessage[];
  mkMeta: (successRate: number, tags: string[]) => Experience['metadata'];
  now: string;
}

const EXTRACTORS: ExperienceExtractor[] = [
  {
    // 经验 1: 高效工具调用模式（成功序列）
    key: 'tool-efficiency',
    extract: ({ toolCalls, mkMeta }) => {
      if (toolCalls.length < 3) return null;
      const successfulCalls = toolCalls.filter((tc) => tc.success);
      if (successfulCalls.length < 2) return null;
      const pattern = successfulCalls.map((tc) => tc.name).join(' → ');
      return {
        id: normalizeExperienceId('tool-efficiency', pattern),
        type: 'tool-efficiency',
        title: `成功工具序列: ${pattern}`,
        content: `在本次任务中，以下工具调用序列成功完成目标:\n${pattern}\n\n建议未来类似任务优先复用此序列，可减少试错轮次。`,
        metadata: mkMeta(successfulCalls.length / toolCalls.length, successfulCalls.map((tc) => tc.name)),
      };
    },
  },
  {
    // 经验 2: 错误模式与规避（用 classifyError 精确归类）
    key: 'error-pattern',
    extract: ({ errors, mkMeta }) => {
      if (errors.length === 0) return null;
      const categories = new Set<string>();
      for (const e of errors) {
        const analysis = classifyError(e.content || '', e.content || '');
        categories.add(analysis?.category ?? 'unknown');
      }
      const uniqueErrors = [...categories];
      return {
        id: normalizeExperienceId('error-pattern', uniqueErrors.join(',')),
        type: 'error-pattern',
        title: `常见错误模式: ${uniqueErrors.join(', ')}`,
        content: `本次任务遇到以下错误类型:\n${uniqueErrors.map((e) => `- ${e}`).join('\n')}\n\n规避建议: 提前校验前置条件（路径/权限/依赖），增加超时重试与最小改动原则，避免同类错误重复发生。`,
        metadata: mkMeta(0, uniqueErrors),
      };
    },
  },
  {
    // 经验 3: 干净成功模式（无错误且工具调用高效）
    key: 'clean-success',
    extract: ({ toolCalls, errors, mkMeta }) => {
      if (errors.length > 0) return null;
      if (toolCalls.filter((tc) => tc.success).length < 2) return null;
      return {
        id: normalizeExperienceId('success-pattern', 'clean-run'),
        type: 'success-pattern',
        title: '干净高效执行（无错误通过）',
        content: '本次任务在较少轮次内一次性通过，说明目标拆解与工具使用策略有效。未来可优先沿用「先勘察→小步编辑→就地验证」的节奏。',
        metadata: mkMeta(1.0, ['clean-run', 'efficiency']),
      };
    },
  },
];

export function extractExperience(messages: ChatMessage[], runId: string): Experience[] {
  const experiences: Experience[] = [];
  // 通过 toolCallId 精确关联工具调用与结果，替代脆弱的顺序匹配
  const toolCallMap = new Map<string, { name: string; args: unknown; success: boolean }>();
  const toolCalls: Array<{ name: string; args: unknown; success: boolean }> = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const entry = { name: tc.name, args: tc.arguments, success: true };
        toolCalls.push(entry);
        if (tc.id) toolCallMap.set(tc.id, entry);
      }
    }
    if (msg.role === 'tool') {
      // 优先通过 toolCallId 精确匹配；无 id 时回退到最后一个调用（兼容旧数据）
      const matched = msg.toolCallId ? toolCallMap.get(msg.toolCallId) : toolCalls[toolCalls.length - 1];
      if (matched) {
        const content = msg.content || '';
        // 工具失败标记：内容以"错误:"开头，或包含 exit code 非 0
        if (content.startsWith('错误:') || /exit code [1-9]/.test(content)) {
          matched.success = false;
        }
      }
    }
  }

  const now = new Date().toISOString();
  const mkMeta = (successRate: number, tags: string[]): Experience['metadata'] => ({
    sessionCount: 1,
    successRate,
    tags,
    createdAt: now,
    lastUsedAt: now,
  });

  const errors = messages.filter((m) => m.role === 'tool' && (m.content || '').startsWith('错误:'));
  const ctx: ExtractCtx = { toolCalls, errors, mkMeta, now };

  // 表驱动：依次运行提取器，命中的经验入列（行为与原三段 if 完全一致）
  for (const ex of EXTRACTORS) {
    const exp = ex.extract(ctx);
    if (exp) experiences.push(exp);
  }

  // runId 仅用于审计留痕，不影响稳定 id
  void runId;
  return experiences;
}

/** 追加保存一条经验（新建场景） */
export async function saveExperience(experienceDir: string, experience: Experience): Promise<void> {
  await mkdir(experienceDir, { recursive: true });
  const file = join(experienceDir, 'experiences.jsonl');
  await appendFile(file, JSON.stringify(experience) + '\n', 'utf8');
  logger.info('experience saved', { id: experience.id, type: experience.type });
}

/**
 * upsertExperience：强化学习式合并写入。
 * - 若同 id 经验已存在：sessionCount+1、成功率按次数加权平均、标签合并、刷新 lastUsedAt
 * - 否则新增
 * 这样同一模式被多次验证会「越用越可信」，且不会无限膨胀出重复记录。
 */
export async function upsertExperience(experienceDir: string, experience: Experience): Promise<void> {
  const file = join(experienceDir, 'experiences.jsonl');
  // 文件锁：防止并发 run 同时读写导致互相覆盖
  await withFileLock(file, async () => {
    if (!existsSync(file)) {
      await saveExperience(experienceDir, experience);
      return;
    }
    try {
      const content = await readFile(file, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      let merged = false;
      const out: string[] = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as Experience;
          if (e.id === experience.id) {
            const prev = e.metadata.sessionCount;
            const mergedExp: Experience = {
              ...e,
              content: experience.content.length >= e.content.length ? experience.content : e.content,
              metadata: {
                sessionCount: prev + 1,
                successRate: (e.metadata.successRate * prev + experience.metadata.successRate) / (prev + 1),
                tags: [...new Set([...e.metadata.tags, ...experience.metadata.tags])],
                createdAt: e.metadata.createdAt,
                lastUsedAt: new Date().toISOString(),
              },
            };
            out.push(JSON.stringify(mergedExp));
            merged = true;
          } else {
            out.push(line);
          }
        } catch {
          out.push(line);
        }
      }
      if (!merged) out.push(JSON.stringify(experience));
      await writeFile(file, out.join('\n') + '\n', 'utf8');
      logger.info('experience upserted', { id: experience.id, merged, type: experience.type });
    } catch {
      await saveExperience(experienceDir, experience);
    }
  });
}

/** 关键词分词的轻量实现（用于检索打分） */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.replace(/[es]$/, ''));
}

/** 加载相关经验（基于任务关键词，兼容旧路径） */
export async function loadExperiences(experienceDir: string, keywords: string[]): Promise<Experience[]> {
  const file = join(experienceDir, 'experiences.jsonl');
  if (!existsSync(file)) return [];

  try {
    const content = await readFile(file, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const experiences: Experience[] = [];

    for (const line of lines) {
      try {
        const exp: Experience = JSON.parse(line);
        const matched = keywords.some(
          (kw) =>
            exp.title.includes(kw) ||
            exp.content.includes(kw) ||
            exp.metadata.tags.some((tag) => tag.includes(kw)),
        );
        if (matched) experiences.push(exp);
      } catch {
        // 跳过损坏的经验记录
      }
    }

    // 按成功率排序，返回前 5 条
    return experiences
      .sort((a, b) => b.metadata.successRate - a.metadata.successRate)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * retrieveRelevantExperiences：加权检索（强化学习「召回」阶段）
 * 综合：标签重叠(×3) + 成功率基础权重(×2) + 子串命中(+2) + token 命中(+0.5) + 新鲜度衰减
 * 返回 top-N，供 orchestrator 注入 system prompt。
 */
export interface RetrieveOptions {
  limit?: number;
}

export async function retrieveRelevantExperiences(
  experienceDir: string,
  goal: string,
  opts: RetrieveOptions = {},
): Promise<Experience[]> {
  const limit = opts.limit ?? 5;
  const file = join(experienceDir, 'experiences.jsonl');
  if (!existsSync(file)) return [];

  const tokens = tokenize(goal);
  const goalLower = goal.toLowerCase();

  try {
    const content = await readFile(file, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const scored: Array<{ exp: Experience; score: number }> = [];

    for (const line of lines) {
      try {
        const exp = JSON.parse(line) as Experience;
        let score = exp.metadata.successRate * 2; // 基础权重

        // 标签重叠
        const tagOverlap = exp.metadata.tags.filter((t) => tokens.includes(t.toLowerCase())).length;
        score += tagOverlap * 3;

        // 标题/内容子串命中
        if (
          goalLower &&
          (exp.title.toLowerCase().includes(goalLower) || exp.content.toLowerCase().includes(goalLower))
        ) {
          score += 2;
        }

        // token 命中
        for (const tk of tokens) {
          if (exp.content.toLowerCase().includes(tk) || exp.title.toLowerCase().includes(tk)) score += 0.5;
        }

        // 新鲜度衰减（约 20 天线性衰减到 0）
        const ageDays = (Date.now() - new Date(exp.metadata.lastUsedAt).getTime()) / 86_400_000;
        score += Math.max(0, 1.5 - ageDays / 20);

        scored.push({ exp, score });
      } catch {
        // 跳过损坏记录
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.exp);
  } catch {
    return [];
  }
}

/** 更新经验使用统计（bump 被加载/使用的经验，强化其权重） */
export async function updateExperienceUsage(experienceDir: string, experienceId: string): Promise<void> {
  const file = join(experienceDir, 'experiences.jsonl');
  if (!existsSync(file)) return;

  await withFileLock(file, async () => {
    try {
      const content = await readFile(file, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const updatedLines = lines.map((line) => {
        try {
          const exp: Experience = JSON.parse(line);
          if (exp.id === experienceId) {
            return JSON.stringify({
              ...exp,
              metadata: {
                ...exp.metadata,
                sessionCount: exp.metadata.sessionCount + 1,
                lastUsedAt: new Date().toISOString(),
              },
            });
          }
          return line;
        } catch {
          return line;
        }
      });

      await writeFile(file, updatedLines.join('\n') + '\n', 'utf8');
    } catch {
      // 静默失败
    }
  });
}

/**
 * extractFixPattern：从「自愈成功」的会话中提取可复用修复经验。
 * 触发条件：会话中出现「错误:」工具消息，且后续助手消息表明已修复/通过验证。
 * 仅产出一条高价值经验，避免噪声；orchestrator 在 selfHealed 时调用。
 */
export function extractFixPattern(messages: ChatMessage[]): Experience | null {
  let errorMsg: string | null = null;
  let resolved = false;
  for (const m of messages) {
    if (m.role === 'tool' && (m.content || '').startsWith('错误:')) {
      if (!errorMsg) errorMsg = m.content;
    }
    if (
      m.role === 'assistant' &&
      /修复|已修复|解决|resolved|fixed|通过验证|验证通过|成功/i.test(m.content || '')
    ) {
      resolved = true;
    }
  }
  if (!errorMsg || !resolved) return null;

  const analysis = classifyError(errorMsg, errorMsg);
  const category = analysis?.category ?? 'unknown';
  const key = `fix-pattern:${category}`;
  const now = new Date().toISOString();
  return {
    id: normalizeExperienceId('success-pattern', key),
    type: 'success-pattern',
    title: `自愈修复经验: ${category}`,
    content:
      `历史上遇到过「${category}」类错误，通过多轮自我修复（读错误→定位根因→就地修复→重跑验证）最终解决。` +
      `未来遇到同类错误应直接采用该闭环，避免重复试错。`,
    metadata: {
      sessionCount: 1,
      successRate: 1.0,
      tags: [category, 'self-heal', 'fix'],
      createdAt: now,
      lastUsedAt: now,
    },
  };
}

/** 生成经验注入的系统提示（分组：成功模式优先、失败模式警示） */
export function generateExperiencePrompt(experiences: Experience[]): string {
  if (experiences.length === 0) return '';

  const success = experiences.filter((e) => e.type === 'success-pattern' || e.type === 'tool-efficiency');
  const errors = experiences.filter((e) => e.type === 'error-pattern');

  const parts = [
    '📚 历史经验参考（系统已从既往任务中强化学习，请优先参考成功经验、主动规避失败模式）',
  ];

  if (success.length) {
    parts.push('\n## ✅ 可复用成功模式');
    for (const exp of success) parts.push(`- **${exp.title}**: ${exp.content.slice(0, 200)}`);
  }
  if (errors.length) {
    parts.push('\n## ⚠️ 应避免的失败模式');
    for (const exp of errors) parts.push(`- **${exp.title}**: ${exp.content.slice(0, 200)}`);
  }

  return parts.join('\n');
}

/** 列出所有经验 */
export async function listExperiences(experienceDir: string): Promise<Experience[]> {
  const file = join(experienceDir, 'experiences.jsonl');
  if (!existsSync(file)) return [];

  try {
    const content = await readFile(file, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Experience)
      .sort((a, b) => b.metadata.sessionCount - a.metadata.sessionCount);
  } catch {
    return [];
  }
}

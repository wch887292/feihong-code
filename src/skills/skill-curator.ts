/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Skill 自进化策展器（纯函数、可离线可测、全程不接 LLM）：
 *  - 把高复用经验确定性归纳为候选 skill 草稿
 *  - 质量审查（长度/敏感路径/撞名）
 *  - 人工确认后落盘 pending/approved 状态管理
 *  - 清理长期未用草稿
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { isSensitiveFile } from '../knowledge/vector-rag';

/** 默认配置 */
const DEFAULT_REUSE_THRESHOLD = 3; // 同一 tool/pattern 复用≥3 次才生成草稿
const DEFAULT_MAX_AGE_DAYS = 30; // 超过 30 天未审自动清理
const MAX_SKILL_BODY_SIZE = 8192; // 8KB 上限

/** 经验记录（从 experience.ts 或 self-evolve 系统流入） */
export interface ExperienceRecord {
  /** 经验类型（error/solution/tool/pattern） */
  type: string;
  /** 经验 key（稳定标识） */
  key: string;
  /** 工具/模式名称（用于聚合） */
  toolOrPattern?: string;
  /** 使用次数 */
  usageCount: number;
  /** 成功次数 */
  successCount: number;
  /** 相关 session ID 列表 */
  sessionIds: string[];
  /** 最后使用时间 */
  lastUsedAt: string;
}

/** Skill 草稿接口 */
export interface SkillDraft {
  /** 技能名（目录名） */
  name: string;
  /** frontmatter description */
  description: string;
  /** 完整指令正文（SKILL.md 去除 frontmatter 后的部分） */
  body: string;
  /** 来源经验 ID 列表 */
  sourceExperienceIds: string[];
  /** 创建时间戳 */
  createdAt: number;
  /** 是否已批准 */
  approved: boolean;
}

/** 质量审查结果 */
export interface ReviewResult {
  /** 是否通过 */
  ok: boolean;
  /** 问题原因列表 */
  reasons: string[];
}

/** 策展器配置 */
export interface CuratorConfig {
  /** 复用阈值（达到此次数才生成草稿） */
  reuseThreshold?: number;
  /** 草稿存储根目录 */
  pendingDir: string;
  /** 已批准技能存储根目录 */
  approvedDir: string;
  /** 最大年龄（天），超过则清理 */
  maxAgeDays?: number;
}

/** 默认配置实例 */
const defaultConfig: CuratorConfig = {
  reuseThreshold: DEFAULT_REUSE_THRESHOLD,
  pendingDir: '.fhcode/skills/pending',
  approvedDir: '.fhcode/skills/approved',
  maxAgeDays: DEFAULT_MAX_AGE_DAYS,
};

/**
 * 把高复用经验确定性归纳为候选 skill 草稿
 * 规则：同一 tool 或 pattern 复用次数达到阈值就生成 SKILL.md 草稿
 * 不调 LLM，只做归并与模板拼装
 */
export function curateSkills(
  experiences: ExperienceRecord[],
  config: Partial<CuratorConfig> = {},
): SkillDraft[] {
  const cfg = { ...defaultConfig, ...config };
  const grouped = new Map<string, ExperienceRecord[]>();

  // 按 toolOrPattern 分组
  for (const exp of experiences) {
    if (!exp.toolOrPattern || exp.usageCount < (cfg.reuseThreshold ?? DEFAULT_REUSE_THRESHOLD)) {
      continue;
    }
    const list = grouped.get(exp.toolOrPattern) || [];
    list.push(exp);
    grouped.set(exp.toolOrPattern, list);
  }

  const drafts: SkillDraft[] = [];
  for (const [toolName, exps] of grouped) {
    // 合并所有相关经验
    const allSessionIds = new Set<string>();
    let totalUsage = 0;
    let totalSuccess = 0;
    let latestTs = 0;

    for (const exp of exps) {
      for (const sid of exp.sessionIds) {
        allSessionIds.add(sid);
      }
      totalUsage += exp.usageCount;
      totalSuccess += exp.successCount;
      const ts = new Date(exp.lastUsedAt).getTime();
      if (ts > latestTs) latestTs = ts;
    }

    // 生成描述：基于工具名和成功率
    const successRate = totalUsage > 0 ? (totalSuccess / totalUsage * 100).toFixed(1) : '0.0';
    const description = `${toolName} —— 复用 ${totalUsage} 次，成功率 ${successRate}%`;

    // 拼装 body：结构化模板
    const body = generateSkillBody(toolName, exps, allSessionIds.size);

    const draft: SkillDraft = {
      name: toolName.toLowerCase().replace(/\s+/g, '-'),
      description,
      body,
      sourceExperienceIds: Array.from(allSessionIds),
      createdAt: Date.now(),
      approved: false,
    };

    drafts.push(draft);
  }

  return drafts;
}

/**
 * 生成 SKILL.md 正文（不含 frontmatter）
 * 纯模板拼装，不调 LLM
 */
function generateSkillBody(toolName: string, experiences: ExperienceRecord[], sessionCount: number): string {
  const lines = [
    `# ${toolName}`,
    '',
    '## 触发场景',
    `当用户提及"${toolName}"或涉及相关任务时调用。`,
    '',
    '## 核心能力',
    '覆盖该工具/模式的标准化操作流程与最佳实践。',
    '',
    '## 使用方式',
    '直接自然语言描述需求，AI 自动匹配此技能执行。',
    '',
    '## 经验来源',
    `本技能由 ${sessionCount} 个历史会话中的实践经验归纳而成，复用次数累计 ${experiences.reduce((sum, e) => sum + e.usageCount, 0)} 次。`,
    '',
    '## 注意事项',
    '- 使用前确认上下文信息完整',
    '- 关键步骤需人工复核',
    '- 异常情况下优先保障数据安全',
    '',
    '=== 技能结束 ===',
  ];

  return lines.join('\n');
}

/**
 * 质量审查：检查长度/敏感路径/撞名
 */
export function reviewSkillDraft(draft: SkillDraft, existingSkillNames: Set<string>): ReviewResult {
  const reasons: string[] = [];

  // 1. 检查长度
  const fullContent = `---\nname: ${draft.name}\ndescription: ${draft.description}\n---\n\n${draft.body}`;
  if (fullContent.length > MAX_SKILL_BODY_SIZE) {
    reasons.push(`内容长度 ${fullContent.length} 字符超过上限 ${MAX_SKILL_BODY_SIZE}`);
  }

  // 2. 检查敏感文件路径（统一走 P0-1 的 isSensitiveFile 单一事实源，不另设本地正则）
  const pathTokens = (draft.body.match(/["'`]?[~\w.\-/\\]+["'`]?/g) ?? []).map((t) => t.replace(/["'`]/g, ''));
  const sensitiveHit = pathTokens.find((t) => t.length > 3 && isSensitiveFile(t));
  if (sensitiveHit) {
    reasons.push(`内容包含敏感文件路径引用：${sensitiveHit}`);
  }

  // 3. 检查撞名
  if (existingSkillNames.has(draft.name)) {
    reasons.push(`技能名 "${draft.name}" 已与已入库技能冲突`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

/**
 * 人工确认后落盘为 dir/name/SKILL.md
 * 未确认只留 pending 状态
 */
export function approveSkillDraft(draft: SkillDraft, config: Partial<CuratorConfig> = {}): string {
  const cfg = { ...defaultConfig, ...config };
  const pendingPath = join(cfg.pendingDir, draft.name, 'SKILL.md');
  const approvedPath = join(cfg.approvedDir, draft.name, 'SKILL.md');

  // 确保目录存在
  mkdirSync(dirname(approvedPath), { recursive: true });

  // 构建完整 SKILL.md 内容
  const content = `---\nname: ${draft.name}\ndescription: ${draft.description}\n---\n\n${draft.body}`;

  // 写入已批准版本
  writeFileSync(approvedPath, content, 'utf8');

  // 更新草稿状态
  draft.approved = true;

  // 删除 pending 版本（如果存在）
  if (existsSync(pendingPath)) {
    try {
      unlinkSync(pendingPath);
    } catch {
      /* 忽略删除失败 */
    }
  }

  return approvedPath;
}

/**
 * 列出未审草稿
 */
export function listPendingSkills(config: Partial<CuratorConfig> = {}): SkillDraft[] {
  const cfg = { ...defaultConfig, ...config };
  const pendingDir = cfg.pendingDir;

  if (!existsSync(pendingDir)) {
    return [];
  }

  const drafts: SkillDraft[] = [];
  for (const entry of readdirSync(pendingDir)) {
    const skillDir = join(pendingDir, entry);
    if (!statSync(skillDir).isDirectory()) continue;

    const mdPath = join(skillDir, 'SKILL.md');
    if (!existsSync(mdPath)) continue;

    try {
      const content = readFileSync(mdPath, 'utf8');
      const parsed = parseSkillMd(content);
      if (!parsed.approved) {
        drafts.push(parsed);
      }
    } catch {
      /* 跳过损坏文件 */
    }
  }

  return drafts;
}

/**
 * 清理长期未用的草稿（超过 maxAgeDays）
 */
export function pruneStaleSkills(config: Partial<CuratorConfig> = {}): number {
  const cfg = { ...defaultConfig, ...config };
  const pendingDir = cfg.pendingDir;
  const maxAgeMs = (cfg.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  if (!existsSync(pendingDir)) {
    return 0;
  }

  let cleaned = 0;
  for (const entry of readdirSync(pendingDir)) {
    const skillDir = join(pendingDir, entry);
    if (!statSync(skillDir).isDirectory()) continue;

    const mdPath = join(skillDir, 'SKILL.md');
    if (!existsSync(mdPath)) continue;

    try {
      const stat = statSync(mdPath);
      const age = now - stat.mtime.getTime();
      if (age > maxAgeMs) {
        // 删除整个目录
        deleteDir(skillDir);
        cleaned++;
      }
    } catch {
      /* 跳过异常 */
    }
  }

  return cleaned;
}

/**
 * 解析 SKILL.md：frontmatter + 正文 + 元数据
 */
function parseSkillMd(content: string): SkillDraft {
  const text = content.replace(/^\uFEFF/, '');
  
  // 提取 frontmatter
  let name = '';
  let description = '';
  let bodyStart = 0;

  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end > 0) {
      const fm = text.slice(3, end);
      bodyStart = end + 4;
      
      const nameMatch = /^\s*name\s*:\s*(.+)$/m.exec(fm);
      const descMatch = /^\s*description\s*:\s*(.+)$/m.exec(fm);
      
      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
    }
  }

  const body = text.slice(bodyStart).trim();

  return {
    name: name || 'unknown',
    description,
    body,
    sourceExperienceIds: [],
    createdAt: Date.now(),
    approved: false,
  };
}

/**
 * 递归删除目录及其内容
 */
function deleteDir(dir: string): void {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      deleteDir(fullPath);
    } else {
      try {
        unlinkSync(fullPath);
      } catch {
        /* 忽略删除失败 */
      }
    }
  }

  try {
    rmdirSync(dir);
  } catch {
    /* 忽略删除失败 */
  }
}

/** 辅助函数：删除文件 */
function unlinkSync(path: string): void {
  try {
    require('fs').unlinkSync(path);
  } catch {
    /* 忽略 */
  }
}

/** 辅助函数：删除目录 */
function rmdirSync(path: string): void {
  try {
    require('fs').rmdirSync(path);
  } catch {
    /* 忽略 */
  }
}

// ===== 导出清单 =====
// 1. SkillDraft 接口
// 2. curateSkills 函数
// 3. reviewSkillDraft 函数
// 4. approveSkillDraft 函数
// 5. listPendingSkills 函数
// 6. pruneStaleSkills 函数
// 7. ExperienceRecord 接口
// 8. ReviewResult 接口
// 9. CuratorConfig 接口

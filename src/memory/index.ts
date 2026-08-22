/**
 * 飞虹 Code - 记忆管理系统
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 记忆系统：
 * - 短期记忆：每日工作日志，追加写入
 * - 长期记忆：经过总结提炼的知识点，滚动更新
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface MemoryConfig {
  shortTermDir: string;     // 短期记忆目录
  longTermFile: string;     // 长期记忆文件
  maxHistoryDays: number;   // 保留多少天的短期记忆
  summarizeThreshold: number; // 超过多少条记录触发自动总结
}

export interface ShortTermEntry {
  timestamp: string;
  type: 'task' | 'fix' | 'feature' | 'error' | 'note';
  title: string;
  content: string;
}

export interface LongTermNote {
  id: string;
  created: string;
  summarizedFrom: string;   // 来自哪天的短期记忆
  category: string;
  title: string;            // 标题
  content: string;
}

export interface MemoryStats {
  shortTermFiles: number;   // 短期记忆文件数
  longTermNotes: number;    // 长期记忆条目数
  lastSummarize: string | null;
}

const DEFAULT_CONFIG: MemoryConfig = {
  shortTermDir: join(process.env.HOME || '', '.feihong-code', 'memory'),
  longTermFile: join(process.env.HOME || '', '.feihong-code', 'memory', 'MEMORY.md'),
  maxHistoryDays: 30,
  summarizeThreshold: 5,
};

/**
 * 获取或创建记忆配置
 */
export function getMemoryConfig(overrides?: Partial<MemoryConfig>): MemoryConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/**
 * 获取当天短期记忆文件路径
 */
export function getShortTermPath(config: MemoryConfig, date?: Date): string {
  const d = date || new Date();
  const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
  return join(config.shortTermDir, `${dateStr}.md`);
}

/**
 * 确保目录存在
 */
function ensureDir(config: MemoryConfig): void {
  mkdirSync(config.shortTermDir, { recursive: true });
  if (!existsSync(config.longTermFile)) {
    writeFileSync(config.longTermFile, '# 长期记忆\n\n## 项目概览\n\n暂无内容。\n', 'utf-8');
  }
}

/**
 * 追加短期记忆条目
 */
export function appendShortTerm(
  config: MemoryConfig,
  entry: Omit<ShortTermEntry, 'timestamp'>
): string {
  ensureDir(config);
  const path = getShortTermPath(config);
  const timestamp = new Date().toISOString();

  const content = `
## ${entry.title} (${timestamp.split('T')[1]?.split('.')[0] || 'unknown'})

- **类型**: ${entry.type}
- **时间**: ${timestamp}

${entry.content}
`;

  appendFileSync(path, content, 'utf-8');
  return path;
}

/**
 * 读取指定日期的短期记忆
 */
export function readShortTerm(config: MemoryConfig, date?: Date): string {
  const path = getShortTermPath(config, date);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

/**
 * 读取所有短期记忆（最近 N 天）
 */
export function readAllShortTerm(config: MemoryConfig): Map<string, string> {
  ensureDir(config);
  const memories = new Map<string, string>();
  const now = new Date();

  for (let i = 0; i < config.maxHistoryDays; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const path = join(config.shortTermDir, `${dateStr}.md`);

    if (existsSync(path)) {
      memories.set(dateStr, readFileSync(path, 'utf-8'));
    }
  }

  return memories;
}

/**
 * 读取长期记忆
 */
export function readLongTerm(config: MemoryConfig): string {
  ensureDir(config);
  if (!existsSync(config.longTermFile)) return '';
  return readFileSync(config.longTermFile, 'utf-8');
}

/**
 * 写入长期记忆
 */
export function writeLongTerm(config: MemoryConfig, content: string): void {
  ensureDir(config);
  writeFileSync(config.longTermFile, content, 'utf-8');
}

/**
 * 追加长期记忆条目
 */
export function appendLongTerm(
  config: MemoryConfig,
  note: Omit<LongTermNote, 'id' | 'created'>
): string {
  ensureDir(config);
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const created = new Date().toISOString();

  const content = `
## ${note.category}: ${note.title}

- **来源**: ${note.summarizedFrom}
- **创建时间**: ${created}
- **ID**: ${id}

${note.content}
`;

  appendFileSync(config.longTermFile, content, 'utf-8');
  return id;
}

/**
 * 获取记忆统计
 */
export function getMemoryStats(config: MemoryConfig): MemoryStats {
  ensureDir(config);

  // 统计短期记忆文件数
  let shortTermFiles = 0;
  if (existsSync(config.shortTermDir)) {
    const files = require('fs').readdirSync(config.shortTermDir);
    shortTermFiles = files.filter((f: string) => f.endsWith('.md')).length;
  }

  // 统计长期记忆条目数
  let longTermNotes = 0;
  const longContent = readLongTerm(config);
  longTermNotes = (longContent.match(/## /g) || []).length;

  // 查找最后总结时间
  let lastSummarize: string | null = null;
  const match = longContent.match(/创建时间\*: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (match) {
    lastSummarize = match[1];
  }

  return {
    shortTermFiles,
    longTermNotes,
    lastSummarize,
  };
}

/**
 * 生成记忆摘要模板（供 AI 总结使用）
 */
export function generateSummaryPrompt(
  config: MemoryConfig,
  date: string
): string {
  const content = readShortTerm(config, new Date(date));
  const longTerm = readLongTerm(config);

  return `你是一位专业的技术记录员。请分析以下工作日志，提取关键信息并总结到长期记忆中。

## 短期记忆 (${date})

\`\`\`
${content || '(无记录)'}
\`\`\`

## 现有长期记忆

\`\`\`
${longTerm || '(无)'}
\`\`\`

## 要求

1. 提取今天的关键技术问题和解决方案
2. 归纳用户偏好和习惯
3. 记录项目进展和重要决策
4. 如果有重复内容，合并到现有长期记忆中
5. 保持简洁，每条记录不超过 5 行
6. 使用 Markdown 格式

## 输出格式

请按以下格式输出总结（仅输出内容，不要其他说明）：

### 新增条目
（如果有新内容）

### 更新条目
（如果有需要更新的现有内容）

### 无变化
（如果没有需要更新的内容）
`;
}

/**
 * 清理过期的短期记忆
 */
export function cleanupShortTerm(config: MemoryConfig): number {
  if (!existsSync(config.shortTermDir)) return 0;

  const now = new Date();
  let deleted = 0;
  const fs = require('fs');

  const files = fs.readdirSync(config.shortTermDir);
  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!dateMatch) continue;

    const fileDate = new Date(dateMatch[1]);
    const ageDays = (now.getTime() - fileDate.getTime()) / (1000 * 60 * 60 * 24);

    if (ageDays > config.maxHistoryDays) {
      fs.unlinkSync(join(config.shortTermDir, file));
      deleted++;
    }
  }

  return deleted;
}

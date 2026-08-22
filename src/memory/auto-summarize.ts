/**
 * 飞虹 Code - 自动记忆总结
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 功能：
 * - 每天 00:00 自动触发记忆总结
 * - 读取当天短期记忆，调用 AI 模型生成总结
 * - 更新长期记忆文件
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  MemoryConfig,
  getMemoryConfig,
  readShortTerm,
  appendLongTerm,
  generateSummaryPrompt,
} from './index';

export interface SummarizeResult {
  success: boolean;
  date: string;
  addedNotes: number;
  updatedNotes: number;
  error?: string;
  summary?: string;
}

const SUMMARY_HISTORY_FILE = 'summarize-history.json';

interface SummaryHistoryEntry {
  date: string;
  timestamp: string;
  addedNotes: number;
  updatedNotes: number;
  success: boolean;
  error?: string;
}

/**
 * 保存总结历史
 */
function saveSummaryHistory(config: MemoryConfig, history: SummaryHistoryEntry): void {
  const historyFile = join(config.shortTermDir, SUMMARY_HISTORY_FILE);
  let historyList: SummaryHistoryEntry[] = [];

  if (existsSync(historyFile)) {
    try {
      historyList = JSON.parse(readFileSync(historyFile, 'utf-8'));
    } catch {
      historyList = [];
    }
  }

  historyList.unshift(history);
  // 只保留最近 90 天
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  historyList = historyList.filter(h => new Date(h.timestamp) > cutoff);

  writeFileSync(historyFile, JSON.stringify(historyList, null, 2), 'utf-8');
}

/**
 * 获取总结历史
 */
export function getSummaryHistory(config: MemoryConfig, _limit: number = 30): SummaryHistoryEntry[] {
  const historyFile = join(config.shortTermDir, SUMMARY_HISTORY_FILE);
  if (!existsSync(historyFile)) return [];

  try {
    return JSON.parse(readFileSync(historyFile, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * 调用本地 AI 模型进行总结
 * 使用 fhcode CLI 直接调用
 */
async function summarizeWithAI(prompt: string): Promise<string> {
  // 使用默认的 agnes-2.5-pro 模型
  const modelCmd = `echo '${prompt.replace(/'/g, "'\"'\"'")}' | node dist/cli/index.js --model agnes-2.5-pro`;

  try {
    const result = execSync(modelCmd, {
      encoding: 'utf-8',
      timeout: 60000,
      cwd: join(process.cwd(), '..'),
    });
    return result.trim();
  } catch (e: any) {
    // 如果 CLI 失败，返回原始内容标记为需要手动处理
    return `[AI调用失败] ${e.message}\n\n请手动总结以下内容：\n${prompt}`;
  }
}

/**
 * 解析 AI 输出为结构化摘要
 */
function parseSummaryOutput(output: string): {
  addedNotes: number;
  updatedNotes: number;
  newEntries: Array<{ category: string; content: string }>;
} {
  const addedNotes = (output.match(/### 新增条目/g) || []).length;
  const updatedNotes = (output.match(/### 更新条目/g) || []).length;

  // 简单解析：按 ### 分割
  const sections = output.split(/###\s+/).filter(s => s.trim());
  const newEntries: Array<{ category: string; content: string }> = [];

  for (const section of sections) {
    const lines = section.trim().split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const category = lines[0].replace(/^[\*\-#]+\s*/, '').trim();
      const content = lines.slice(1).join('\n').trim();
      if (content.length > 10) {
        newEntries.push({ category, content });
    }
    }
  }

  return { addedNotes, updatedNotes, newEntries };
}

/**
 * 执行记忆总结
 */
export async function summarizeMemory(
  config?: Partial<MemoryConfig>,
  forceDate?: string
): Promise<SummarizeResult> {
  const cfg = getMemoryConfig(config);
  const date = forceDate || new Date().toISOString().split('T')[0];

  try {
    // 读取当天短期记忆
    const shortTerm = readShortTerm(cfg, new Date(date));
    if (!shortTerm || shortTerm.trim().length === 0) {
      return {
        success: true,
        date,
        addedNotes: 0,
        updatedNotes: 0,
        summary: '今日无记录',
      };
    }

    // 生成总结提示词
    const prompt = generateSummaryPrompt(cfg, date);

    // 调用 AI 模型总结（这里使用占位实现，实际需要接入 LLM API）
    // 由于 Web 环境限制，我们先使用规则总结
    const aiOutput = await summarizeWithAI(prompt);
    parseSummaryOutput(aiOutput);

    // 提取关键信息（简化版：直接提取带 **的条目）
    const lines = shortTerm.split('\n').filter(l => l.trim().startsWith('- **'));
    let added = 0;
    let updated = 0;

    for (const line of lines) {
      const match = line.match(/- \*\*(.+?)\*\*:\s*(.+)/);
      if (match) {
        const category = match[1].trim();
        const content = match[2].trim();
        if (content.length > 5) {
          appendLongTerm(cfg, {
            title: category,
            summarizedFrom: date,
            category: '技术修复',
            content,
          });
          added++;
        }
      }
    }

    // 保存总结历史
    saveSummaryHistory(cfg, {
      date,
      timestamp: new Date().toISOString(),
      addedNotes: added,
      updatedNotes: updated,
      success: true,
    });

    return {
      success: true,
      date,
      addedNotes: added,
      updatedNotes: updated,
      summary: `成功总结 ${added} 条记录`,
    };
  } catch (e: any) {
    // 保存失败记录
    saveSummaryHistory(cfg, {
      date,
      timestamp: new Date().toISOString(),
      addedNotes: 0,
      updatedNotes: 0,
      success: false,
      error: e.message,
    });

    return {
      success: false,
      date,
      addedNotes: 0,
      updatedNotes: 0,
      error: e.message,
    };
  }
}

/**
 * 注册定时任务（每天 00:00 执行）
 */
export function scheduleDailySummary(config?: Partial<MemoryConfig>): void {
  const cfg = getMemoryConfig(config);

  // 计算到明天 00:00 的毫秒数
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  // 设置定时器
  setTimeout(async () => {
    console.log('[记忆总结] 开始每日总结...');
    const result = await summarizeMemory(cfg);
    console.log(`[记忆总结] ${result.date}: ${result.summary || result.error}`);

    // 每分钟检查一次，确保每天执行
    setInterval(async () => {
      const now = new Date();
      if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
        await summarizeMemory(cfg);
      }
    }, 60000); // 每分钟检查
  }, msUntilMidnight);

  console.log(`[记忆总结] 将在 ${msUntilMidnight / 1000 / 60} 分钟后执行首次总结`);
}

/**
 * 立即执行一次总结（用于测试或手动触发）
 */
export async function runImmediateSummary(config?: Partial<MemoryConfig>): Promise<SummarizeResult> {
  return summarizeMemory(config);
}

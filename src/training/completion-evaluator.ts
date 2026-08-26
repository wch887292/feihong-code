/**
 * 飞虹 Code - 补全模型评估模块 (P3-1)
 *
 * 评估专用补全模型的性能指标：
 * - 精确匹配率（Exact Match）
 * - 编辑相似度（Edit Similarity / Levenshtein）
 * - 前缀匹配率（Prefix Match）
 * - 平均延迟（Latency）
 * - 接受率（Acceptance Rate，需要用户反馈数据）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

/** 评估样本 */
export interface EvalSample {
  prefix: string;
  suffix: string;
  expected: string;
  file_path?: string;
  language?: string;
}

/** 评估结果 */
export interface EvalResult {
  exactMatch: number;
  editSimilarity: number;
  prefixMatch: number;
  firstTokenMatch: number;
  avgLatencyMs: number;
  totalSamples: number;
  perLanguage: Record<string, {
    exactMatch: number;
    editSimilarity: number;
    count: number;
  }>;
  details: Array<{
    expected: string;
    predicted: string;
    exactMatch: boolean;
    editSimilarity: number;
    latencyMs: number;
    language?: string;
  }>;
}

/** 补全函数类型 */
export type CompletionFn = (prefix: string, suffix: string, language?: string) => Promise<{ text: string; latencyMs: number }>;

/**
 * 计算 Levenshtein 编辑距离
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/**
 * 计算编辑相似度（1 - 编辑距离 / 最大长度）
 */
function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

/**
 * 检查前缀匹配（预测是否以期望的前 N 个字符开头，或反之）
 */
function prefixMatchScore(predicted: string, expected: string): number {
  if (predicted === expected) return 1;
  const minLen = Math.min(predicted.length, expected.length);
  if (minLen === 0) return 0;
  let match = 0;
  for (let i = 0; i < minLen; i++) {
    if (predicted[i] === expected[i]) match++;
    else break;
  }
  return match / minLen;
}

/**
 * 检查第一个 token 是否匹配（按空白/符号分割）
 */
function firstTokenMatch(predicted: string, expected: string): boolean {
  const tokenize = (s: string) => s.trim().split(/[\s;,.(){}[\]]+/).filter(Boolean);
  const predTokens = tokenize(predicted);
  const expTokens = tokenize(expected);
  if (predTokens.length === 0 || expTokens.length === 0) return false;
  return predTokens[0] === expTokens[0];
}

/**
 * 补全模型评估器
 */
export class CompletionEvaluator {
  private samples: EvalSample[] = [];

  /**
   * 从 JSONL 文件加载评估样本
   */
  loadSamples(filePath: string): number {
    if (!existsSync(filePath)) throw new Error(`评估样本文件不存在: ${filePath}`);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    this.samples = lines.map((line) => {
      const obj = JSON.parse(line);
      return {
        prefix: obj.prefix,
        suffix: obj.suffix,
        expected: obj.middle,
        file_path: obj.file_path,
        language: obj.language,
      };
    });
    return this.samples.length;
  }

  /**
   * 设置评估样本
   */
  setSamples(samples: EvalSample[]): void {
    this.samples = samples;
  }

  /**
   * 运行评估
   */
  async evaluate(completionFn: CompletionFn, maxSamples?: number): Promise<EvalResult> {
    const samples = maxSamples ? this.samples.slice(0, maxSamples) : this.samples;
    if (samples.length === 0) throw new Error('没有评估样本');

    const details: EvalResult['details'] = [];
    const perLanguage: EvalResult['perLanguage'] = {};

    let exactMatchCount = 0;
    let totalEditSimilarity = 0;
    let totalPrefixMatch = 0;
    let firstTokenMatchCount = 0;
    let totalLatency = 0;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const { text: predicted, latencyMs } = await completionFn(sample.prefix, sample.suffix, sample.language);

      const exact = predicted === sample.expected;
      const editSim = editSimilarity(predicted, sample.expected);
      const prefixMatch = prefixMatchScore(predicted, sample.expected);
      const firstToken = firstTokenMatch(predicted, sample.expected);

      if (exact) exactMatchCount++;
      totalEditSimilarity += editSim;
      totalPrefixMatch += prefixMatch;
      if (firstToken) firstTokenMatchCount++;
      totalLatency += latencyMs;

      details.push({
        expected: sample.expected,
        predicted,
        exactMatch: exact,
        editSimilarity: editSim,
        latencyMs,
        language: sample.language,
      });

      // 按语言统计
      const lang = sample.language || 'unknown';
      if (!perLanguage[lang]) {
        perLanguage[lang] = { exactMatch: 0, editSimilarity: 0, count: 0 };
      }
      perLanguage[lang].count++;
      if (exact) perLanguage[lang].exactMatch++;
      perLanguage[lang].editSimilarity += editSim;
    }

    // 计算百分比
    for (const lang of Object.keys(perLanguage)) {
      const stat = perLanguage[lang];
      stat.exactMatch = stat.exactMatch / stat.count;
      stat.editSimilarity = stat.editSimilarity / stat.count;
    }

    return {
      exactMatch: exactMatchCount / samples.length,
      editSimilarity: totalEditSimilarity / samples.length,
      prefixMatch: totalPrefixMatch / samples.length,
      firstTokenMatch: firstTokenMatchCount / samples.length,
      avgLatencyMs: totalLatency / samples.length,
      totalSamples: samples.length,
      perLanguage,
      details,
    };
  }

  /**
   * 格式化评估结果为可读字符串
   */
  formatResult(result: EvalResult): string {
    const lines = [
      '=== 补全模型评估结果 ===',
      `样本数: ${result.totalSamples}`,
      `精确匹配率: ${(result.exactMatch * 100).toFixed(2)}%`,
      `编辑相似度: ${(result.editSimilarity * 100).toFixed(2)}%`,
      `前缀匹配率: ${(result.prefixMatch * 100).toFixed(2)}%`,
      `首Token匹配率: ${(result.firstTokenMatch * 100).toFixed(2)}%`,
      `平均延迟: ${result.avgLatencyMs.toFixed(2)}ms`,
      '',
      '--- 按语言统计 ---',
    ];

    for (const [lang, stat] of Object.entries(result.perLanguage)) {
      lines.push(
        `${lang}: ${stat.count} 样本, 精确匹配 ${(stat.exactMatch * 100).toFixed(1)}%, 编辑相似度 ${(stat.editSimilarity * 100).toFixed(1)}%`,
      );
    }

    return lines.join('\n');
  }

  /**
   * 保存评估结果到 JSON 文件
   */
  saveResult(result: EvalResult, outputPath: string): void {
    const outputDir = outputPath.includes('/') ? outputPath.slice(0, outputPath.lastIndexOf('/')) : '.';
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  }
}

/**
 * 便捷函数：评估补全模型
 */
export async function evaluateCompletion(
  samplesPath: string,
  completionFn: CompletionFn,
  maxSamples?: number,
): Promise<EvalResult> {
  const evaluator = new CompletionEvaluator();
  evaluator.loadSamples(samplesPath);
  return evaluator.evaluate(completionFn, maxSamples);
}

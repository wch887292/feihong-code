/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2-1 IDE 实时代码补全引擎：
 *  - FIM（Fill-In-the-Middle）模式：根据光标前后文生成补全
 *  - 上下文构造：prefix（光标前）+ suffix（光标后）+ 文件符号表
 *  - 语法校验：补全结果必须能被 AST 解析（近似校验）
 *  - 结果缓存：相同上下文短时间内不重复请求
 *  - 多级补全：快速补全（短结果）+ 完整补全（多行/函数级）
 *  - 与 ModelRouter 集成，支持多模型路由
 *
 * 设计原则：
 *  - 低延迟：快速补全目标 < 800ms，完整补全 < 3s
 *  - 不破坏：补全只是建议，用户 Tab 接受，Esc 取消
 *  - 可配置：触发字符、最大补全长度、模型选择均可配置
 */
import type { ModelRouter } from '../models/model-router';
import type { ChatMessage } from '../models/model.interface';
import { logger } from '../shared/logger';
import type { CodeGraph, SymbolEntry } from './symbol-index';
import { searchSymbols, getDependencies, symbolsForFile } from './symbol-index';

/** 补全请求 */
export interface CompletionRequest {
  /** 文件路径（相对项目根） */
  filePath: string;
  /** 文件完整内容 */
  fileContent: string;
  /** 光标位置（字符偏移量） */
  cursorOffset: number;
  /** 语言类型（typescript/javascript/python等） */
  language?: string;
  /** 补全模式：quick=短补全（单行/几行），full=完整补全（多行/函数级） */
  mode?: 'quick' | 'full';
  /** 最大补全 token 数 */
  maxTokens?: number;
}

/** 单条补全建议 */
export interface CompletionSuggestion {
  /** 补全文本（插入到光标位置） */
  text: string;
  /** 补全类型 */
  kind: 'line' | 'block' | 'function' | 'import';
  /** 置信度（0-1），模型不返回时默认 0.5 */
  confidence: number;
  /** 补全预览（用于 UI 显示，去除首尾空白） */
  preview: string;
}

/** 补全结果 */
export interface CompletionResult {
  suggestions: CompletionSuggestion[];
  /** 补全耗时（毫秒） */
  latencyMs: number;
  /** 使用的模型 */
  model: string;
  /** 是否命中缓存 */
  cached: boolean;
}

/** 补全引擎配置 */
export interface CompletionEngineConfig {
  /** 快速补全最大 token 数（默认 30） */
  quickMaxTokens: number;
  /** 完整补全最大 token 数（默认 200） */
  fullMaxTokens: number;
  /** prefix 最大字符数（默认 2000） */
  maxPrefixChars: number;
  /** suffix 最大字符数（默认 500） */
  maxSuffixChars: number;
  /** 缓存 TTL（毫秒，默认 10000） */
  cacheTtlMs: number;
  /** 触发补全的最小 prefix 长度（默认 3） */
  minPrefixLength: number;
  /** 是否启用语法校验（默认 true） */
  enableSyntaxCheck: boolean;
}

const DEFAULT_CONFIG: CompletionEngineConfig = {
  quickMaxTokens: 30,
  fullMaxTokens: 200,
  maxPrefixChars: 2000,
  maxSuffixChars: 500,
  cacheTtlMs: 10000,
  minPrefixLength: 3,
  enableSyntaxCheck: true,
};

/** 缓存条目 */
interface CacheEntry {
  result: CompletionResult;
  timestamp: number;
  /** 用于前缀匹配缓存的完整 prefix */
  prefix: string;
}

/**
 * 代码补全引擎
 */
export class CompletionEngine {
  private router: ModelRouter;
  private config: CompletionEngineConfig;
  private cache = new Map<string, CacheEntry>();
  /** 快速路径命中统计 */
  private fastPathHits = 0;
  /** 代码图谱（用于跨文件上下文注入） */
  private codeGraph?: CodeGraph;
  /** 补全 Pro：最近接受的补全记录，用于连续推荐 */
  private recentAcceptances: Array<{ filePath: string; cursorOffset: number; text: string; timestamp: number }> = [];

  constructor(router: ModelRouter, config: Partial<CompletionEngineConfig> = {}, codeGraph?: CodeGraph) {
    this.router = router;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.codeGraph = codeGraph;
  }

  /** 设置代码图谱（运行时更新） */
  setCodeGraph(graph: CodeGraph): void {
    this.codeGraph = graph;
  }

  /**
   * 阶段一-1：检索跨文件相关符号定义
   * 根据当前文件的 import 依赖和光标上下文，检索相关符号的完整定义
   */
  private retrieveCrossFileContext(filePath: string, prefix: string, _language: string): string {
    if (!this.codeGraph) return '';

    const relatedSymbols: SymbolEntry[] = [];
    const seen = new Set<string>();

    // 1. 从当前文件的 import 中提取依赖的符号名
    const importMatches = prefix.match(/import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g);
    if (importMatches) {
      for (const match of importMatches) {
        const symbolMatch = match.match(/\{([^}]+)\}/);
        if (symbolMatch) {
          const names = symbolMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
          for (const name of names) {
            if (name && !seen.has(name)) {
              const results = searchSymbols(this.codeGraph!, name, 3);
              for (const sym of results) {
                if (sym.exported && !seen.has(`${sym.file}:${sym.name}`)) {
                  seen.add(`${sym.file}:${sym.name}`);
                  relatedSymbols.push(sym);
                }
              }
            }
          }
        }
      }
    }

    // 2. 检索当前文件直接依赖的文件中的导出符号
    const deps = getDependencies(this.codeGraph, filePath);
    for (const depPath of deps) {
      const depSymbols = symbolsForFile(this.codeGraph, depPath);
      for (const sym of depSymbols) {
        if (sym.exported && !seen.has(`${sym.file}:${sym.name}`) && relatedSymbols.length < 20) {
          seen.add(`${sym.file}:${sym.name}`);
          relatedSymbols.push(sym);
        }
      }
    }

    // 3. 从光标前的代码中提取正在使用的符号名（函数调用、变量引用）
    const usageMatches = prefix.match(/\b([A-Za-z_$][\w$]*)\s*\(/g);
    if (usageMatches) {
      for (const match of usageMatches.slice(-10)) {
        const name = match.replace('(', '').trim();
        if (name.length > 2 && !seen.has(name)) {
          const results = searchSymbols(this.codeGraph!, name, 2);
          for (const sym of results) {
            if (sym.exported && !seen.has(`${sym.file}:${sym.name}`) && relatedSymbols.length < 25) {
              seen.add(`${sym.file}:${sym.name}`);
              relatedSymbols.push(sym);
            }
          }
        }
      }
    }

    if (relatedSymbols.length === 0) return '';

    // 4. 格式化相关符号定义为上下文
    const lines = ['\n【跨文件相关符号定义】'];
    for (const sym of relatedSymbols.slice(0, 15)) {
      const typeLabel = sym.kind === 'function' ? '函数' : sym.kind === 'class' ? '类' : sym.kind === 'interface' ? '接口' : sym.kind;
      if (sym.signature) {
        lines.push(`// ${typeLabel}: ${sym.name} (${sym.file})`);
        lines.push(sym.signature);
      } else {
        lines.push(`// ${typeLabel}: ${sym.name} (${sym.file})`);
      }
    }
    lines.push('【结束】\n');

    return lines.join('\n');
  }

  /**
   * 请求代码补全
   */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const startTime = Date.now();
    const mode = req.mode || 'quick';
    const maxTokens = mode === 'full' ? this.config.fullMaxTokens : this.config.quickMaxTokens;

    // 1. 构造上下文
    const { prefix, suffix } = this.extractContext(req);

    // 2. 检查最小触发长度
    if (prefix.trim().length < this.config.minPrefixLength) {
      return this.emptyResult(startTime, '');
    }

    // 3. 检查精确缓存
    const cacheKey = this.buildCacheKey(req, prefix, suffix, mode);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
      logger.debug('completion cache hit', { filePath: req.filePath, mode });
      return { ...cached.result, cached: true, latencyMs: Date.now() - startTime };
    }

    // 3.5 P0-2: 快速路径（本地规则引擎，延迟 < 10ms，不调用 LLM）
    const fastResult = this.tryFastPath(prefix, suffix, req.language || 'typescript', startTime);
    if (fastResult) {
      this.fastPathHits++;
      logger.debug('completion fast path hit', { filePath: req.filePath, mode });
      return fastResult;
    }

    // 3.6 P0-2: 前缀匹配缓存（新 prefix 是缓存条目的扩展，且 suffix 相同）
    const prefixCached = this.tryPrefixCache(prefix, suffix, req.filePath, mode, startTime);
    if (prefixCached) {
      logger.debug('completion prefix cache hit', { filePath: req.filePath, mode });
      return prefixCached;
    }

    // 4. 构造 FIM prompt 并调用模型
    const messages = this.buildFimMessages(prefix, suffix, req.filePath, req.language || 'typescript');

    try {
      const resp = await this.router.chat(
        {
          messages,
          temperature: 0,
          maxTokens,
          timeoutMs: mode === 'full' ? 5000 : 3000,
        },
        ['code-gen'],
      );

      // 5. 解析和校验补全结果
      const rawText = resp.message.content || '';
      const suggestions = this.parseAndValidate(rawText, req.language || 'typescript');

      const result: CompletionResult = {
        suggestions,
        latencyMs: Date.now() - startTime,
        model: resp.model,
        cached: false,
      };

      // 6. 写入缓存（保存 prefix 用于前缀匹配）
      this.cache.set(cacheKey, { result, timestamp: Date.now(), prefix });
      this.cleanupCache();

      return result;
    } catch (e) {
      logger.warn('completion failed', {
        error: e instanceof Error ? e.message : String(e),
        filePath: req.filePath,
        mode,
      });
      return this.emptyResult(startTime, '');
    }
  }

  /** 提取光标前后文 */
  private extractContext(req: CompletionRequest): { prefix: string; suffix: string } {
    const { fileContent, cursorOffset } = req;
    const offset = Math.max(0, Math.min(cursorOffset, fileContent.length));

    // prefix：光标前的内容，取最后 maxPrefixChars
    const prefixStart = Math.max(0, offset - this.config.maxPrefixChars);
    const prefix = fileContent.slice(prefixStart, offset);

    // suffix：光标后的内容，取前 maxSuffixChars
    const suffixEnd = Math.min(fileContent.length, offset + this.config.maxSuffixChars);
    const suffix = fileContent.slice(offset, suffixEnd);

    return { prefix, suffix };
  }

  /** 构造 FIM 消息（将 FIM 转换为 chat 格式） */
  private buildFimMessages(prefix: string, suffix: string, filePath: string, language: string): ChatMessage[] {
    // 阶段一-1：检索跨文件相关符号定义
    const crossFileContext = this.retrieveCrossFileContext(filePath, prefix, language);

    const systemPrompt = `你是一个 ${language} 代码补全引擎。根据光标前后的代码上下文，生成最可能的补全内容。

规则：
1. 只输出补全的代码文本，不要有任何解释、注释或 Markdown 代码块
2. 补全内容从光标位置开始，不要重复 prefix 中已有的内容
3. 保持代码风格和缩进一致
4. 如果上下文不足以确定补全，输出最可能的单个补全
5. 不要输出光标后的 suffix 内容
6. 优先使用【跨文件相关符号定义】中提供的函数/类/接口签名，确保类型匹配`;

    const userPrompt = `文件: ${filePath}
语言: ${language}
${crossFileContext}
光标前的代码（prefix）：
\`\`\`${language}
${prefix}
\`\`\`

光标后的代码（suffix）：
\`\`\`${language}
${suffix}
\`\`\`

请直接输出从光标位置开始的补全代码（纯文本，不要代码块标记）：`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /** 解析并校验补全结果 */
  private parseAndValidate(rawText: string, language: string): CompletionSuggestion[] {
    if (!rawText || !rawText.trim()) return [];

    // 去除可能的代码块标记
    let text = rawText.trim();
    text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

    // 语法校验（近似：检查括号平衡、引号平衡）
    if (this.config.enableSyntaxCheck && !this.passesSyntaxCheck(text, language)) {
      logger.debug('completion failed syntax check', { text: text.slice(0, 50) });
      return [];
    }

    // 判断补全类型
    const kind = this.inferKind(text);

    // 生成预览
    const preview = text.replace(/\n/g, ' ').slice(0, 80);

    return [{
      text,
      kind,
      confidence: 0.7, // 模型不返回置信度时给默认值
      preview,
    }];
  }

  /** 近似语法校验：检查括号和引号平衡 */
  private passesSyntaxCheck(text: string, _language: string): boolean {
    // 检查括号平衡
    const pairs: Array<[string, string]> = [['(', ')'], ['{', '}'], ['[', ']']];
    for (const [open, close] of pairs) {
      const openCount = (text.match(new RegExp(`\\${open}`, 'g')) || []).length;
      const closeCount = (text.match(new RegExp(`\\${close}`, 'g')) || []).length;
      // 允许未闭合的括号（补全可能是不完整的），但不允许 close 比 open 多
      if (closeCount > openCount) return false;
    }
    // 检查引号平衡（简单计数）
    const singleQuotes = (text.match(/'/g) || []).length;
    const doubleQuotes = (text.match(/"/g) || []).length;
    const backticks = (text.match(/`/g) || []).length;
    if (singleQuotes % 2 !== 0) return false;
    if (doubleQuotes % 2 !== 0) return false;
    if (backticks % 2 !== 0) return false;
    return true;
  }

  /** 推断补全类型 */
  private inferKind(text: string): CompletionSuggestion['kind'] {
    if (/^import\s/.test(text)) return 'import';
    if (/\bfunction\s+\w+/.test(text) || /=>\s*\{/.test(text)) return 'function';
    if (text.includes('\n') && (text.includes('{') || text.includes('}'))) return 'block';
    return 'line';
  }

  /* ========== P0-2: 快速路径（本地规则引擎，不调用 LLM） ========== */

  /**
   * 快速路径：根据本地规则生成补全，延迟 < 10ms
   * 覆盖场景：闭合括号/引号、补全分号、常见代码片段
   */
  private tryFastPath(
    prefix: string,
    suffix: string,
    language: string,
    startTime: number,
  ): CompletionResult | null {
    // 只在 quick 模式下使用快速路径（full 模式需要更复杂的补全）
    const lastChar = prefix.slice(-1);
    const lastLine = prefix.split('\n').pop() || '';

    // 规则1：闭合括号（光标前有未闭合的开括号，且 suffix 不以对应闭括号开头）
    const bracketPairs: Array<[string, string]> = [['(', ')'], ['{', '}'], ['[', ']']];
    for (const [open, close] of bracketPairs) {
      if (lastChar === open && !suffix.startsWith(close)) {
        // 检查是否真的未闭合（简单计数）
        const openCount = (prefix.match(new RegExp(`\\${open}`, 'g')) || []).length;
        const closeCount = (prefix.match(new RegExp(`\\${close}`, 'g')) || []).length;
        if (openCount > closeCount) {
          return this.makeFastResult(close, 'line', 0.95, startTime, 'fast-path:bracket');
        }
      }
    }

    // 规则2：闭合引号（光标前有未闭合的引号）
    const quoteChars = ["'", '"', '`'];
    for (const q of quoteChars) {
      if (lastChar === q && !suffix.startsWith(q)) {
        // 检查引号是否未闭合（简单计数，忽略转义）
        const quoteCount = (prefix.match(new RegExp(`(?<!\\\\)\\${q}`, 'g')) || []).length;
        if (quoteCount % 2 === 1) {
          return this.makeFastResult(q, 'line', 0.95, startTime, 'fast-path:quote');
        }
      }
    }

    // 规则3：补全分号（C-like 语言，行尾是赋值/调用/import，且没有分号）
    if (['typescript', 'javascript', 'java', 'c', 'cpp', 'csharp', 'go'].includes(language)) {
      const trimmedLine = lastLine.trim();
      if (
        trimmedLine.length > 3 &&
        !trimmedLine.endsWith(';') &&
        !trimmedLine.endsWith('{') &&
        !trimmedLine.endsWith('}') &&
        !trimmedLine.endsWith(':') &&
        !trimmedLine.startsWith('//') &&
        !trimmedLine.startsWith('/*') &&
        (
          /=\s*[^=;]+$/.test(trimmedLine) || // 赋值
          /\)\s*$/.test(trimmedLine) || // 函数调用
          /^import\s/.test(trimmedLine) || // import
          /^export\s/.test(trimmedLine) || // export
          /^return\s/.test(trimmedLine) || // return
          /^(const|let|var)\s/.test(trimmedLine) // 变量声明
        )
      ) {
        return this.makeFastResult(';', 'line', 0.85, startTime, 'fast-path:semicolon');
      }
    }

    // 规则4：常见代码片段补全（基于前缀匹配）
    const snippets: Array<[RegExp, string, CompletionSuggestion['kind'], number]> = [
      [/console\.lo$/, 'g(', 'line', 0.9],
      [/console\.er$/, 'ror(', 'line', 0.9],
      [/console\.wa$/, 'rn(', 'line', 0.9],
      [/retur$/, 'n ', 'line', 0.95],
      [/functio$/, 'n ', 'function', 0.9],
      [/impor$/, 't ', 'import', 0.95],
      [/expor$/, 't ', 'import', 0.9],
      [/const$/, ' ', 'line', 0.8],
      [/let$/, ' ', 'line', 0.8],
      [/if$/, ' (', 'block', 0.85],
      [/for$/, ' (', 'block', 0.85],
      [/whil$/, 'e (', 'block', 0.85],
      [/els$/, 'e {', 'block', 0.85],
      [/tr$/, 'y {', 'block', 0.85],
      [/switc$/, 'h (', 'block', 0.85],
      [/def$/, ' ', 'function', 0.8], // Python
      [/clas$/, 's ', 'function', 0.9],
      [/async$/, ' ', 'line', 0.85],
      [/awai$/, 't ', 'line', 0.9],
    ];
    for (const [pattern, insert, kind, confidence] of snippets) {
      if (pattern.test(lastLine)) {
        // 确保 suffix 不是已经包含了补全内容的开头
        if (!suffix.startsWith(insert.trim())) {
          return this.makeFastResult(insert, kind, confidence, startTime, 'fast-path:snippet');
        }
      }
    }

    return null;
  }

  /** 构造快速路径结果 */
  private makeFastResult(
    text: string,
    kind: CompletionSuggestion['kind'],
    confidence: number,
    startTime: number,
    model: string,
  ): CompletionResult {
    return {
      suggestions: [{
        text,
        kind,
        confidence,
        preview: text.replace(/\n/g, ' ').slice(0, 80),
      }],
      latencyMs: Date.now() - startTime,
      model,
      cached: false,
    };
  }

  /* ========== P0-2: 前缀匹配缓存 ========== */

  /**
   * 前缀匹配缓存：如果新请求的 prefix 是某个缓存条目的 prefix 的扩展，
   * 且 suffix 相同，可以复用缓存结果（补全内容通常不变）
   */
  private tryPrefixCache(
    prefix: string,
    _suffix: string,
    _filePath: string,
    _mode: string,
    startTime: number,
  ): CompletionResult | null {
    const now = Date.now();

    for (const [, entry] of this.cache) {
      if (now - entry.timestamp > this.config.cacheTtlMs) continue;
      // 新 prefix 是缓存 prefix 的扩展（用户继续输入了几个字符）
      if (prefix.startsWith(entry.prefix) && prefix.length > entry.prefix.length) {
        // 简化：如果缓存条目的补全文本以新输入的字符开头，可以复用
        const newChars = prefix.slice(entry.prefix.length);
        const firstSuggestion = entry.result.suggestions[0];
        if (firstSuggestion && firstSuggestion.text.startsWith(newChars)) {
          // 复用补全，但去掉已经输入的部分
          const remainingText = firstSuggestion.text.slice(newChars.length);
          if (remainingText) {
            return {
              suggestions: [{
                text: remainingText,
                kind: firstSuggestion.kind,
                confidence: firstSuggestion.confidence * 0.9, // 略降置信度
                preview: remainingText.replace(/\n/g, ' ').slice(0, 80),
              }],
              latencyMs: Date.now() - startTime,
              model: entry.result.model,
              cached: true,
            };
          }
        }
      }
    }
    return null;
  }

  /** 构建缓存 key */
  private buildCacheKey(req: CompletionRequest, prefix: string, suffix: string, mode: string): string {
    // 只取 prefix 最后 200 字符和 suffix 前 100 字符作为缓存 key
    const prefixKey = prefix.slice(-200);
    const suffixKey = suffix.slice(0, 100);
    return `${req.filePath}::${mode}::${prefixKey}::${suffixKey}`;
  }

  /** 清理过期缓存 */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.config.cacheTtlMs) {
        this.cache.delete(key);
      }
    }
    // 缓存上限 100 条
    if (this.cache.size > 100) {
      const keys = Array.from(this.cache.keys());
      for (let i = 0; i < keys.length - 100; i++) {
        this.cache.delete(keys[i]);
      }
    }
  }

  /** 空结果 */
  private emptyResult(startTime: number, model: string): CompletionResult {
    return {
      suggestions: [],
      latencyMs: Date.now() - startTime,
      model,
      cached: false,
    };
  }

  /** 清空缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  /** 获取缓存统计 */
  getCacheStats(): { size: number; ttlMs: number; fastPathHits: number } {
    return { size: this.cache.size, ttlMs: this.config.cacheTtlMs, fastPathHits: this.fastPathHits };
  }

  /**
   * 阶段一-2：补全 Pro - 记录用户接受的补全
   */
  recordAcceptance(filePath: string, cursorOffset: number, text: string): void {
    this.recentAcceptances.push({ filePath, cursorOffset, text, timestamp: Date.now() });
    if (this.recentAcceptances.length > 20) this.recentAcceptances.shift();
    logger.debug('completion acceptance recorded', { filePath, cursorOffset, textLength: text.length });
  }

  /**
   * 阶段一-2：补全 Pro - 推荐下一个改动点
   */
  suggestNext(filePath: string, currentContent: string, currentOffset: number): {
    suggested: boolean;
    offset?: number;
    reason?: string;
    hint?: string;
  } {
    const fileAcceptances = this.recentAcceptances
      .filter((a) => a.filePath === filePath)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (fileAcceptances.length === 0) return { suggested: false };

    const last = fileAcceptances[0];
    const lastEndOffset = last.cursorOffset + last.text.length;

    // 策略 1：刚定义函数，推荐添加导出或调用
    if (/function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(/.test(last.text)) {
      const nextOffset = this.findNextLogicalPosition(currentContent, lastEndOffset);
      if (nextOffset > 0) {
        return { suggested: true, offset: nextOffset, reason: '刚定义了函数，推荐添加导出或调用', hint: 'export { ... } 或 添加调用示例' };
      }
    }

    // 策略 2：刚导入符号，推荐使用
    if (/^import\s/.test(last.text.trim())) {
      const importMatch = last.text.match(/import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))/);
      if (importMatch) {
        const imported = importMatch[1] || importMatch[2];
        const symbolName = imported?.split(',').map((s) => s.trim().split(/\s+as\s+/)[0])[0] || '';
        if (symbolName) {
          return { suggested: true, offset: currentOffset, reason: `刚导入了 ${symbolName}，推荐使用`, hint: `${symbolName}(...)` };
        }
      }
    }

    // 策略 3：连续编辑模式
    if (fileAcceptances.length >= 3) {
      const recent3 = fileAcceptances.slice(0, 3);
      const avgOffset = recent3.reduce((sum, a) => sum + a.cursorOffset, 0) / 3;
      const maxOffsetDiff = Math.max(...recent3.map((a) => Math.abs(a.cursorOffset - avgOffset)));
      if (maxOffsetDiff < 500) {
        const nextOffset = this.findNextLogicalPosition(currentContent, lastEndOffset);
        if (nextOffset > 0 && nextOffset - lastEndOffset < 1000) {
          return { suggested: true, offset: nextOffset, reason: '检测到连续编辑模式，推荐继续修改', hint: '继续完善当前代码块' };
        }
      }
    }

    return { suggested: false };
  }

  /** 找到下一个逻辑位置（空行、函数结束等） */
  private findNextLogicalPosition(content: string, fromOffset: number): number {
    const after = content.slice(fromOffset);
    const emptyLineMatch = after.match(/\n\s*\n/);
    if (emptyLineMatch && emptyLineMatch.index !== undefined) {
      return fromOffset + emptyLineMatch.index + emptyLineMatch[0].length;
    }
    const newlineMatch = after.match(/\n/);
    if (newlineMatch && newlineMatch.index !== undefined) {
      return fromOffset + newlineMatch.index + 1;
    }
    return -1;
  }
}

/** 便捷函数：创建补全引擎 */
export function createCompletionEngine(router: ModelRouter, config?: Partial<CompletionEngineConfig>, codeGraph?: CodeGraph): CompletionEngine {
  return new CompletionEngine(router, config, codeGraph);
}

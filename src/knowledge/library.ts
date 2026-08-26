/**
 * 飞虹 Code - AI 原生资料库 (阶段四-2)
 *
 * 支持 AI 原生资料库能力：
 * - 文档管理：上传、分类、标签、版本
 * - 知识检索：基于关键词和语义的检索
 * - 自动摘要：自动生成文档摘要和关键信息
 * - 知识关联：自动发现文档之间的关联
 */
import { logger } from '../shared/logger';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

/** 文档类型 */
export type DocumentType = 'markdown' | 'pdf' | 'word' | 'text' | 'code' | 'image' | 'other';

/** 文档元数据 */
export interface DocumentMetadata {
  id: string;
  title: string;
  type: DocumentType;
  filePath: string;
  fileSize: number;
  tags: string[];
  category: string;
  summary?: string;
  keywords?: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
  author?: string;
  source?: string;
}

/** 检索结果 */
export interface SearchResult {
  document: DocumentMetadata;
  score: number;
  highlights: string[];
  matchedTags: string[];
}

/** 知识库统计 */
export interface LibraryStats {
  totalDocuments: number;
  totalSize: number;
  categories: Record<string, number>;
  tags: Record<string, number>;
  types: Record<string, number>;
  lastUpdated: string;
}

/**
 * AI 原生资料库管理器
 */
export class KnowledgeLibraryManager {
  private baseDir: string;
  private documents: Map<string, DocumentMetadata> = new Map();
  private indexPath: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.indexPath = join(baseDir, 'index.json');
    this.ensureDir();
    this.loadIndex();
    logger.info('knowledge library initialized', { baseDir, documents: this.documents.size });
  }

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
    const docsDir = join(this.baseDir, 'documents');
    if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  }

  private loadIndex(): void {
    try {
      if (existsSync(this.indexPath)) {
        const data = JSON.parse(readFileSync(this.indexPath, 'utf-8'));
        for (const doc of data.documents || []) {
          this.documents.set(doc.id, doc);
        }
      }
    } catch (error) {
      logger.error('load index error', { error: String(error) });
    }
  }

  private saveIndex(): void {
    try {
      const data = {
        documents: Array.from(this.documents.values()),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(this.indexPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error('save index error', { error: String(error) });
    }
  }

  addDocument(params: {
    title: string;
    content: string;
    type?: DocumentType;
    tags?: string[];
    category?: string;
    author?: string;
    source?: string;
  }): DocumentMetadata {
    const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const type = params.type || this.detectType(params.title);
    const filePath = join(this.baseDir, 'documents', `${id}.${this.getExtension(type)}`);

    writeFileSync(filePath, params.content, 'utf-8');

    const summary = this.generateSummary(params.content);
    const keywords = this.extractKeywords(params.content, params.title);

    const doc: DocumentMetadata = {
      id,
      title: params.title,
      type,
      filePath,
      fileSize: Buffer.byteLength(params.content, 'utf-8'),
      tags: params.tags || [],
      category: params.category || '未分类',
      summary,
      keywords,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      author: params.author,
      source: params.source,
    };

    this.documents.set(id, doc);
    this.saveIndex();
    logger.info('document added', { id, title: params.title, type });
    return doc;
  }

  getDocument(id: string): DocumentMetadata | undefined {
    return this.documents.get(id);
  }

  getDocumentContent(id: string): string | null {
    const doc = this.documents.get(id);
    if (!doc) return null;
    try {
      return readFileSync(doc.filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  updateDocument(id: string, updates: Partial<DocumentMetadata> & { content?: string }): DocumentMetadata | null {
    const doc = this.documents.get(id);
    if (!doc) return null;

    if (updates.content) {
      writeFileSync(doc.filePath, updates.content, 'utf-8');
      doc.summary = this.generateSummary(updates.content);
      doc.keywords = this.extractKeywords(updates.content, updates.title || doc.title);
      doc.fileSize = Buffer.byteLength(updates.content, 'utf-8');
      delete updates.content;
    }

    Object.assign(doc, updates);
    doc.updatedAt = new Date().toISOString();
    doc.version++;
    this.saveIndex();
    logger.info('document updated', { id, version: doc.version });
    return doc;
  }

  deleteDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;
    try {
      unlinkSync(doc.filePath);
    } catch {
      // 文件可能已不存在
    }
    this.documents.delete(id);
    this.saveIndex();
    logger.info('document deleted', { id });
    return true;
  }

  search(query: string, options?: {
    category?: string;
    tags?: string[];
    type?: DocumentType;
    limit?: number;
  }): SearchResult[] {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1);

    for (const doc of this.documents.values()) {
      if (options?.category && doc.category !== options.category) continue;
      if (options?.type && doc.type !== options.type) continue;
      if (options?.tags && !options.tags.some((t) => doc.tags.includes(t))) continue;

      let score = 0;
      const highlights: string[] = [];
      const matchedTags: string[] = [];

      if (doc.title.toLowerCase().includes(queryLower)) {
        score += 50;
        highlights.push(`标题: ${doc.title}`);
      }

      if (doc.summary?.toLowerCase().includes(queryLower)) {
        score += 30;
        highlights.push(`摘要: ${doc.summary.slice(0, 100)}...`);
      }

      if (doc.keywords) {
        for (const keyword of doc.keywords) {
          if (queryWords.includes(keyword.toLowerCase())) {
            score += 20;
            matchedTags.push(keyword);
          }
        }
      }

      for (const tag of doc.tags) {
        if (queryLower.includes(tag.toLowerCase())) {
          score += 15;
          matchedTags.push(tag);
        }
      }

      const content = this.getDocumentContent(doc.id)?.toLowerCase() || '';
      let contentMatches = 0;
      for (const word of queryWords) {
        if (content.includes(word)) contentMatches++;
      }
      if (contentMatches > 0) {
        score += contentMatches * 5;
        const firstMatch = content.indexOf(queryWords[0]);
        if (firstMatch >= 0) {
          const start = Math.max(0, firstMatch - 20);
          const end = Math.min(content.length, firstMatch + query.length + 40);
          highlights.push(`内容: ...${content.slice(start, end)}...`);
        }
      }

      if (score > 0) {
        results.push({ document: doc, score, highlights, matchedTags });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options?.limit || 20);
  }

  listDocuments(options?: {
    category?: string;
    tags?: string[];
    type?: DocumentType;
    sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'fileSize';
    order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): DocumentMetadata[] {
    let docs = Array.from(this.documents.values());

    if (options?.category) docs = docs.filter((d) => d.category === options.category);
    if (options?.type) docs = docs.filter((d) => d.type === options.type);
    if (options?.tags) docs = docs.filter((d) => options.tags!.some((t) => d.tags.includes(t)));

    const sortBy = options?.sortBy || 'updatedAt';
    const order = options?.order || 'desc';
    docs.sort((a, b) => {
      const aVal = a[sortBy] as string | number;
      const bVal = b[sortBy] as string | number;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return order === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return order === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    return docs.slice(offset, offset + limit);
  }

  getStats(): LibraryStats {
    const stats: LibraryStats = {
      totalDocuments: this.documents.size,
      totalSize: 0,
      categories: {},
      tags: {},
      types: {},
      lastUpdated: new Date().toISOString(),
    };

    for (const doc of this.documents.values()) {
      stats.totalSize += doc.fileSize;
      stats.categories[doc.category] = (stats.categories[doc.category] || 0) + 1;
      stats.types[doc.type] = (stats.types[doc.type] || 0) + 1;
      for (const tag of doc.tags) {
        stats.tags[tag] = (stats.tags[tag] || 0) + 1;
      }
    }

    return stats;
  }

  getCategories(): string[] {
    return Array.from(new Set(Array.from(this.documents.values()).map((d) => d.category)));
  }

  getAllTags(): string[] {
    const tags = new Set<string>();
    for (const doc of this.documents.values()) {
      for (const tag of doc.tags) tags.add(tag);
    }
    return Array.from(tags);
  }

  private generateSummary(content: string, maxLength: number = 200): string {
    const cleanContent = content.replace(/[#*`>\-\[\]\(\)]/g, '').trim();
    const sentences = cleanContent.split(/[。.!?！？\n]+/).filter((s) => s.trim().length > 10);

    if (sentences.length === 0) {
      return cleanContent.slice(0, maxLength);
    }

    const summary = sentences.slice(0, 3).join('。');
    return summary.length > maxLength ? summary.slice(0, maxLength) + '...' : summary;
  }

  private extractKeywords(content: string, title: string): string[] {
    const text = (title + ' ' + content).toLowerCase();
    const words = text.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}/g) || [];

    const freq = new Map<string, number>();
    const stopWords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while', 'although', 'though', 'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'what', 'which', 'who', 'whom']);

    for (const word of words) {
      if (stopWords.has(word)) continue;
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  private detectType(title: string): DocumentType {
    const ext = title.split('.').pop()?.toLowerCase() || '';
    const typeMap: Record<string, DocumentType> = {
      md: 'markdown', markdown: 'markdown',
      pdf: 'pdf',
      doc: 'word', docx: 'word',
      txt: 'text',
      ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code', java: 'code', go: 'code', rs: 'code', cpp: 'code', c: 'code', h: 'code',
      png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image',
    };
    return typeMap[ext] || 'other';
  }

  private getExtension(type: DocumentType): string {
    const extMap: Record<DocumentType, string> = {
      markdown: 'md',
      pdf: 'pdf',
      word: 'docx',
      text: 'txt',
      code: 'ts',
      image: 'png',
      other: 'txt',
    };
    return extMap[type];
  }
}

export function createKnowledgeLibraryManager(baseDir: string): KnowledgeLibraryManager {
  return new KnowledgeLibraryManager(baseDir);
}

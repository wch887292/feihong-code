/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 代码知识向量 RAG 可选通道（hybrid 默认关闭，不影响现有符号 RAG 默认路径）：
 *  - 使用 node:sqlite 建 chunks 表，embedding 以 Float32 BLOB 存储
 *  - 提供文本切分、幂等索引、暴力 cosine 检索 topK
 *  - 敏感文件（id_rsa、.env 等）不入向量库
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';
import type { ModelProvider } from '../models/model.interface';

/** 向量 RAG 配置 */
export interface VectorRagConfig {
  /** 向量库 SQLite 文件路径 */
  db: string;
  /** 嵌入模型名（传给 provider embed 方法） */
  model?: string;
  /** 检索返回的 topK 块数 */
  topK: number;
  /** 单块最大字符数 */
  chunkSize?: number;
  /** 相邻块重叠字符数 */
  chunkOverlap?: number;
}

/** 向量检索命中的块 */
export interface VectorHit {
  /** 文件相对路径 */
  file: string;
  /** 块内容 */
  chunk: string;
  /** 与查询向量的 cosine 相似度（0-1） */
  score: number;
}

/** 敏感文件判定：id_rsa 与 .env 不入向量库 */
const SENSITIVE_PATTERNS = [
  /(^|[\\/])id_rsa([^\\/]*)?$/,
  /(^|[\\/])\.env([^\\/]*)?$/,
  /(^|[\\/])\.env\./,
  /(^|[\\/])id_ed25519([^\\/]*)?$/,
  /(^|[\\/])id_ecdsa([^\\/]*)?$/,
  /(^|[\\/])\.pem$/,
  /(^|[\\/])\.key$/,
  /(^|[\\/])credentials([^\\/]*)?$/,
  /(^|[\\/])secrets([^\\/]*)?$/,
];

/** 判断文件路径是否敏感（敏感文件不入向量库） */
export function isSensitiveFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return SENSITIVE_PATTERNS.some((re) => re.test(normalized));
}

/** 默认切分参数 */
const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 100;

/**
 * 文本切分：按行聚合到接近 chunkSize 的块，块间保留 chunkOverlap 字符重叠。
 * 优先在空行/换行处断开，避免把代码行拦腰截断。
 */
export function splitIntoChunks(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  chunkOverlap: number = DEFAULT_CHUNK_OVERLAP,
): string[] {
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    // 若当前块未到文件尾，尝试在最近的换行处断开
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end);
      if (newline > start) end = newline + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - chunkOverlap, start + 1);
  }
  return chunks;
}

/** 计算文本的稳定哈希（幂等索引去重用） */
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 计算两个 Float32 向量的 cosine 相似度 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 将 number[] 编码为 Float32 BLOB（SQLite 存储用） */
export function encodeEmbedding(vec: number[]): Uint8Array {
  const f32 = new Float32Array(vec);
  return new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
}

/** 将 Float32 BLOB 解码为 Float32Array（拷贝到独立对齐的 ArrayBuffer，规避 SQLite Buffer 非 4 字节对齐） */
export function decodeEmbedding(blob: Uint8Array): Float32Array {
  const n = blob.byteLength >> 2;
  const out = new Float32Array(n);
  const u8 = new Uint8Array(out.buffer, 0, out.byteLength);
  u8.set(blob);
  return out;
}

/**
 * 代码知识向量库：负责建表、幂等索引与暴力 cosine 检索。
 * 使用 node:sqlite 的 DatabaseSync（同步 API，构建期无需原生编译）。
 */
export class VectorRagStore {
  private readonly db: DatabaseSync;
  private readonly config: VectorRagConfig;

  constructor(config: VectorRagConfig) {
    this.config = config;
    if (config.db) {
      mkdirSync(dirname(config.db), { recursive: true });
    }
    this.db = new DatabaseSync(config.db);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file TEXT NOT NULL,
        chunk TEXT NOT NULL,
        embedding BLOB NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(hash);
    `);
  }

  /** 关闭数据库连接 */
  close(): void {
    try {
      this.db.close();
    } catch {
      /* 已关闭则忽略 */
    }
  }

  /**
   * 幂等索引：按 file 删除旧块后重新写入（同文件内容变化时自动更新）。
   * 若文件未变化（所有块 hash 与库中一致）则跳过写入，避免重复消耗嵌入 API。
   */
  async indexFile(
    provider: ModelProvider,
    relPath: string,
    absPath: string,
    opts?: { chunkSize?: number; chunkOverlap?: number },
  ): Promise<number> {
    if (isSensitiveFile(relPath)) return 0;
    if (!existsSync(absPath)) return 0;

    const content = readFileSync(absPath, 'utf8');
    const chunks = splitIntoChunks(
      content,
      opts?.chunkSize ?? this.config.chunkSize ?? DEFAULT_CHUNK_SIZE,
      opts?.chunkOverlap ?? this.config.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    );
    if (chunks.length === 0) return 0;

    // 幂等：若所有块 hash 均已存在且属于该文件，则跳过
    const existingStmt = this.db.prepare('SELECT hash FROM chunks WHERE file = ?');
    const existing = new Set((existingStmt.all(relPath) as Array<{ hash: string }>).map((r) => r.hash));
    const newHashes = chunks.map((c) => hashText(c));
    if (newHashes.every((h) => existing.has(h))) return 0;

    // 计算嵌入向量（provider 需支持 embed 方法）
    if (typeof (provider as { embed?: unknown }).embed !== 'function') {
      throw new Error(`Provider ${provider.id} 不支持 embed 方法，无法索引向量`);
    }
    const embeddings = await (provider as unknown as {
      embed(texts: string[], model?: string): Promise<number[][]>;
    }).embed(chunks, this.config.model);

    if (embeddings.length !== chunks.length) {
      throw new Error(`嵌入返回数量 ${embeddings.length} 与块数 ${chunks.length} 不一致`);
    }

    const ts = Date.now();
    const delStmt = this.db.prepare('DELETE FROM chunks WHERE file = ?');
    const insStmt = this.db.prepare(
      'INSERT OR REPLACE INTO chunks (file, chunk, embedding, hash, ts) VALUES (?, ?, ?, ?, ?)',
    );
    this.db.exec('BEGIN');
    try {
      delStmt.run(relPath);
      for (let i = 0; i < chunks.length; i++) {
        insStmt.run(relPath, chunks[i], encodeEmbedding(embeddings[i]), newHashes[i], ts);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return chunks.length;
  }

  /**
   * 暴力 cosine 检索：遍历全部块，返回相似度最高的 topK 个。
   */
  search(queryEmbedding: number[], topK?: number): VectorHit[] {
    const k = Math.max(1, topK ?? this.config.topK);
    const rows = this.db
      .prepare('SELECT file, chunk, embedding FROM chunks')
      .all() as Array<{ file: string; chunk: string; embedding: Uint8Array }>;

    const q = new Float32Array(queryEmbedding);
    const scored: Array<VectorHit & { _sim: number }> = [];
    for (const row of rows) {
      const vec = decodeEmbedding(row.embedding);
      const sim = cosineSimilarity(q, vec);
      if (sim > 0) {
        scored.push({ file: row.file, chunk: row.chunk, score: sim, _sim: sim });
      }
    }
    scored.sort((a, b) => b._sim - a._sim);
    return scored.slice(0, k).map(({ file, chunk, score }) => ({ file, chunk, score }));
  }

  /** 库中块总数 */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number };
    return Number(row.n);
  }

  /** 已索引文件列表 */
  indexedFiles(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT file FROM chunks').all() as Array<{ file: string }>;
    return rows.map((r) => r.file);
  }
}

/** 便捷函数：创建向量库（保持与 code-rag 的 createRagRetriever 风格一致） */
export function createVectorRagStore(config: VectorRagConfig): VectorRagStore {
  return new VectorRagStore(config);
}
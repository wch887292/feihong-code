/**
 * P0-1 向量 RAG 自包含 smoke（tsx 直跑；放在 repo 根、不入 tests/ 故不被 npm test 自动拉起）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 验证点：
 *  1) vector-rag 纯函数（isSensitiveFile / splitIntoChunks / cosine / encode-decode）
 *  2) VectorRagStore indexFile + search（mock provider，暴力 cosine）可跑通
 *  3) 敏感文件（.env / id_rsa）不入向量库
 *  4) 幂等索引（内容未变则跳过）
 *  5) 默认关闭：不传/未启用 vector 时结果与旧符号路径一致
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isSensitiveFile,
  splitIntoChunks,
  cosineSimilarity,
  encodeEmbedding,
  decodeEmbedding,
  VectorRagStore,
} from './src/knowledge/vector-rag';
import { retrieveRelevantFiles } from './src/agent/code-rag';
import { buildCodeGraph } from './src/agent/symbol-index';
import type { ModelProvider } from './src/models/model.interface';

const root = mkdtempSync(join(tmpdir(), 'fh-p01-'));
writeFileSync(join(root, 'alpha.ts'), 'export function alphaCalc() { return 42; }\nexport const ALPHA_NAME = "alpha";\n');
writeFileSync(join(root, 'beta.ts'), 'export function betaCalc() { return 7; }\nexport const BETA_NAME = "beta";\n');
writeFileSync(join(root, 'gamma.ts'), 'export function gammaCalc() { return 9; }\nexport const GAMMA_NAME = "gamma";\n');
writeFileSync(join(root, '.env'), 'SECRET_KEY=abc\n');
writeFileSync(join(root, 'id_rsa'), 'ssh-rsa AAAA\n');

function detVec(t: string): number[] {
  const dims = 8;
  const out: number[] = [];
  for (let d = 0; d < dims; d++) {
    let x = 0;
    for (const c of t) x = (x * 31 + c.charCodeAt(0) + d * 7) % 997;
    out.push(x / 997 - 0.5);
  }
  return out;
}
const mockProvider = {
  id: 'mock',
  model: 'mock-embed',
  tags: [] as string[],
  chat: async () => ({ content: '', toolCalls: [] }),
  embed: async (texts: string[]) => texts.map(detVec),
} as unknown as ModelProvider;

(async () => {
  // 1) 纯函数
  assert.ok(isSensitiveFile('secrets/.env'), '.env 应判敏感');
  assert.ok(isSensitiveFile('keys/id_rsa'), 'id_rsa 应判敏感');
  assert.ok(!isSensitiveFile('src/foo.ts'), '普通 ts 不敏感');
  const chunks = splitIntoChunks('x'.repeat(2000), 800, 100);
  assert.ok(chunks.length > 1 && chunks[0].length <= 800, '切分块大小受控');
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([0, 1, 0]);
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-9, '正交向量 cosine≈0');
  assert.ok(Array.from(decodeEmbedding(encodeEmbedding([1, 2, 3]))).join(',') === '1,2,3', '编解码往返一致');
  console.log('PASS P0-1.1 纯函数');

  // 2) 向量库 index + search（幂等 + 敏感跳过）
  const store = new VectorRagStore({ db: join(root, 'vec.db'), model: 'mock-embed', topK: 3 });
  await store.indexFile(mockProvider, 'alpha.ts', join(root, 'alpha.ts'));
  await store.indexFile(mockProvider, 'beta.ts', join(root, 'beta.ts'));
  await store.indexFile(mockProvider, 'gamma.ts', join(root, 'gamma.ts'));
  assert.equal(await store.indexFile(mockProvider, '.env', join(root, '.env')), 0, '.env 跳过');
  assert.equal(await store.indexFile(mockProvider, 'id_rsa', join(root, 'id_rsa')), 0, 'id_rsa 跳过');
  assert.deepEqual(store.indexedFiles().sort(), ['alpha.ts', 'beta.ts', 'gamma.ts'].sort(), '仅 3 普通文件入库');
  const q = await mockProvider.embed!(['gammaCalc GAMMA_NAME 9']);
  const hits = store.search(q[0], 3);
  assert.ok(hits.length >= 1 && hits[0].score <= 1 && hits[0].score >= 0, '向量检索命中且分在 [0,1]');
  console.log(`PASS P0-1.2/3 向量库可跑 + 敏感跳过（top1=${hits[0].file} score=${hits[0].score.toFixed(3)}）`);

  // 4) 幂等
  assert.equal(await store.indexFile(mockProvider, 'alpha.ts', join(root, 'alpha.ts')), 0, '内容未变幂等跳过');
  console.log('PASS P0-1.4 幂等索引');

  // 5) 默认关闭
  const graph = buildCodeGraph(root, { maxFiles: 100 });
  const noVec = await retrieveRelevantFiles(graph, 'alphaCalc ALPHA_NAME', {});
  assert.ok(noVec.coreFiles.length > 0, '符号检索仍有命中');
  const noVec2 = await retrieveRelevantFiles(graph, 'alphaCalc ALPHA_NAME', {}, mockProvider);
  assert.deepEqual(
    noVec2.coreFiles.map((f) => f.path).sort(),
    noVec.coreFiles.map((f) => f.path).sort(),
    '未启用 vector 时结果与纯符号路径一致',
  );
  console.log('PASS P0-1.5 默认关闭：未启用 vector 时与旧符号路径一致');

  store.close();
  console.log('\n=== P0-1 全部 5 项验证通过 ===');
})().catch((e) => {
  console.error('P0-1 smoke FAILED:', e);
  process.exit(1);
});

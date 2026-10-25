/**
 * P0-2 本地模型自包含 smoke（tsx 直跑；放 repo 根、不入 tests/ 不污染 CI）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 验证点（全离线：起本地 mock Ollama，随机端口）：
 *  1) catalog：3 个模型元数据齐全（id/sizeGb/quantization/useCase）
 *  2) probeOllama 可达分支：available=true、能取到 models/version
 *  3) probeOllama 不可达分支（指向无监听端口）：fail-open，available=false、gpu=cpu，不抛错
 *  4) localModelStatus 聚合字段正确
 *  5) ensureOllamaModel：已存在跳过（不触发 pull）/ 未存在触发 pull（mock 返回 done）
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  LOCAL_MODEL_CATALOG,
  findLocalModel,
} from './src/models/local-model-catalog';
import { probeOllama } from './src/models/device-probe';
import { localModelStatus, ensureOllamaModel } from './src/models/local-model';

(async () => {
  // 1) catalog
  assert.ok(LOCAL_MODEL_CATALOG.length >= 2, 'catalog ≥2 模型');
  for (const m of LOCAL_MODEL_CATALOG) {
    assert.ok(m.id && m.sizeGb > 0 && m.quantization && m.useCase, `模型 ${m.id} 元数据齐全`);
  }
  assert.ok(findLocalModel(LOCAL_MODEL_CATALOG[0].id), 'findLocalModel 命中');
  console.log(`PASS P0-2.1 catalog（${LOCAL_MODEL_CATALOG.length} 模型：${LOCAL_MODEL_CATALOG.map((m) => m.id).join(', ')}）`);

  // mock Ollama：/api/tags 返回 1 个模型 + /api/version + /api/pull
  let pullCount = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.includes('/api/tags')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: LOCAL_MODEL_CATALOG[0].id }] }));
    } else if (req.url?.includes('/api/version')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ version: '0.0.0-mock' }));
    } else if (req.url?.includes('/api/pull')) {
      pullCount += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'success', done: true }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const mockBase = `http://127.0.0.1:${port}`;

  // 2) 可达分支
  const ok = await probeOllama(mockBase);
  assert.equal(ok.available, true, '可达时 available=true');
  assert.equal(ok.models[0], LOCAL_MODEL_CATALOG[0].id, '取到模型名');
  assert.equal(ok.version, '0.0.0-mock', '取到版本');
  assert.ok(['nvidia', 'rocm', 'cpu'].includes(ok.gpu), 'gpu 枚举合法');
  console.log(`PASS P0-2.2 probeOllama 可达（models=${JSON.stringify(ok.models)} gpu=${ok.gpu}）`);

  // 3) 不可达分支（指向无监听端口）→ fail-open
  const off = await probeOllama('http://127.0.0.1:1');
  assert.equal(off.available, false, '不可达时 available=false（不抛错）');
  assert.equal(off.gpu, 'cpu', '不可达降级 cpu');
  console.log('PASS P0-2.3 probeOllama 不可达 fail-open（available=false gpu=cpu，未抛错）');

  // 4) localModelStatus 聚合
  const st = await localModelStatus(mockBase);
  assert.equal(st.available, true, 'status.available 透传');
  assert.ok(Array.isArray(st.models), 'status.models 为数组');
  console.log(`PASS P0-2.4 localModelStatus（available=${st.available}）`);

  // 5) ensureOllamaModel：已存在 → 跳过（pull 次数不变）
  pullCount = 0;
  const skipRes = await ensureOllamaModel(LOCAL_MODEL_CATALOG[0].id, mockBase);
  assert.equal(skipRes, true, '已存在返回 true');
  assert.equal(pullCount, 0, '已存在不触发 pull（幂等）');
  // 未存在 → 触发 pull（mock 返回 done）
  const pullRes = await ensureOllamaModel('not-exists:mock', mockBase);
  assert.equal(pullRes, true, '未存在 pull 成功返回 true');
  assert.equal(pullCount, 1, '未存在触发一次 pull');
  console.log(`PASS P0-2.5 ensureOllamaModel 幂等（已存在跳过 / 未存在拉取，pullCount=${pullCount}）`);

  server.close();
  console.log('\n=== P0-2 全部 5 项验证通过 ===');
})().catch((e) => {
  console.error('P0-2 smoke FAILED:', e);
  process.exit(1);
});

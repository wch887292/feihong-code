/**
 * 第二轮消测①：num_thread 扫描（API options.num_thread 覆盖 Modelfile）
 * 当前服务配置：PARALLEL=2 / KV=q8_0 / FA=1（第一轮 A 组合）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
 */
import fs from 'fs';

const OLLAMA = 'http://127.0.0.1:11434';
const OUT = 'H:/Muse Code复刻/model-optimize/capability-boost/thread-scan.json';

const JOBS = [
  { model: 'qwen3-8b-opt:latest', threads: [4, 6, 8, 10, 12] },
  { model: 'qwen25-coder-15b-opt:latest', threads: [2, 4, 6, 8] },
];

const SHORT_PROMPT = '用一句话说明什么是复利。';

async function gen(model, prompt, numPredict, numThread) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt, stream: false,
      options: { temperature: 0.3, num_ctx: 4096, num_predict: numPredict, ...(numThread ? { num_thread: numThread } : {}) },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return {
    wallMs: Date.now() - t0,
    promptEvalSec: +(d.prompt_eval_duration / 1e9 || 0).toFixed(2),
    genTokens: d.eval_count || 0,
    genSec: +(d.eval_duration / 1e9 || 0).toFixed(2),
    tokPerSec: d.eval_count && d.eval_duration ? +(d.eval_count / (d.eval_duration / 1e9)).toFixed(2) : 0,
  };
}

const results = {};
for (const job of JOBS) {
  results[job.model] = {};
  process.stdout.write(`=== ${job.model} 预热 ===\n`);
  await gen(job.model, SHORT_PROMPT, 256, null); // 预热加载
  for (const th of job.threads) {
    await gen(job.model, SHORT_PROMPT, 64, th); // 档位切换热身
    const r1 = await gen(job.model, SHORT_PROMPT, 256, th);
    const r2 = await gen(job.model, SHORT_PROMPT, 256, th);
    const best = r1.tokPerSec >= r2.tokPerSec ? r1 : r2;
    results[job.model][`thread_${th}`] = { r1: r1.tokPerSec, r2: r2.tokPerSec, best: best.tokPerSec, genSec: best.genSec, promptEvalSec: best.promptEvalSec };
    process.stdout.write(`[${job.model}] thread=${th}: r1=${r1.tokPerSec} r2=${r2.tokPerSec} tok/s (gen ${best.genSec}s, pEval ${best.promptEvalSec}s)\n`);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  }
}
console.log('THREAD SCAN DONE');

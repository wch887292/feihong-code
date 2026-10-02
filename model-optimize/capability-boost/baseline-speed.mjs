/**
 * 基线速度实测：4 模型 × 2 轮（第 1 轮预热含冷加载，第 2 轮为正式数据）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
 * 输出：model-optimize/capability-boost/baseline-speed.json
 */
import fs from 'fs';

const MODELS = ['qwen3:8b', 'qwen2.5-coder:1.5b', 'guozhennianhua/qwen3.5-4b-kimi-k3', 'qwen3-vl:4b'];
const OUT = 'H:/Muse Code复刻/model-optimize/capability-boost/baseline-speed.json';
const OLLAMA = 'http://127.0.0.1:11434';

const SHORT_PROMPT = '用一句话说明什么是复利。';
const LONG_PROMPT = ('企业数字化转型需要从战略、组织、流程、技术四个维度协同推进。' +
  '战略维度要明确目标与路线图；组织维度要调整人才结构与激励机制；' +
  '流程维度要打通端到端价值链；技术维度要构建数据中台与AI能力。').repeat(18); // ≈1900 字

async function gen(model, prompt, numPredict) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt, stream: false,
      options: { temperature: 0.3, num_ctx: 4096, num_predict: numPredict },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return {
    wallMs: Date.now() - t0,
    loadSec: +(d.load_duration / 1e9 || 0).toFixed(2),
    promptTokens: d.prompt_eval_count || 0,
    promptEvalSec: +(d.prompt_eval_duration / 1e9 || 0).toFixed(2),
    genTokens: d.eval_count || 0,
    genSec: +(d.eval_duration / 1e9 || 0).toFixed(2),
    tokPerSec: d.eval_count && d.eval_duration ? +(d.eval_count / (d.eval_duration / 1e9)).toFixed(2) : 0,
    ttftApproxSec: +(((d.load_duration || 0) + (d.prompt_eval_duration || 0)) / 1e9).toFixed(2),
    sample: (d.response || '').slice(0, 80),
  };
}

const results = {};
for (const model of MODELS) {
  results[model] = {};
  process.stdout.write(`[${model}] 短prompt 预热轮...\n`);
  try {
    results[model].short_r1 = await gen(model, SHORT_PROMPT, 256);
  } catch (e) { results[model].error = e.message; continue; }
  process.stdout.write(`[${model}] 短prompt 正式轮...\n`);
  results[model].short_r2 = await gen(model, SHORT_PROMPT, 256);
  process.stdout.write(`[${model}] 长prompt 正式轮...\n`);
  results[model].long_r2 = await gen(model, LONG_PROMPT, 256);
  const s = results[model].short_r2, l = results[model].long_r2;
  process.stdout.write(`[${model}] ✓ 短:${s.tokPerSec} tok/s TTFT≈${s.ttftApproxSec}s | 长:${l.tokPerSec} tok/s promptEval ${l.promptEvalSec}s\n`);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
}
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log('BASELINE DONE');

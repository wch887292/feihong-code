/**
 * 第二轮消测②：服务级 env 组合对比
 * 用法：node env-ablation.mjs <LABEL>
 * 每次重启 Ollama（不同 env 组合）后运行，测 8b + coder 短/长各 1 正式轮（模型预热由本脚本负责）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
 */
import fs from 'fs';

const LABEL = process.argv[2] || 'X';
const OLLAMA = 'http://127.0.0.1:11434';
const OUT = `H:/Muse Code复刻/model-optimize/capability-boost/env-ablation-${LABEL}.json`;

const MODELS = ['qwen3-8b-opt:latest', 'qwen25-coder-15b-opt:latest'];
const SHORT_PROMPT = '用一句话说明什么是复利。';
const LONG_PROMPT = ('企业数字化转型需要从战略、组织、流程、技术四个维度协同推进。' +
  '战略维度要明确目标与路线图；组织维度要调整人才结构与激励机制；' +
  '流程维度要打通端到端价值链；技术维度要构建数据中台与AI能力。').repeat(18);

async function gen(model, prompt, numPredict, extra = {}) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt, stream: false,
      options: { temperature: 0.3, num_ctx: 4096, num_predict: numPredict, ...extra },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return {
    wallMs: Date.now() - t0,
    loadSec: +(d.load_duration / 1e9 || 0).toFixed(2),
    promptEvalSec: +(d.prompt_eval_duration / 1e9 || 0).toFixed(2),
    genTokens: d.eval_count || 0,
    genSec: +(d.eval_duration / 1e9 || 0).toFixed(2),
    tokPerSec: d.eval_count && d.eval_duration ? +(d.eval_count / (d.eval_duration / 1e9)).toFixed(2) : 0,
  };
}

const results = { label: LABEL, startedAt: new Date().toISOString() };
for (const model of MODELS) {
  results[model] = {};
  await gen(model, SHORT_PROMPT, 32); // 预热
  results[model].short = await gen(model, SHORT_PROMPT, 256);
  results[model].long = await gen(model, LONG_PROMPT, 256);
  process.stdout.write(`[${LABEL} ${model}] 短:${results[model].short.tokPerSec} 长:${results[model].long.tokPerSec} pEval短:${results[model].short.promptEvalSec}s pEval长:${results[model].long.promptEvalSec}s\n`);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
}
console.log(`ABLATION ${LABEL} DONE`);

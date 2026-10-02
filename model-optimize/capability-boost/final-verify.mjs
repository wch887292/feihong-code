/**
 * 最终验证轮：E 配置（OLLAMA_KEEP_ALIVE=1h，其余服务参数全默认）
 * ① 4 个 opt 模型速度 3 轮（口径同基线，但记录 wallMs 与 genTokens 用于"答完即停"对比）
 * ② 输出确定性测试：8b + 4b，JSON 题 × 3 次采样，opt(temp 0.3) vs base(出厂默认温度)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
 * 输出：final-verify.json
 */
import fs from 'fs';

const OLLAMA = 'http://127.0.0.1:11434';
const OUT = 'H:/Muse Code复刻/model-optimize/capability-boost/final-verify.json';

const SPEED_MODELS = ['qwen3-8b-opt:latest', 'qwen25-coder-15b-opt:latest', 'qwen35-4b-opt:latest', 'qwen3-vl-4b-opt:latest'];
const SHORT_PROMPT = '用一句话说明什么是复利。';
const LONG_PROMPT = ('企业数字化转型需要从战略、组织、流程、技术四个维度协同推进。' +
  '战略维度要明确目标与路线图；组织维度要调整人才结构与激励机制；' +
  '流程维度要打通端到端价值链；技术维度要构建数据中台与AI能力。').repeat(18);

const JSON_PROMPT = '输出一个JSON对象，包含键 name（值为"飞虹智"）和 year（值为 2026）。只输出 JSON，不要任何其他文字。';
function stripThink(t) { return t.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim(); }
function jsonOk(t) {
  try {
    const m = stripThink(t).match(/\{[\s\S]*\}/);
    const o = JSON.parse(m ? m[0] : t);
    return o.name === '飞虹智' && String(o.year) === '2026';
  } catch { return false; }
}

async function gen(model, prompt, numPredict, temperature) {
  const t0 = Date.now();
  const options = { num_ctx: 4096, num_predict: numPredict };
  if (temperature !== undefined) options.temperature = temperature;
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options }),
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
    ttftApproxSec: +(((d.load_duration || 0) + (d.prompt_eval_duration || 0)) / 1e9).toFixed(2),
    full: d.response || '',
  };
}

const results = { config: 'E: KEEP_ALIVE=1h only', startedAt: new Date().toISOString() };

// ① 速度 3 轮
results.speed = {};
for (const model of SPEED_MODELS) {
  results.speed[model] = {};
  process.stdout.write(`[${model}] 预热...\n`);
  try {
    await gen(model, SHORT_PROMPT, 32);
  } catch (e) { results.speed[model].error = e.message; continue; }
  results.speed[model].short_r2 = await gen(model, SHORT_PROMPT, 256);
  results.speed[model].long_r2 = await gen(model, LONG_PROMPT, 256);
  const s = results.speed[model].short_r2, l = results.speed[model].long_r2;
  process.stdout.write(`[${model}] ✓ 短:${s.tokPerSec} tok/s wall ${(s.wallMs/1000).toFixed(1)}s genTok ${s.genTokens} | 长:${l.tokPerSec} tok/s pEval ${l.promptEvalSec}s\n`);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
}

// ② 一致性测试（JSON 题 × 3 次采样）
results.consistency = {};
for (const [opt, base] of [['qwen3-8b-opt:latest', 'qwen3:8b'], ['qwen35-4b-opt:latest', 'guozhennianhua/qwen3.5-4b-kimi-k3']]) {
  results.consistency[opt] = {};
  for (const [label, model, temp] of [['base_default_temp', base, undefined], ['opt_temp03', opt, 0.3]]) {
    const trials = [];
    for (let i = 0; i < 3; i++) {
      const r = await gen(model, JSON_PROMPT, 400, temp);
      trials.push({ pass: jsonOk(r.full), genTokens: r.genTokens, wallMs: r.wallMs });
      process.stdout.write(`[CONS ${opt} ${label} #${i+1}] ${trials[i].pass ? 'PASS' : 'FAIL'} (${r.genTokens} tok, ${(r.wallMs/1000).toFixed(1)}s)\n`);
    }
    results.consistency[opt][label] = {
      passRate: `${trials.filter(t => t.pass).length}/3`,
      allPass: trials.every(t => t.pass),
      trials,
    };
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  }
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log('FINAL VERIFY DONE');

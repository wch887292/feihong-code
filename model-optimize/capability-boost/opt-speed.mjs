/**
 * 优化版模型复测：速度（3 轮）+ 质量（3 道机器可判题）
 * 对比基线：baseline-speed.json（同 options 口径）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
 * 输出：opt-speed.json
 */
import fs from 'fs';

const OLLAMA = 'http://127.0.0.1:11434';
const OUT = 'H:/Muse Code复刻/model-optimize/capability-boost/opt-speed.json';

// [opt模型, 对应基线模型]
const PAIRS = [
  ['qwen3-8b-opt:latest', 'qwen3:8b'],
  ['qwen25-coder-15b-opt:latest', 'qwen2.5-coder:1.5b'],
  ['qwen35-4b-opt:latest', 'guozhennianhua/qwen3.5-4b-kimi-k3'],
  ['qwen3-vl-4b-opt:latest', 'qwen3-vl:4b'],
];

const SHORT_PROMPT = '用一句话说明什么是复利。';
const LONG_PROMPT = ('企业数字化转型需要从战略、组织、流程、技术四个维度协同推进。' +
  '战略维度要明确目标与路线图；组织维度要调整人才结构与激励机制；' +
  '流程维度要打通端到端价值链；技术维度要构建数据中台与AI能力。').repeat(18);

// ─── 质量题（机器可判） ───
const QA = [
  {
    id: 'json',
    prompt: '输出一个JSON对象，包含键 name（值为"飞虹智"）和 year（值为 2026）。只输出 JSON，不要任何其他文字。',
    check: (t) => {
      try {
        const m = t.match(/\{[\s\S]*\}/);
        const o = JSON.parse(m ? m[0] : t);
        return o.name === '飞虹智' && String(o.year) === '2026';
      } catch { return false; }
    },
  },
  {
    id: 'instruct3',
    prompt: '请用正好三句话介绍复利，且第一句必须包含"20%"这个数字。只输出这三句话。',
    check: (t) => {
      const sents = t.replace(/\s/g, '').split(/[。！？!?]/).filter(Boolean);
      return sents.length === 3 && t.includes('20%');
    },
  },
  {
    id: 'math',
    prompt: '计算：(15 + 27) * 4 - 30 = ? 只输出数字答案，不要其他内容。',
    check: (t) => t.includes('138'),
  },
];

function stripThink(t) {
  return t.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();
}

async function gen(model, prompt, numPredict, useModelDefaults) {
  const t0 = Date.now();
  const options = useModelDefaults
    ? { num_ctx: 4096, num_predict: numPredict } // 质量题：用各自模型/Modelfile 默认温度（体现出厂 vs 优化差异）
    : { temperature: 0.3, num_ctx: 4096, num_predict: numPredict }; // 速度题：与基线脚本完全同口径
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
    promptTokens: d.prompt_eval_count || 0,
    promptEvalSec: +(d.prompt_eval_duration / 1e9 || 0).toFixed(2),
    genTokens: d.eval_count || 0,
    genSec: +(d.eval_duration / 1e9 || 0).toFixed(2),
    tokPerSec: d.eval_count && d.eval_duration ? +(d.eval_count / (d.eval_duration / 1e9)).toFixed(2) : 0,
    ttftApproxSec: +(((d.load_duration || 0) + (d.prompt_eval_duration || 0)) / 1e9).toFixed(2),
    sample: (d.response || '').slice(0, 80),
    full: d.response || '',
  };
}

const results = { speed: {}, quality: {} };

// ─── Part 1: 速度复测（opt 模型，口径同基线） ───
for (const [opt] of PAIRS) {
  results.speed[opt] = {};
  process.stdout.write(`[SPEED ${opt}] 短预热...\n`);
  try {
    results.speed[opt].short_r1 = await gen(opt, SHORT_PROMPT, 256, false);
  } catch (e) { results.speed[opt].error = e.message; continue; }
  process.stdout.write(`[SPEED ${opt}] 短正式...\n`);
  results.speed[opt].short_r2 = await gen(opt, SHORT_PROMPT, 256, false);
  process.stdout.write(`[SPEED ${opt}] 长正式...\n`);
  results.speed[opt].long_r2 = await gen(opt, LONG_PROMPT, 256, false);
  const s = results.speed[opt].short_r2, l = results.speed[opt].long_r2;
  process.stdout.write(`[SPEED ${opt}] ✓ 短:${s.tokPerSec} tok/s | 长:${l.tokPerSec} tok/s promptEval ${l.promptEvalSec}s\n`);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
}

// ─── Part 2: 质量对比（基线默认参数 vs opt Modelfile 参数） ───
for (const [opt, base] of PAIRS) {
  results.quality[opt] = {};
  for (const q of QA) {
    results.quality[opt][q.id] = {};
    for (const [label, model, defaults] of [['base', base, true], ['opt', opt, true]]) {
      try {
        const r = await gen(model, q.prompt, 400, defaults);
        const text = stripThink(r.full) || r.full;
        results.quality[opt][q.id][label] = {
          pass: q.check(text),
          genTokens: r.genTokens,
          tokPerSec: r.tokPerSec,
          answer: text.slice(0, 200),
        };
      } catch (e) {
        results.quality[opt][q.id][label] = { pass: false, error: e.message };
      }
      process.stdout.write(`[QA ${opt} ${q.id} ${label}] ${results.quality[opt][q.id][label].pass ? 'PASS' : 'FAIL'}\n`);
      fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log('OPT SPEED+QA DONE');

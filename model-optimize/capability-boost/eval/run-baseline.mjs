/**
 * 飞虹 Code · 全模型能力基线评测脚本
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 用法: node eval/run-baseline.mjs <模型名> [--quality-only] [--speed-only]
 * 依赖: 仅 Node.js 内置 fetch / fs / path，无第三方包。
 * 前置: Ollama 服务运行在 http://127.0.0.1:11434
 */

import { fetch } from 'undici';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RESULTS = join(ROOT, 'eval', 'results');
const OLLAMA = process.env.FH_OLLAMA_URL || 'http://127.0.0.1:11434';

// ─── 参数解析 ───
const args = process.argv.slice(2);
const modelName = args[0];
if (!modelName) {
  console.error('用法: node eval/run-baseline.mjs <模型名> [--quality-only] [--speed-only]');
  process.exit(2);
}
const qualityOnly = args.includes('--quality-only');
const speedOnly = args.includes('--speed-only');

// ─── 6 道质量题（全模型同题同参 temperature=0.3）───
const QUALITY_QUESTIONS = [
  {
    id: 'q1', desc: 'Python LRU 缓存',
    prompt: `用 Python 实现一个 LRU 缓存类，要求 get/put 操作均为 O(1) 时间复杂度。
请使用 collections.OrderedDict 或哈希表+双向链表实现。
同时附上 3 行使用示例代码。
只输出 Python 代码，不要解释。`,
  },
  {
    id: 'q2', desc: 'TypeScript 防抖',
    prompt: `用 TypeScript 实现一个防抖（debounce）函数，要求：
1. 类型注解完整（含返回值类型）
2. 支持立即执行选项（leading edge）
3. 支持最大等待时间限制（maxWait）
4. 支持取消（cancel）方法
只输出 TypeScript 代码，不要解释。`,
  },
  {
    id: 'q3', desc: '中文解释超额累进分红',
    prompt: `请用 100 字以内解释"超额累进分红"的概念，并给出一个具体的计算例子（假设本金、 tiers 与比例）。
用中文回答。`,
  },
  {
    id: 'q4', desc: '严格 JSON 输出',
    prompt: `只输出严格 JSON，不得有任何其他文字、标记或解释。
JSON 格式：{"status":"ok","items":[3 个 1-20 之间的质数]}
例如：{"status":"ok","items":[2,3,5]}
直接输出 JSON 对象，不要包裹代码块。`,
  },
  {
    id: 'q5', desc: '5 句产品文案',
    prompt: `写恰好 5 个句子的产品文案，主题是"本地大模型私有化部署"。
要求：
1. 每句独立成段（用换行分隔）
2. 总共恰好 5 句，不能多也不能少
3. 句子之间用空行分隔
4. 不要编号，不要加标题
数错句子数直接扣分。`,
  },
  {
    id: 'q6', desc: '甲乙丙排序推理',
    prompt: `甲、乙、丙三人中有一人做了好事。
已知：
(1) 甲说：不是我做的。
(2) 乙说：是丙做的。
(3) 丙说：不是我做的。
(4) 三人中只有一个人说了真话。
请问是谁做了好事？请给出完整的推理步骤和最终结论。`,
  },
];

// ─── 工具函数 ───
async function ollamaGenerate(model, prompt, options = {}) {
  const body = {
    model,
    prompt,
    stream: false,
    options: {
      temperature: 0.3,
      num_ctx: 4096,
      ...options,
    },
  };
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const d = await res.json();
  const wallMs = Date.now() - t0;
  const loadSec = (d.load_duration || 0) / 1e9;
  const promptEvalSec = (d.prompt_eval_duration || 0) / 1e9;
  const evalSec = (d.eval_duration || 0) / 1e9;
  const genTokens = d.eval_count || 0;
  const promptTokens = d.prompt_eval_count || 0;
  return {
    response: d.response || '',
    wallMs,
    loadSec: +loadSec.toFixed(3),
    promptTokens,
    promptEvalSec: +promptEvalSec.toFixed(3),
    genTokens,
    evalSec: +evalSec.toFixed(3),
    tokPerSec: genTokens && evalSec ? +(genTokens / evalSec).toFixed(2) : 0,
    ttftSec: +((loadSec + promptEvalSec)).toFixed(3),
    totalTokens: promptTokens + genTokens,
  };
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

// ─── 速度基准 ───
const SHORT_PROMPT = '用一句话说明什么是复利。';
const LONG_PROMPT = ('企业数字化转型需要从战略、组织、流程、技术四个维度协同推进。' +
  '战略维度要明确目标与路线图；组织维度要调整人才结构与激励机制；' +
  '流程维度要打通端到端价值链；技术维度要构建数据中台与AI能力。').repeat(18);

async function runSpeed(model) {
  console.log(`\n[速度基准] 模型: ${model}`);
  const result = {};

  // 短 prompt + 512 token（每类 2 轮，取第 2 轮）
  process.stdout.write('  短prompt 第1轮(预热)... ');
  try { await ollamaGenerate(model, SHORT_PROMPT, { num_predict: 512 }); } catch (e) { result.error = e.message; return result; }
  console.log('done');

  process.stdout.write('  短prompt 第2轮(正式)... ');
  const shortR2 = await ollamaGenerate(model, SHORT_PROMPT, { num_predict: 512 });
  console.log(`${shortR2.tokPerSec} tok/s, TTFT≈${shortR2.ttftSec}s`);
  result.short = {
    tokPerSec: shortR2.tokPerSec,
    ttftSec: shortR2.ttftSec,
    genTokens: shortR2.genTokens,
    evalSec: shortR2.evalSec,
    promptTokens: shortR2.promptTokens,
    wallMs: shortR2.wallMs,
  };

  // 长 prompt + 256 token（2 轮，取第 2 轮）
  process.stdout.write('  长prompt 第1轮(预热)... ');
  try { await ollamaGenerate(model, LONG_PROMPT, { num_predict: 256 }); } catch (e) { result.error = e.message; return result; }
  console.log('done');

  process.stdout.write('  长prompt 第2轮(正式)... ');
  const longR2 = await ollamaGenerate(model, LONG_PROMPT, { num_predict: 256 });
  console.log(`${longR2.tokPerSec} tok/s, promptEval ${longR2.promptEvalSec}s`);
  result.long = {
    tokPerSec: longR2.tokPerSec,
    ttftSec: longR2.ttftSec,
    genTokens: longR2.genTokens,
    evalSec: longR2.evalSec,
    promptTokens: longR2.promptTokens,
    promptEvalSec: longR2.promptEvalSec,
    wallMs: longR2.wallMs,
  };

  return result;
}

// ─── 质量题 ───
async function runQuality(model) {
  console.log(`\n[质量题] 模型: ${model}`);
  const modelDir = join(RESULTS, model.replace(/[/:]/g, '_'));
  ensureDir(modelDir);
  const stats = {};

  for (const q of QUALITY_QUESTIONS) {
    process.stdout.write(`  ${q.id} (${q.desc})... `);
    try {
      const r = await ollamaGenerate(model, q.prompt);
      const filePath = join(modelDir, `${q.id}.txt`);
      writeFileSync(filePath, r.response, 'utf8');
      stats[q.id] = {
        desc: q.desc,
        file: filePath,
        tokPerSec: r.tokPerSec,
        genTokens: r.genTokens,
        promptTokens: r.promptTokens,
        evalSec: r.evalSec,
        ttftSec: r.ttftSec,
        wallMs: r.wallMs,
        responseLen: r.response.length,
      };
      console.log(`${r.tokPerSec} tok/s, ${r.genTokens} tokens`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      stats[q.id] = { desc: q.desc, error: e.message };
    }
  }
  return stats;
}

// ─── 主流程 ───
const summary = { model: modelName, timestamp: new Date().toISOString() };

if (!qualityOnly) {
  summary.speed = await runSpeed(modelName);
}
if (!speedOnly) {
  summary.quality = await runQuality(modelName);
}

// 写 JSON 汇总
const outFile = join(RESULTS, `${modelName.replace(/[/:]/g, '_')}-baseline.json`);
writeFileSync(outFile, JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n✅ 基线完成 → ${outFile}`);
console.log(JSON.stringify(summary, null, 2));
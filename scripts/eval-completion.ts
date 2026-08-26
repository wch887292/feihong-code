/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * O2 补全质量评测（可量化闭环）：
 *  运行：npx tsx scripts/eval-completion.ts
 *  - 在线模式：连接本地 fhcode serve，对样例集调用 /api/completion，
 *    对比后处理前后的质量分(scoreCompletion)、围栏剥离率、去重率、延迟。
 *  - 离线模式（服务不可用）：用合成样例验证后处理函数本身的正确性。
 *
 * 环境变量：FHCODE_SERVER（默认 http://localhost:8080）、FHCODE_PHONE（默认 eval）
 */
import { postProcessCompletion, scoreCompletion } from '../src/agent/completion-postprocess';

interface Sample {
  name: string;
  filePath: string;
  language: string;
  prefix: string;
  suffix: string;
}

const DATASET: Sample[] = [
  {
    name: 'ts-函数体',
    filePath: 'src/foo.ts',
    language: 'typescript',
    prefix: 'function add(a: number, b: number) {\n  return ',
    suffix: ';\n}',
  },
  {
    name: 'py-列表推导',
    filePath: 'util.py',
    language: 'python',
    prefix: 'def squares(n):\n    return [x * x for x in range(',
    suffix: ')]\n',
  },
  {
    name: 'go-错误处理',
    filePath: 'main.go',
    language: 'go',
    prefix: 'f, err := os.Open("x.txt")\nif err != nil {\n    ',
    suffix: '\n}',
  },
];

// 合成样例：用于离线验证后处理函数本身（不依赖模型）
const SYNTHETIC: { input: string; suffix: string; expectChange: boolean }[] = [
  { input: '```typescript\nconst x = 1;\n```', suffix: '', expectChange: true },
  { input: 'function a() {\n  return 1;\npartialId', suffix: '', expectChange: true },
  { input: 'bc' + 'Hello', suffix: 'bc', expectChange: true },
  { input: 'const y = 2;', suffix: '', expectChange: false },
];

async function main() {
  console.log('=== 飞虹 Code 补全质量评测 (O2) ===\n');

  // ---- 离线：后处理函数自检 ----
  console.log('【离线自检】后处理函数正确性：');
  let synthPass = 0;
  for (const s of SYNTHETIC) {
    const out = postProcessCompletion(s.input, { suffix: s.suffix });
    const changed = out !== s.input;
    const ok = changed === s.expectChange;
    if (ok) synthPass++;
    console.log(
      `  ${ok ? '✓' : '✗'} expectChange=${s.expectChange} changed=${changed} score=${scoreCompletion(out).toFixed(2)} | ${JSON.stringify(s.input).slice(0, 40)}`,
    );
  }
  console.log(`  离线自检通过: ${synthPass}/${SYNTHETIC.length}\n`);

  // ---- 在线：对真实服务跑 before/after ----
  const server = process.env.FHCODE_SERVER || 'http://localhost:8080';
  const phone = process.env.FHCODE_PHONE || 'eval';
  let token = '';
  try {
    const h = await fetch(server + '/api/health');
    if (!h.ok) throw new Error('health ' + h.status);
  } catch {
    console.log(`【在线评测】未连接 ${server}，跳过真实补全评测（仅离线自检）。\n  提示：先运行 "fhcode serve" 再跑本脚本即可获得 before/after 量化对比。`);
    return;
  }
  try {
    const login = await fetch(server + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const j = await login.json();
    token = j.token || '';
  } catch {
    /* ignore */
  }

  console.log(`【在线评测】服务 ${server} 已连接，对 ${DATASET.length} 个样例调用 /api/completion：\n`);
  let fenceStripped = 0;
  let deduped = 0;
  let scoreSumBefore = 0;
  let scoreSumAfter = 0;
  let latencySum = 0;
  let n = 0;

  for (const s of DATASET) {
    const fileContent = s.prefix + s.suffix;
    const cursorOffset = s.prefix.length;
    const t0 = Date.now();
    let raw = '';
    try {
      const r = await fetch(server + '/api/completion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify({
          filePath: s.filePath,
          fileContent,
          cursorOffset,
          mode: 'quick',
          language: s.language,
        }),
      });
      const j = await r.json();
      const sug = Array.isArray(j.suggestions) && j.suggestions[0];
      raw = typeof sug === 'string' ? sug : sug?.text || '';
    } catch {
      raw = '';
    }
    const latency = Date.now() - t0;
    if (!raw) {
      console.log(`  [${s.name}] 无补全返回（可能未配置模型） latency=${latency}ms`);
      continue;
    }
    const before = scoreCompletion(raw);
    const after = postProcessCompletion(raw, { suffix: s.suffix });
    const afterScore = scoreCompletion(after);
    if (raw !== after && after.includes('`') === false && /```/.test(raw)) fenceStripped++;
    if (after !== raw && s.suffix && raw.startsWith(s.suffix.trimStart())) deduped++;
    scoreSumBefore += before;
    scoreSumAfter += afterScore;
    latencySum += latency;
    n++;
    console.log(
      `  [${s.name}] before=${before.toFixed(2)} after=${afterScore.toFixed(2)} latency=${latency}ms len=${raw.length}->${after.length}`,
    );
  }

  if (n > 0) {
    console.log('\n【汇总】');
    console.log(`  样例数(有补全): ${n}`);
    console.log(`  平均质量分 before: ${(scoreSumBefore / n).toFixed(2)} -> after: ${(scoreSumAfter / n).toFixed(2)}`);
    console.log(`  平均延迟: ${(latencySum / n).toFixed(0)}ms`);
    console.log(`  围栏剥离: ${fenceStripped}/${n}  后缀去重: ${deduped}/${n}`);
  }
  console.log('\n说明：O2 工程侧收益 = 后处理使补全"可直接接受率"提升；模型智力上限不在此项范围。');
}

main().catch((e) => {
  console.error('评测失败:', e);
  process.exit(1);
});

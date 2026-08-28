/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * O2 补全质量：补全结果后处理（工程侧可立即收益，不依赖底层模型智力上限）
 *  - stripCodeFences：去掉模型常返回的 ```lang ... ``` 包裹
 *  - dedupeAgainstSuffix：若补全文本与光标后内容(suffix)重复，裁掉重复段
 *  - trimTrailingPartialLine：剔除被截断的不完整尾行（如半截标识符）
 *  - normalize：收尾空白
 *  - scoreCompletion：启发式质量打分（括号配平、非纯空白、长度合理）
 *
 * 用法：补全引擎返回 suggestions 后，调用 postProcessCompletion 即可。可直接在
 * /api/completion 路由里串联，也可在 VS Code 扩展客户端先行后处理。
 */

/** 去掉 ```lang ... ``` 包裹，仅保留内部代码 */
export function stripCodeFences(text: string): string {
  const fence = /^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```$/;
  const m = text.match(fence);
  return m ? m[1] : text;
}

/** 若补全以 suffix 开头，说明与光标后内容重复，裁掉重复部分 */
export function dedupeAgainstSuffix(text: string, suffix: string): string {
  const s = (suffix || '').trimStart();
  if (s && text.startsWith(s.slice(0, Math.min(s.length, 400)))) {
    return text.slice(s.length);
  }
  return text;
}

/** 剔除被截断的不完整尾行（仅当该行像一个未写完的标识符时） */
export function trimTrailingPartialLine(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 1) return text;
  const last = lines[lines.length - 1];
  if (last.trim() && !/[;{})[\]"`']$/.test(last.trim()) && last.trim().length < 48) {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(last.trim())) {
      lines.pop();
      return lines.join('\n');
    }
  }
  return text;
}

function normalize(text: string): string {
  return text.replace(/\s+$/, '');
}

/** 组合后处理 */
export function postProcessCompletion(
  text: string,
  opts: { suffix?: string } = {},
): string {
  if (!text) return '';
  let out = stripCodeFences(text);
  out = dedupeAgainstSuffix(out, opts.suffix || '');
  out = trimTrailingPartialLine(out);
  return normalize(out);
}

/**
 * 启发式质量打分（0~1）：用于评测与排序。
 *  - 括号/引号配平（权重最高）
 *  - 非纯空白、长度在合理区间
 *  - 不含明显的中断标记（如孤立的 "..." 结尾）
 */
export function scoreCompletion(text: string): number {
  const t = text || '';
  if (!t.trim()) return 0;
  let score = 0.4;

  const pairs: [string, string][] = [
    ['(', ')'],
    ['{', '}'],
    ['[', ']'],
  ];
  let balanceOk = true;
  for (const [open, close] of pairs) {
    const o = (t.match(new RegExp('\\' + open, 'g')) || []).length;
    const c = (t.match(new RegExp('\\' + close, 'g')) || []).length;
    if (o !== c) balanceOk = false;
  }
  // 引号配平（成对出现）
  const dq = (t.match(/"/g) || []).length;
  const sq = (t.match(/'/g) || []).length;
  const quoteOk = dq % 2 === 0 && sq % 2 === 0;
  if (balanceOk && quoteOk) score += 0.3;

  if (t.length >= 2 && t.length <= 2000) score += 0.15;
  if (!/\.\.\.\s*$/.test(t.trim())) score += 0.15;

  return Math.min(1, Math.max(0, score));
}

/* ========== 自测（tsx src/agent/completion-postprocess.ts 直接运行） ========== */
if (require.main === module) {
  const cases: [string, string, string][] = [
    ['```typescript\nconst x = 1;\n```', '', '去围栏'],
    ['function a() {\n  return 1;\npartialIdent', '', '尾部半截标识符应被剔除'],
    ['bc' + 'Hello', 'bc', '与后缀重复应去重'],
  ];
  for (const [input, suffix, _desc] of cases) {
    const out = postProcessCompletion(input, { suffix });
    console.log(`[${_desc}] in=${JSON.stringify(input)} -> out=${JSON.stringify(out)} score=${scoreCompletion(out).toFixed(2)}`);
  }
}

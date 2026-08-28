/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * P6-1 轻量语法校验（lint）：
 *  - 用于补全结果"接受后自动 lint"反馈：Monaco/VS Code 接受补全后调用 /api/lint
 *  - 不依赖重型编译器，用括号/引号配平 + 常见错误模式做快速、可单测的校验
 *  - 与 completion-postprocess 的近似配平不同，这里给出**行列定位**与**严重级别**
 */

export interface LintIssue {
  /** 1=错误 2=警告 3=提示 */
  severity: 1 | 2 | 3;
  /** 1 起始 */
  line: number;
  /** 1 起始 */
  column: number;
  message: string;
}

/** 字符串字面量内的字符是否不计入语法配对 */
function isJsLike(language?: string): boolean {
  const l = (language || '').toLowerCase();
  return ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte'].some((x) => l === x || l.endsWith(x));
}

/**
 * 逐字符扫描：括号/引号配平 + 常见错误模式
 * 忽略字符串字面量与行内注释内的配对字符。
 */
export function lintSnippet(code: string, language?: string): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!code || !code.trim()) return issues;
  const js = isJsLike(language);
  const lines = code.split('\n');
  const openers: Record<string, string> = { '(': ')', '{': '}', '[': ']', '"': '"', "'": "'", '`': '`' };
  const stack: Array<{ ch: string; line: number; col: number }> = [];
  const inBlockComment = { value: false };
  const lineEndingDangling: string[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineEnd = line.trimEnd();
    // 行尾悬空运算符（js 系常见补全缺陷：换行后未完成表达式）
    if (js && lineEnd.length > 0) {
      const tail = lineEnd[lineEnd.length - 1];
      if ('+-*/=,?'.includes(tail)) {
        // 排除注释行 / 单独 = 号（如默认参数在换行处）
        if (!lineEnd.trim().startsWith('//') && !lineEnd.trim().startsWith('*') && !/^\s*(\+|-|\*|\/|,|=|\?)\s*$/.test(lineEnd)) {
          lineEndingDangling.push(lineEnd);
        }
      }
    }

    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const next = line[ci + 1];
      // 行注释（js 系）跳过本行剩余
      if (js && ch === '/' && next === '/') break;
      // 块注释进入/退出（js 系）
      if (js && ch === '/' && next === '*') { inBlockComment.value = true; ci++; continue; }
      if (js && inBlockComment.value && ch === '*' && next === '/') { inBlockComment.value = false; ci++; continue; }
      if (inBlockComment.value) continue;

      // 连续错误运算符（&&&、|||、!!!、=== === 双重）
      if (js && (ch === '&' || ch === '|' || ch === '!')) {
        const run = line.slice(ci, ci + 3);
        if (run === '&&&' || run === '|||' || run === '!!!') {
          issues.push({ severity: 1, line: li + 1, column: ci + 1, message: '疑似错误运算符："' + run + '"（应为两个字符组合）' });
          ci += 2;
          continue;
        }
      }

      // 普通闭合字符：与栈顶匹配
      if (ch === ')' || ch === '}' || ch === ']' || ch === '"' || ch === "'" || ch === '`') {
        const top = stack[stack.length - 1];
        if (top && openers[top.ch] === ch) {
          stack.pop();
        } else if (ch === '"' || ch === "'" || ch === '`') {
          // 未开引号就闭合：入栈视为开启（在字符串中可能是闭合的引号被误判，保守跳过）
          stack.push({ ch, line: li + 1, col: ci + 1 });
        } else {
          issues.push({ severity: 1, line: li + 1, column: ci + 1, message: '多余的闭合字符 "' + ch + '"' });
        }
        continue;
      }
      // 开启字符
      if (openers[ch]) {
        stack.push({ ch, line: li + 1, col: ci + 1 });
      }
    }
    // 行尾字符串未闭合（该行只有单引号开未合）——栈里多出的引号留给整体检查
  }

  // 栈内未闭合项 → 报错
  for (const s of stack) {
    const name: Record<string, string> = { '(': '括号', '{': '花括号', '[': '方括号', '"': '双引号', "'": '单引号', '`': '反引号' };
    issues.push({ severity: 1, line: s.line, column: s.col, message: '未闭合的' + (name[s.ch] || s.ch) + ' "' + s.ch + '"' });
  }
  // 未退出块注释
  if (inBlockComment.value) {
    issues.push({ severity: 2, line: lines.length, column: 1, message: '未闭合的块注释（/* ... */）' });
  }
  for (const ln of lineEndingDangling.slice(0, 5)) {
    issues.push({ severity: 2, line: lines.indexOf(ln) + 1, column: ln.length, message: '行尾悬空运算符（换行后未完成表达式？）' });
  }
  return issues;
}

/* ========== 自测（tsx src/agent/lint.ts 直接运行） ========== */
if (require.main === module) {
  const cases: Array<{ code: string; lang?: string; desc: string }> = [
    { code: 'function f() {\n  return 1;\n}', desc: '合法：应无错误' },
    { code: 'const x = (1 + 2;', lang: 'ts', desc: '未闭合括号' },
    { code: 'const s = "abc;', lang: 'ts', desc: '未闭合字符串' },
    { code: 'const a = 1 &&& 2;', lang: 'ts', desc: '连续错误运算符' },
    { code: 'const a = 1 +\n 2;', lang: 'ts', desc: '行尾悬空运算符' },
  ];
  for (const c of cases) {
    const r = lintSnippet(c.code, c.lang);
    console.log(`[${c.desc}] ${r.length === 0 ? 'OK' : r.map((i) => `L${i.line}:${i.column} ${i.message}`).join(' | ')}`);
  }
}

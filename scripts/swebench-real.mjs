#!/usr/bin/env node
/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * SWE-bench 真实模型跑分 harness（agentic，非 mock）：
 *  - 用真实 OpenAI-compatible 模型（agnes-2.5-flash）驱动一个最小 SWE 智能体
 *  - 对每个 SWE-bench 实例：在 base_commit 仓库工作区中，依据 problem_statement 自主探索/编辑/跑命令，生成修复 patch（git diff）
 *  - 模型 patch 只改源码（不替测试），test_patch 由验证阶段另行应用
 *  - 输出：bench/real/patches/<id>.patch + bench/real/runs/<id>.json（迭代/工具/产物原始记录）
 *
 * 用法：node scripts/swebench-real.mjs [--instances bench/swe-bench-verified-sample.json] [--limit N]
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';

const __base = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__base, '..');
const REAL_DIR = join(ROOT, 'bench', 'real');
const WORK_DIR = join(REAL_DIR, 'work');
const PATCHES_DIR = join(REAL_DIR, 'patches');
const RUNS_DIR = join(REAL_DIR, 'runs');
mkdirSync(PATCHES_DIR, { recursive: true });
mkdirSync(RUNS_DIR, { recursive: true });

// ---- 真实模型配置（密钥只从环境变量读取，严禁硬编码）----
// 支持多通道：SWEEBENCH_MODEL 选模型；SWEEBENCH_BASE_URL 选通道。
// key 选择：显式 SWEEBENCH_API_KEY 优先；否则按通道自动选（AMD 地址用 AMD_API_KEY，
// 其他用 AGNES_API_KEY）——避免"agnes key 打 AMD 端点"导致 401。
const _base = process.env.SWEEBENCH_BASE_URL || process.env.AGNES_BASE_URL || 'https://api.agnes-ai.cn/v1';
const _isAMD = String(_base).toLowerCase().includes('amd');
const MODEL = {
  name: process.env.SWEEBENCH_MODEL || 'agnes-2.5-flash',
  baseURL: _base,
  apiKey: process.env.SWEEBENCH_API_KEY
    || (_isAMD ? process.env.AMD_API_KEY : process.env.AGNES_API_KEY)
    || process.env.AGNES_API_KEY
    || process.env.AMD_API_KEY
    || '',
};
if (!MODEL.apiKey) {
  console.error('缺少环境变量 AGNES_API_KEY（评测专用，勿提交任何真实密钥到仓库）');
  process.exit(1);
}
const MAX_ITER = Number(process.env.SWEBENCH_MAX_ITER || 40);
const MAX_TOOL_CALLS = Number(process.env.SWEBENCH_MAX_TOOL_CALLS || 70);
const SHELL_TIMEOUT_MS = 60000;

// Git Bash 路径：让 run_shell 支持模型习惯的 bash 语法
const BASH_SHELL = process.env.FH_BASH_SHELL
  || (process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : '/bin/bash');

const SYSTEM_PROMPT = `你是一个严谨的软件工程智能体，正在修复一个真实开源项目的 GitHub issue。
工作目录就是该仓库在对应 commit 的源码根目录，你可以直接读写其中的文件。

【运行环境】
- run_shell 使用 Git Bash（类 Unix），可使用 \`cat\`、\`ls\`、\`grep\`、\`sed\`、\`python\`、\`head\` 等常规命令。
- 仓库依赖通常【未安装】。不要试图 pip install / 编译安装依赖来跑测试 —— 那会浪费大量轮次。
  你的任务是定位并修改源码，不是把测试环境跑起来。
- 若某个 python 命令因缺依赖报错，直接放弃该验证路线，回到读代码定位问题。

【任务要求】
1. 先阅读理解 issue 描述与报错，定位相关源码文件。
2. 通过读文件、列目录、grep 搜索来充分理解代码，再动手修改。
3. 只修改“修复 bug 所需的源码文件”，不要改动测试文件（测试会由评测系统另行应用）。
4. 必要时可以用 run_shell 运行局部验证（如 python -c 检查逻辑、git diff 自查），但不要运行完整测试套件。
5. 修改要最小且精准，避免无关改动。
6. 【重要】不要只输出分析报告就结束 —— 必须真正用 edit_file 改动源码。
7. 当你确信已修复问题、且工作区只含源码修复时，调用 finish 工具结束。

你必须用工具来完成任务，不要只在文字里描述方案。`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容（最多 400 行，可用 offset/limit 分段）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区的文件路径' },
          offset: { type: 'number', description: '起始行（从1计），可选' },
          limit: { type: 'number', description: '读取行数，可选，默认400' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出目录内容。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对工作区的目录，默认根目录' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: '在文件中搜索正则/文本模式，定位代码。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索模式' },
          path: { type: 'string', description: '搜索起点（文件或目录），默认工作区根' },
          glob: { type: 'string', description: '文件过滤，如 *.py' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '精确替换文件中某段文本（oldText 必须唯一存在）。用于修改已有文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区的文件路径' },
          oldText: { type: 'string', description: '要被替换的原文（需唯一）' },
          newText: { type: 'string', description: '替换后的新文本' },
        },
        required: ['path', 'oldText', 'newText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: '在工作区执行一条 shell 命令（如 git/grep/python 等），用于局部验证或自查。',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: '要执行的命令' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: '声明修复完成，结束任务。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

function toolCall(name, args, cwd) {
  try {
    if (name === 'read_file') {
      const p = join(cwd, args.path);
      if (!existsSync(p)) return '错误：文件不存在: ' + args.path;
      // 规范化 CRLF -> LF，保证模型复制出的 oldText 能与 edit_file 匹配
      const lines = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n');
      const off = (args.offset || 1) - 1;
      const lim = args.limit || 400;
      const slice = lines.slice(off, off + lim);
      return slice.map((l, i) => `${off + i + 1}\t${l}`).join('\n');
    }
    if (name === 'list_dir') {
      const p = join(cwd, args.path || '.');
      const out = execSync(`ls -la "${p}"`, {
        cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS, shell: BASH_SHELL, maxBuffer: 8 * 1024 * 1024,
      });
      return out;
    }
    if (name === 'grep') {
      const start = join(cwd, args.path || '.');
      // 注意：GNU grep 没有 --glob 选项（那是 ripgrep 的），会报
      // "grep: unknown option -- glob" 并中止搜索。改用 --include。
      const globArg = args.glob ? `--include=${args.glob}` : '';
      const out = execSync(`grep -rn ${globArg} --exclude-dir=.git -E "${args.pattern}" "${start}" | head -40`, {
        cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS, shell: BASH_SHELL, maxBuffer: 8 * 1024 * 1024,
      });
      return out || '(无匹配)';
    }
    if (name === 'edit_file') {
      const p = join(cwd, args.path);
      if (!existsSync(p)) return '错误：文件不存在: ' + args.path;
      const raw = readFileSync(p, 'utf8');
      // Windows 下仓库常为 CRLF 换行，而模型给出的 oldText 用 LF。
      // 统一归一化到 LF 做匹配，写回时恢复原文件的换行风格。
      const crlf = raw.includes('\r\n');
      let content = crlf ? raw.replace(/\r\n/g, '\n') : raw;
      let oldText = args.oldText.replace(/\r\n/g, '\n');
      let newText = args.newText.replace(/\r\n/g, '\n');
      let idx = content.indexOf(oldText);
      if (idx < 0) {
        // 退让：按行匹配（忽略每行首尾空白差异），提高对空白/缩进的容错
        const normIdx = content.indexOf(oldText.trim());
        if (normIdx >= 0) { idx = normIdx; oldText = oldText.trim(); }
      }
      if (idx < 0) {
        return '错误：未找到 oldText（请提供更多上下文使其唯一）。' +
               '提示：文件换行风格为 ' + (crlf ? 'CRLF' : 'LF') +
               '，oldText 首行示例: ' + JSON.stringify(oldText.split('\n')[0]);
      }
      const idx2 = content.indexOf(oldText, idx + 1);
      if (idx2 >= 0) return '错误：oldText 出现多次（请提供更多上下文使其唯一）';
      content = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
      writeFileSync(p, crlf ? content.replace(/\n/g, '\r\n') : content, 'utf8');
      return '已更新 ' + args.path;
    }
    if (name === 'run_shell') {
      // 关键：Windows 上 execSync 默认走 cmd.exe，而模型习惯写 bash 语法
      // （cat > f << 'EOF'、2>/dev/null、which、ls -la 等），在 cmd 下会集体报错，
      // 导致模型把全部迭代浪费在「工具报错 → 重试 → 再报错」的空转上
      // （实测 u2-flash 28 轮 0 次 edit_file，20 次 run_shell 全废）。
      // 这里统一改用 Git Bash 执行，与模型的心智模型对齐。
      const out = execSync(args.command, {
        cwd,
        encoding: 'utf8',
        timeout: SHELL_TIMEOUT_MS,
        shell: BASH_SHELL,
        maxBuffer: 8 * 1024 * 1024,
      });
      return (out || '(空输出)').slice(0, 3000);
    }
    if (name === 'finish') {
      return '__FINISH__';
    }
    return '未知工具: ' + name;
  } catch (e) {
    return '工具执行错误: ' + (e.stderr || e.message || String(e)).slice(0, 1500);
  }
}

// 清洗消息：剥离 reasoning_content 等厂商私有字段（AMD/DeepSeek 推理模型回传会 400），
// 只保留 OpenAI 标准字段
function sanitizeMessages(messages) {
  return messages.map((m) => {
    const o = { role: m.role };
    if (m.content !== undefined && m.content !== null) o.content = m.content;
    if (m.tool_calls) o.tool_calls = m.tool_calls;
    if (m.tool_call_id) o.tool_call_id = m.tool_call_id;
    return o;
  });
}

async function chat(messages) {
  // 限流/网关错误退避重试：429/5xx 最多 4 次（10/20/40/60s），缓解 AMD IP 限流
  const delays = [10000, 20000, 40000, 60000];
  let last = null;
  for (let i = 0; i <= delays.length; i++) {
    let res;
    try {
      res = await fetch(MODEL.baseURL + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MODEL.apiKey },
        body: JSON.stringify({
          model: MODEL.name,
          messages: sanitizeMessages(messages),
          tools: TOOLS,
          tool_choice: 'auto',
          temperature: 0.2,
          max_tokens: 2000,
        }),
      });
    } catch (e) {
      last = new Error('模型请求异常: ' + e.message);
      if (i === delays.length) break;
      await new Promise((r) => setTimeout(r, delays[i]));
      continue;
    }
    if (res.ok) return res.json();
    const t = await res.text();
    last = new Error(`模型 HTTP ${res.status}: ${t.slice(0, 300)}`);
    const retryable = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!retryable || i === delays.length) break;
    await new Promise((r) => setTimeout(r, delays[i]));
  }
  throw last || new Error('模型调用失败');
}

function gitDiff(cwd) {
  try {
    // 含 staged + unstaged 相对 HEAD 的改动（覆盖模型 git add 的情况）
    const raw = execSync('git --no-pager diff HEAD', {
      cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS,
      shell: BASH_SHELL, maxBuffer: 16 * 1024 * 1024,
    });
    return stripTestFiles(raw);
  } catch (e) {
    return '';
  }
}

// SWE-bench 铁律：模型 patch 只能改源码，不能改测试文件。
// 官方 test_patch 会另行应用到测试文件；若模型也改了同一文件，
// patch 会在评测时 apply 失败 → 结果失真。
// 这里从 diff 中剔除所有测试文件相关的 hunk。
function stripTestFiles(diffText) {
  if (!diffText || !diffText.includes('diff --git')) return diffText;
  const chunks = diffText.split(/(?=^diff --git )/m);
  const kept = [];
  const dropped = [];
  for (const c of chunks) {
    if (!c.trim()) continue;
    const m = c.match(/^diff --git a\/(\S+) b\/(\S+)/);
    const path = m ? m[1] : '';
    const isTest = /(^|\/)(tests?\/|test_[^/]*\.py$|[^/]*_test\.py$|[^/]*\/test[^/]*\.py$)/.test(path)
      || /(^|\/)tests?\//.test(path)
      || /(^|\/)conftest\.py$/.test(path);
    if (isTest) dropped.push(path);
    else kept.push(c);
  }
  if (dropped.length) {
    console.log(`    [过滤] 剔除测试文件改动: ${dropped.join(', ')}`);
  }
  return kept.join('');
}

function resetWorkdir(cwd) {
  try {
    execSync('git checkout -- . && git clean -fd', {
      cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS,
      shell: BASH_SHELL, maxBuffer: 8 * 1024 * 1024,
    });
  } catch {}
}

// 探测能 import 本仓库的解释器（老仓库需要 py3.8，新仓库 py3.13 也能跑）
// 候选顺序：项目自带 venv → Python 3.8 → 系统默认
const PY_CANDIDATES = [
  '.verify_venv/Scripts/python.exe',
  '.verify_venv/bin/python',
  'C:/Users/Administrator/AppData/Roaming/uv/python/cpython-3.8.20-windows-x86_64-none/python.exe',
];

function detectPython(cwd) {
  for (const rel of PY_CANDIDATES) {
    const p = join(cwd, rel);
    if (!existsSync(p)) continue;
    try {
      // 只要解释器能启动即可（依赖是否装好不是判断标准）
      execSync(`"${p}" -c "print(1)"`, {
        cwd, encoding: 'utf8', timeout: 30000,
        shell: BASH_SHELL, maxBuffer: 1024 * 1024,
      });
      return p;
    } catch {}
  }
  return '';
}

async function runInstance(inst) {
  // 工作区按 instance_id 隔离（同一仓库多实例的 base_commit 不同，共用目录会互相踩踏）
  const repoDir = inst.workdir || inst.instance_id || inst.repo.split('/')[1];
  const cwd = join(WORK_DIR, repoDir);
  if (!existsSync(cwd)) throw new Error('工作区不存在（未克隆?）: ' + cwd);
  resetWorkdir(cwd);
  // 让 shell 里 `python -c "import django"` 等自测命令指向本实例工作区源码，
  // 避免多实例并行时串到别的 worktree 的 django。
  process.env.PYTHONPATH = cwd;

  // 【关键】为老仓库挑一个能 import 它的解释器。
  // 背景：SWE-bench 里大量项目是 Python 3.8 时代的老代码（如 sympy-12236 用
  // `from collections import Mapping`、依赖 distutils），在 Python 3.13 上必然
  // ImportError。模型不知道这点，会把整轮预算耗在「反复重试同一条失败命令」上
  // （实测 sympy 实例 40 轮 edit_file=0）。
  // 这里预先探测可用解释器，并在提示里明确告知，避免无谓空转。
  const pyExe = detectPython(cwd);
  if (pyExe) {
    process.env.FH_PYTHON = pyExe;
    try {
      writeFileSync(join(cwd, '.python_exe'), pyExe + '\n', 'utf8');
    } catch {}
  } else {
    process.env.FH_PYTHON = '';
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `仓库: ${inst.repo}（工作区已是对应 commit 的源码）\n` +
        `问题编号(instance): ${inst.instance_id}\n\n` +
        (process.env.FH_PYTHON
          ? `【Python 解释器】本仓库需要用这个解释器运行：\n${process.env.FH_PYTHON}\n` +
            `（系统默认 python 可能是 3.13，而这个老仓库的代码在 3.13 下 import 必然失败。` +
            `若 import 报错，是解释器版本问题，不是你的修复有问题，请换上面的解释器；` +
            `若仍失败就直接放弃运行验证，专注改源码，不要反复重试同一条命令。）\n\n`
          : '') +
        `=== GitHub Issue / 问题描述 ===\n${inst.problem_statement}\n\n` +
        `请开始修复。完成后调用 finish。`,
    },
  ];

  let iterations = 0;
  let toolCalls = 0;
  const trace = [];
  let finished = false;

  while (iterations < MAX_ITER && toolCalls < MAX_TOOL_CALLS) {
    iterations++;
    let resp;
    try {
      resp = await chat(messages);
    } catch (e) {
      trace.push({ iter: iterations, error: e.message });
      break;
    }
    const msg = resp.choices?.[0]?.message;
    if (!msg) {
      trace.push({ iter: iterations, error: '空响应' });
      break;
    }
    // 兼容「思考型」厂商模型：部分模型（u2-flash / u2 / 若干国产 reasoning 模型）
    // 会把正文放在 reasoning_content，而 content 返回 null。
    // 若 content 为空则回落取 reasoning_content，否则整轮会被当成「模型没说话」而空转。
    if (!msg.content && msg.reasoning_content) {
      msg.content = msg.reasoning_content;
      trace.push({ iter: iterations, note: 'content 为空，已回落 reasoning_content' });
    }
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      // 模型没调用工具，记录其文字并强制继续/结束
      trace.push({ iter: iterations, assistant: (msg.content || '').slice(0, 200) });
      if (/finish|done|完成|结束/i.test(msg.content || '')) { finished = true; break; }
      // 没给工具也没说完成：提示它必须用工具
      messages.push({ role: 'user', content: '请使用工具（read_file/edit_file/run_shell 等）来实际修改代码，不要只在文字中描述。' });
      continue;
    }
    for (const call of calls) {
      toolCalls++;
      const fn = call.function;
      let args = {};
      try { args = JSON.parse(fn.arguments || '{}'); } catch {}
      const result = toolCall(fn.name, args, cwd);
      if (result === '__FINISH__') { finished = true; }
      trace.push({ iter: iterations, tool: fn.name, args, result: String(result).slice(0, 600) });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: String(result).slice(0, 4000),
      });
    }
    if (finished) break;
  }

  const patch = gitDiff(cwd);
  return { iterations, toolCalls, finished, patch, trace };
}

async function smokeCheck() {
  // 启动鉴权冒烟：最小请求。401/403/无效 key 立即失败；
  // 429/5xx（并发限流）指数退避重试最多 5 次，避免瞬时限流白跑。
  console.log('>> API 鉴权冒烟检查…');
  const body = JSON.stringify({
    model: MODEL.name,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 4,
  });
  const delays = [10000, 20000, 40000, 60000, 60000];
  let last = '';
  for (let i = 0; i <= delays.length; i++) {
    const res = await fetch(MODEL.baseURL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MODEL.apiKey },
      body,
    });
    if (res.ok) {
      console.log('>> 鉴权通过（HTTP 200）\n');
      return;
    }
    last = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || i === delays.length) break;
    console.log(`>> 限流/服务暂不可用（${last}），${delays[i] / 1000}s 后重试…`);
    await new Promise((r) => setTimeout(r, delays[i]));
  }
  console.error(`API 鉴权失败 ${last}`);
  console.error(`通道: ${MODEL.baseURL} | 模型: ${MODEL.name} | 请检查 GitHub Secrets（AMD_API_KEY / AGNES_API_KEY）`);
  process.exit(2);
}

async function main() {
  const argIdx = process.argv.indexOf('--instances');
  const instPath = argIdx >= 0 ? process.argv[argIdx + 1] : join(ROOT, 'bench', 'swe-bench-verified-sample.json');
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
  const instances = JSON.parse(readFileSync(instPath, 'utf8'));
  const subset = instances.slice(0, limit);

  console.log(`\n=== SWE-bench 真实模型跑分（agentic）===\n模型: ${MODEL.name}\n实例数: ${subset.length}\n`);
  await smokeCheck();
  const summary = [];
  for (const inst of subset) {
    console.log(`\n--- ${inst.instance_id} (${inst.repo}) ---`);
    let r;
    try {
      r = await runInstance(inst);
    } catch (e) {
      r = { error: e.message };
    }
    const patchPath = join(PATCHES_DIR, inst.instance_id + '.patch');
    writeFileSync(patchPath, r.patch || '', 'utf8');
    const runLog = {
      instance_id: inst.instance_id,
      repo: inst.repo,
      model: MODEL.name,
      iterations: r.iterations,
      toolCalls: r.toolCalls,
      finished: r.finished,
      patchLength: (r.patch || '').length,
      hasPatch: !!r.patch && r.patch.trim().length > 0,
      error: r.error || null,
      trace: r.trace || [],
    };
    writeFileSync(join(RUNS_DIR, inst.instance_id + '.json'), JSON.stringify(runLog, null, 2), 'utf8');
    const status = r.error ? 'ERROR' : r.patch && r.patch.trim() ? 'PATCH_OK' : 'NO_PATCH';
    console.log(`  状态: ${status} | 迭代: ${r.iterations} | 工具: ${r.toolCalls} | patch字节: ${(r.patch || '').length}`);
    summary.push({ instance_id: inst.instance_id, status, iterations: r.iterations, toolCalls: r.toolCalls, hasPatch: runLog.hasPatch });
  }
  writeFileSync(join(REAL_DIR, 'summary.json'), JSON.stringify({ model: MODEL.name, instances: summary }, null, 2), 'utf8');
  console.log('\n完成。结果见 bench/real/patches/ 与 bench/real/runs/');
}

main().catch((e) => { console.error('harness 失败:', e); process.exit(1); });

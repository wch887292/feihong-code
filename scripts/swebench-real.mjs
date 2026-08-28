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

// ---- 真实模型配置（来自 ~/.feihong-code/web-config.json，agnes-2.5-flash 已验证可用）----
const MODEL = {
  name: 'agnes-2.5-flash',
  baseURL: 'https://api.agnes-ai.cn/v1',
  // 优先读环境变量（CI 中用 secret 注入），本地回退到内置 key
  apiKey: process.env.AGNES_API_KEY || 'sk-SGmo9yhSYV7Pn6BwOdgzuhFTrnTlALZXpnNYsK1FsDGDLNRj',
};
const MAX_ITER = 28;
const MAX_TOOL_CALLS = 60;
const SHELL_TIMEOUT_MS = 60000;

const SYSTEM_PROMPT = `你是一个严谨的软件工程智能体，正在修复一个真实开源项目的 GitHub issue。
工作目录就是该仓库在对应 commit 的源码根目录，你可以直接读写其中的文件。

任务要求：
1. 先阅读理解 issue 描述与报错，定位相关源码文件。
2. 通过读文件、列目录、grep 搜索来充分理解代码，再动手修改。
3. 只修改“修复 bug 所需的源码文件”，不要改动测试文件（测试会由评测系统另行应用）。
4. 必要时可以用 run_shell 运行局部验证（如 python -c 检查逻辑、git diff 自查），但不要运行完整测试套件。
5. 修改要最小且精准，避免无关改动。
6. 当你确信已修复问题、且工作区只含源码修复时，调用 finish 工具结束。

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
      const out = execSync(`ls -la "${p}"`, { cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS });
      return out;
    }
    if (name === 'grep') {
      const start = join(cwd, args.path || '.');
      const globArg = args.glob ? `--glob ${args.glob}` : '';
      const out = execSync(`grep -rn ${globArg} --exclude-dir=.git -E "${args.pattern}" "${start}" | head -40`, {
        cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS,
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
      const out = execSync(args.command, { cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS });
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

async function chat(messages) {
  const res = await fetch(MODEL.baseURL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + MODEL.apiKey },
    body: JSON.stringify({
      model: MODEL.name,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`模型 HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

function gitDiff(cwd) {
  try {
    // 含 staged + unstaged 相对 HEAD 的改动（覆盖模型 git add 的情况）
    return execSync('git --no-pager diff HEAD', { cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS });
  } catch (e) {
    return '';
  }
}

function resetWorkdir(cwd) {
  try {
    execSync('git checkout -- . && git clean -fd', { cwd, encoding: 'utf8', timeout: SHELL_TIMEOUT_MS });
  } catch {}
}

async function runInstance(inst) {
  const repoDir = inst.workdir || inst.repo.split('/')[1];
  const cwd = join(WORK_DIR, repoDir);
  if (!existsSync(cwd)) throw new Error('工作区不存在（未克隆?）: ' + cwd);
  resetWorkdir(cwd);
  // 让 shell 里 `python -c "import django"` 等自测命令指向本实例工作区源码，
  // 避免多实例并行时串到别的 worktree 的 django。
  process.env.PYTHONPATH = cwd;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `仓库: ${inst.repo}（工作区已是对应 commit 的源码）\n` +
        `问题编号(instance): ${inst.instance_id}\n\n` +
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

async function main() {
  const argIdx = process.argv.indexOf('--instances');
  const instPath = argIdx >= 0 ? process.argv[argIdx + 1] : join(ROOT, 'bench', 'swe-bench-verified-sample.json');
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
  const instances = JSON.parse(readFileSync(instPath, 'utf8'));
  const subset = instances.slice(0, limit);

  console.log(`\n=== SWE-bench 真实模型跑分（agentic）===\n模型: ${MODEL.name}\n实例数: ${subset.length}\n`);
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

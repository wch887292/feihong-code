/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：codex_exec — 进程级嫁接 OpenAI Codex CLI
 *  - fhcode 当调度器，把任务派给本机 Codex CLI 执行（需 OpenAI 账号登录）
 *  - 未登录/未安装/超时/其他错误：分别标记，便于上层区分处理
 *  - 跨平台：Windows 用 codex.cmd，其余用 codex；spawn 数组参数，不经 shell，防注入
 */
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';

/** 未授权 / 登录过期识别（OAuth token 失效、未登录 Codex） */
const AUTH_ERROR_PATTERNS: RegExp[] = [
  /unauthorized/i,
  /please\s*sign\s*in/i,
  /not\s*(logged\s*in|authenticated)/i,
  /session\s*expired/i,
  /token.*(expired|invalid)/i,
  /please\s*run\s+.*codex\s*login/i,
  /no\s*(valid\s*)?credentials/i,
  /未登录|未授权|登录已过期|凭证.*失效|请先登录/i,
];

export function detectAuthError(text: string): boolean {
  return AUTH_ERROR_PATTERNS.some((re) => re.test(text));
}

export interface CodexCliExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 智能截断：保留头部和尾部，中间用省略标记替换（错误信息通常在末尾） */
function smartTruncate(text: string, maxLen = 8000, headLen = 2500, tailLen = 4500): string {
  if (text.length <= maxLen) return text;
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  const omitted = text.length - headLen - tailLen;
  return `${head}\n…[已省略中间 ${omitted} 字符]…\n${tail}`;
}

/**
 * 解析 Codex CLI 的真实可执行入口。
 * Windows 上 `spawn('codex.cmd', ...)` 会报 EINVAL（Node 不能直接启动 .cmd/.bat），
 * 因此改为定位 npm 全局 node_modules/@openai/codex 下的 JS 入口，用 node.exe 启动：
 *   codex.cmd 本质是  node <prefix>/node_modules/@openai/codex/<bin> <args>
 * 非 Windows：直接解析 `which codex` 的真实路径（可能带 shebang 的原生可执行文件）。
 * 返回 { cmd, argsPrefix } 或 null（未安装/无法解析）。
 */
function resolveCodexCli(): { cmd: string; argsPrefix: string[] } | null {
  // 常见安装路径直接探测（Windows）：I:\codex（用户指定安装盘）、npm 全局目录等
  if (process.platform === 'win32') {
    const knownPaths = [
      'I:\\codex',
      process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
      process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs') : '',
    ].filter(Boolean);
    for (const dir of knownPaths) {
      const cmdPath = join(dir, 'codex.cmd');
      if (existsSync(cmdPath)) {
        const binDir = dir;
        const candidates = [
          join(binDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
          join(binDir, 'node_modules', '@openai', 'codex', 'dist', 'cli.js'),
          join(binDir, 'node_modules', '@openai', 'codex', 'cli.js'),
          join(binDir, 'node_modules', '@openai', 'codex', 'index.js'),
        ];
        const found = candidates.find((p) => existsSync(p));
        if (found) return { cmd: process.execPath, argsPrefix: [found] };
        return { cmd: cmdPath, argsPrefix: [] };
      }
    }
  }
  try {
    if (process.platform === 'win32') {
      const out = execSync('where.exe codex', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const line = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.length > 0);
      if (!line) return null;
      const binDir = dirname(line); // npm 全局 bin 目录（codex.cmd 所在处）
      // 新版 @openai/codex 打包后入口在 node_modules/@openai/codex/bin/codex.js 或类似位置
      const candidates = [
        join(binDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
        join(binDir, 'node_modules', '@openai', 'codex', 'dist', 'cli.js'),
        join(binDir, 'node_modules', '@openai', 'codex', 'cli.js'),
        join(binDir, 'node_modules', '@openai', 'codex', 'index.js'),
      ];
      const found = candidates.find((p) => existsSync(p));
      if (found) return { cmd: process.execPath, argsPrefix: [found] };
      // 兜底：若 where 解析出的不是 .cmd/.bat（原生可执行文件），可直接 spawn
      if (!/\.(cmd|bat)$/i.test(line)) return { cmd: line, argsPrefix: [] };
      return null;
    }
    const out = execSync('which codex', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const p = out.trim().split(/\r?\n/)[0];
    return p ? { cmd: p, argsPrefix: [] } : null;
  } catch {
    return null;
  }
}

/** 调用 Codex CLI（不经 shell；自动解析真实入口，Windows 不走 .cmd 避免 EINVAL） */
export function runCodexCli(
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<CodexCliExecResult> {
  const resolved = resolveCodexCli();
  if (!resolved) {
    return Promise.resolve({ code: 127, stdout: '', stderr: '未检测到 Codex CLI（resolveCodexCli 解析失败）' });
  }
  return new Promise((resolve) => {
    const child = spawn(resolved.cmd, [...resolved.argsPrefix, ...args], {
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ code: 124, stdout, stderr: `${stderr}\n[超时] 超过 ${opts.timeoutMs}ms 未完成，已强制结束` });
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: err.code === 'ENOENT' ? 127 : 126, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Codex 是否已安装（快查，缓存 10s） */
let codexCheckCache: { at: number; ok: boolean } | null = null;
export function isCodexInstalled(): boolean {
  const now = Date.now();
  if (codexCheckCache && now - codexCheckCache.at < 10_000) return codexCheckCache.ok;
  const ok = resolveCodexCli() !== null;
  codexCheckCache = { at: now, ok };
  return ok;
}

/** 获取 Codex CLI 版本号（未安装返回空串） */
export function getCodexVersion(): string {
  try {
    const resolved = resolveCodexCli();
    if (!resolved) return '';
    const out = execSync(`"${resolved.cmd}" "${resolved.argsPrefix[0] ?? ''}" --version`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
    });
    return out.trim().split(/\r?\n/)[0] || '';
  } catch {
    return '';
  }
}

/** 检查 Codex 登录状态（通过 codex login status） */
export function getCodexLoginStatus(): { loggedIn: boolean; detail: string } {
  try {
    const resolved = resolveCodexCli();
    if (!resolved) return { loggedIn: false, detail: 'Codex CLI 未安装' };
    const args =
      process.platform === 'win32'
        ? [resolved.argsPrefix[0] ?? '', 'login', 'status']
        : [...resolved.argsPrefix, 'login', 'status'];
    const { status, stdout, stderr } = require('child_process').spawnSync(
      resolved.cmd,
      args,
      { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const text = `${stdout || ''}${stderr || ''}`.trim();
    // 未登录时退出码非 0 且输出包含 "Not logged in"
    const loggedIn = status === 0 && !/not\s*logged\s*in/i.test(text);
    return { loggedIn, detail: text || `exit=${status}` };
  } catch (e: any) {
    return { loggedIn: false, detail: e?.message ? String(e.message) : '无法检测登录状态' };
  }
}

export const codexExecTool: Tool = {
  name: 'codex_exec',
  description:
    '把任务派给本机 OpenAI Codex CLI（codex exec，需 OpenAI 账号登录）执行并返回结果。' +
    '适合代码生成、代码审查、重构、自动化编码等任务。' +
    '返回 CODEX_NEED_AUTH 表示 Codex 未登录，请在终端运行 `codex login`。',
  jsonSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: '要派给 Codex 执行的任务描述（自然语言）' },
      model: {
        type: 'string',
        description: 'Codex 模型 id（如 gpt-5-codex / gpt-4o）；缺省由 Codex 自动选择',
      },
      reasoningEffort: {
        type: 'string',
        enum: ['minimal', 'low', 'medium', 'high'],
        description: '推理深度，默认 medium',
      },
      timeoutMs: { type: 'number', description: '超时毫秒数，默认 180000' },
      sandbox: {
        type: 'string',
        enum: ['read-only', 'workspace-write', 'danger-full-access'],
        description: '沙箱模式，默认 read-only（安全）',
      },
    },
    required: ['task'],
  },
  schema: z.object({
    task: z.string().min(1),
    model: z.string().optional(),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    timeoutMs: z.number().int().min(1000).max(600000).optional(),
    sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { task, model, reasoningEffort, sandbox } = args as {
      task: string;
      model?: string;
      reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
      sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
    };
    const timeoutMs = (args as { timeoutMs?: number }).timeoutMs ?? 180_000;

    if (!isCodexInstalled()) {
      return {
        ok: false,
        output: '',
        error: 'CODEX_NOT_FOUND: 未检测到 Codex CLI，请先执行 npm install -g @openai/codex',
      };
    }

    const cliArgs: string[] = ['exec'];
    if (model) cliArgs.push('--model', model);
    if (reasoningEffort) cliArgs.push('--reasoning-effort', reasoningEffort);
    if (sandbox) cliArgs.push('--sandbox', sandbox);
    cliArgs.push('--json');
    // 任务作为位置参数（codex exec "<task>"）
    cliArgs.push(task);

    const res = await runCodexCli(cliArgs, { cwd: ctx.cwd, timeoutMs });
    const combined = `${res.stdout}${res.stderr}`;

    if (res.code === 124) {
      return { ok: false, output: '', error: `CODEX_TIMEOUT: 任务超过 ${timeoutMs}ms 未完成，已终止` };
    }
    if (res.code === 127) {
      return { ok: false, output: '', error: 'CODEX_NOT_FOUND: 未检测到 Codex CLI（PATH 中找不到 codex）' };
    }
    if (detectAuthError(combined)) {
      return {
        ok: false,
        output: '',
        error: `CODEX_NEED_AUTH: Codex 凭证已过期或未登录，请在终端运行 \`codex login\` 完成登录后重试：${smartTruncate(combined, 1200, 400, 700)}`,
      };
    }
    if (res.code !== 0) {
      return { ok: false, output: '', error: `CODEX_ERROR(exit=${res.code}): ${smartTruncate(combined, 2000, 600, 1200)}` };
    }
    return { ok: true, output: smartTruncate(combined) };
  },
};
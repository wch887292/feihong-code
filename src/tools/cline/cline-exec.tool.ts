/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：cline_exec — 进程级嫁接 Cline CLI
 *  - fhcode 当调度器，把任务派给本机 `cline run --headless` 执行（Cline 账号免费模型）
 *  - 429/额度耗尽：返回 CLINE_RATE_LIMIT 标记，由编排层（主模型）接管继续
 *  - 超时/未安装/其他错误：分别标记，便于上层区分处理
 *  - 跨平台：Windows 用 cline.cmd，其余用 cline；spawn 数组参数，不经 shell，防注入
 */
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';

/** 429/限流/额度耗尽识别（中英文 + 常见变体） */
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /\b429\b/,
  /rate\s*limit/i,
  /quota\s*(exceeded|reached|exhausted)?/i,
  /too\s*many\s*requests/i,
  /额度|配额|限流|已用完|不可用/i,
];

/** 智能截断：保留头部和尾部，中间用省略标记替换（错误信息通常在末尾） */
function smartTruncate(text: string, maxLen = 8000, headLen = 2500, tailLen = 4500): string {
  if (text.length <= maxLen) return text;
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  const omitted = text.length - headLen - tailLen;
  return `${head}\n…[已省略中间 ${omitted} 字符]…\n${tail}`;
}

export function detectRateLimit(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

export interface CliExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 解析 cline CLI 的真实可执行入口。
 * Windows 上 `spawn('cline.cmd', ...)` 会报 EINVAL（Node 不能直接启动 .cmd/.bat），
 * 因此改为定位 npm 全局 node_modules/cline/bin/cline（JS 入口），用 node.exe 启动：
 *   cline.cmd 本质是  node <prefix>/node_modules/cline/bin/cline <args>
 * 非 Windows：直接解析 `which cline` 的真实路径（可能带 shebang 的原生可执行文件）。
 * 返回 { cmd, argsPrefix } 或 null（未安装/无法解析）。
 */
function resolveClineCli(): { cmd: string; argsPrefix: string[] } | null {
  try {
    if (process.platform === 'win32') {
      const out = execSync('where.exe cline', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const line = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.length > 0);
      if (!line) return null;
      const binDir = dirname(line); // npm 全局 bin 目录（cline.cmd 所在处）
      const cliJs = join(binDir, 'node_modules', 'cline', 'bin', 'cline');
      if (existsSync(cliJs)) return { cmd: process.execPath, argsPrefix: [cliJs] };
      // 兜底：若 where 解析出的不是 .cmd/.bat（原生可执行文件），可直接 spawn
      if (!/\.(cmd|bat)$/i.test(line)) return { cmd: line, argsPrefix: [] };
      return null;
    }
    const out = execSync('which cline', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const p = out.trim().split(/\r?\n/)[0];
    return p ? { cmd: p, argsPrefix: [] } : null;
  } catch {
    return null;
  }
}

/** 调用 cline CLI（不经 shell；自动解析真实入口，Windows 不再走 .cmd 避免 EINVAL） */
export function runClineCli(
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<CliExecResult> {
  const resolved = resolveClineCli();
  if (!resolved) {
    return Promise.resolve({ code: 127, stdout: '', stderr: '未检测到 Cline CLI（resolveClineCli 解析失败）' });
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

/** cline 是否已安装（快查，缓存 10s） */
let clineCheckCache: { at: number; ok: boolean } | null = null;
export function isClineInstalled(): boolean {
  const now = Date.now();
  if (clineCheckCache && now - clineCheckCache.at < 10_000) return clineCheckCache.ok;
  const ok = resolveClineCli() !== null;
  clineCheckCache = { at: now, ok };
  return ok;
}

export const clineExecTool: Tool = {
  name: 'cline_exec',
  description:
    '把任务派给本机 Cline CLI（cline run --headless，使用 Cline 账号免费模型）执行并返回结果。' +
    '适合大模型当前不可用、需要免费模型兜底或平行执行的代码任务。' +
    '返回 CLINE_RATE_LIMIT 表示 Cline 免费额度已用完，应改用其他模型继续。',
  jsonSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: '要派给 Cline 执行的任务描述（自然语言）' },
      model: {
        type: 'string',
        description: 'Cline 免费模型 id（如 cline-free/deepseek-v4.1-flash）；缺省由 Cline 自动选择',
      },
      timeoutMs: { type: 'number', description: '超时毫秒数，默认 180000' },
      permissionMode: { type: 'string', enum: ['plan', 'auto'], description: 'Cline 权限模式，默认 plan（安全）' },
    },
    required: ['task'],
  },
  schema: z.object({
    task: z.string().min(1),
    model: z.string().optional(),
    timeoutMs: z.number().int().min(1000).max(600000).optional(),
    permissionMode: z.enum(['plan', 'auto']).optional(),
  }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { task, model, permissionMode } = args as {
      task: string;
      model?: string;
      permissionMode?: 'plan' | 'auto';
    };
    const timeoutMs = (args as { timeoutMs?: number }).timeoutMs ?? 180_000;

    if (!isClineInstalled()) {
      return {
        ok: false,
        output: '',
        error: 'CLINE_NOT_FOUND: 未检测到 Cline CLI，请先执行 npm install -g cline 并运行 cline auth 登录',
      };
    }

    const cliArgs: string[] = [];
    // Cline CLI 3.x：直接 `cline "任务"` 即为无头执行（默认 act 模式 + auto-approve）
    if (permissionMode === 'plan') cliArgs.push('-p');
    if (model) cliArgs.push('-m', model);
    cliArgs.push('--json');
    // 首尾加空格：Windows spawn 数组传参时自动加引号，Cline 才能把任务识别为 prompt（否则中文无空格任务被当成子命令）
    cliArgs.push(' ' + task + ' ');

    const res = await runClineCli(cliArgs, { cwd: ctx.cwd, timeoutMs });
    const combined = `${res.stdout}${res.stderr}`;

    if (res.code === 124) {
      return { ok: false, output: '', error: `CLINE_TIMEOUT: 任务超过 ${timeoutMs}ms 未完成，已终止` };
    }
    if (res.code === 127) {
      return { ok: false, output: '', error: 'CLINE_NOT_FOUND: 未检测到 Cline CLI（PATH 中找不到 cline）' };
    }
    if (detectRateLimit(combined)) {
      return {
        ok: false,
        output: '',
        error: `CLINE_RATE_LIMIT: Cline 免费额度受限（429/限流），请改用本地模型继续：${smartTruncate(combined, 1200, 400, 700)}`,
      };
    }
    if (res.code !== 0) {
      return { ok: false, output: '', error: `CLINE_ERROR(exit=${res.code}): ${smartTruncate(combined, 2000, 600, 1200)}` };
    }
    return { ok: true, output: smartTruncate(combined) };
  },
};

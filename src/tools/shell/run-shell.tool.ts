/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：执行 shell 命令（白名单 + 审批）
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { runCommand, runCommandInContainer, commandHead, defaultShellTimeoutMs } from './exec';

/**
 * 真正危险的 shell 模式（命令注入/任意代码执行/破坏性操作/提权）。
 * 只拦截这些高风险模式，允许正常的管道(|)、命令链(&&/||)、变量($VAR)、
 * 重定向(>)、子shell等常用语法。命中任意一条即拦截。
 */
const DANGEROUS_SHELL_PATTERNS: RegExp[] = [
  /\$\(/,                              // 命令替换 $(...) — 可执行任意命令
  /`/,                                 // 反引号命令替换
  /\|\s*(sh|bash|zsh|fish|dash)\b/i, // 管道直接喂给 shell 解释器
  /(curl|wget)\b[^\n]*\|\s*(sh|bash)/i, // 网络下载后管道执行（典型 RCE）
  /\b(sudo|su)\b/,                    // 权限提升
  /\b(eval|exec)\b/,                  // 代码动态执行 / 进程替换
  /\brm\s+-rf\b/i,                    // 递归强制删除
  /\b(mkfs|dd\s+if=|mkswap)\b/i,     // 破坏性磁盘操作
  /\b(nc|netcat|telnet|ncat)\b/i,     // 反向 shell / 网络工具
  />\s*\/dev\/(sd|hd|nvme)/i,        // 直接写块设备
];

function isDangerousShellCommand(cmd: string): boolean {
  return DANGEROUS_SHELL_PATTERNS.some((re) => re.test(cmd));
}

/** 智能截断：保留头部和尾部，中间用省略标记替换（错误信息通常在末尾） */
function smartTruncate(text: string, maxLen = 6000, headLen = 2000, tailLen = 3000): string {
  if (text.length <= maxLen) return text;
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  const omitted = text.length - headLen - tailLen;
  return `${head}\n…[已省略中间 ${omitted} 字符]…\n${tail}`;
}

/**
 * P-fix（2026-10-05 复盘第二轮）：stdout/stderr 分段截断。
 * 此前两者拼接后整体截断，stderr 的日志行（JSON/event log）会占据尾部窗口，
 * 把 stdout 末尾的测试汇总行（# pass / # fail）挤出视野——agent 看不到汇总就误判
 * 失败反复重跑（实测 44 轮空转的根因之一）。分段后各流独立保留头尾，互不挤占。
 */
function buildOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(smartTruncate(stdout, 7000, 2000, 4000));
  if (stderr.trim()) parts.push(`--- stderr ---\n${smartTruncate(stderr, 4000, 500, 3000)}`);
  return parts.join('\n') || '(无输出)';
}

export const runShellTool: Tool = {
  name: 'run_shell',
  description: '执行 shell 命令（受白名单约束，需审批时会被拦截）',
  jsonSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的完整命令' },
      timeout: { type: 'number', description: '可选，超时毫秒数（5000~900000）；不传则用 FH_SHELL_TIMEOUT_MS 或默认 180000。长命令（完整测试套件/构建发布）建议显式传更大的值' },
    },
    required: ['command'],
  },
  schema: z.object({
    command: z.string().min(1),
    timeout: z.number().int().min(5000).max(900000).optional(),
  }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { command, timeout } = args as { command: string; timeout?: number };
    const timeoutMs = timeout ?? defaultShellTimeoutMs();
    const head = commandHead(command);
    // 白名单检查（仅当配置了白名单时约束首词）
    if (ctx.security.shellAllowlist.length > 0) {
      if (!ctx.security.shellAllowlist.includes(head)) {
        return { ok: false, output: '', error: `命令不在白名单: ${head}` };
      }
    }
    // 危险模式检测：只拦截真正危险的注入/破坏性操作，允许正常管道/命令链/变量
    if (isDangerousShellCommand(command)) {
      return { ok: false, output: '', error: `命令含高风险操作，已被拦截: ${command.slice(0, 100)}。如需执行请确认安全性后手动运行。` };
    }
    if (ctx.security.requireApproval) {
      const approved = ctx.approve ? await ctx.approve(`run_shell: ${command}`) : false;
      if (!approved) return { ok: false, output: '', error: '已拒绝执行（需审批）' };
    }
    // P5-4：container 沙箱模式下命令在 Docker 容器内执行（挂载工作区）
    const res =
      ctx.security.sandboxMode === 'container'
        ? await runCommandInContainer(command, ctx.cwd, timeoutMs)
        : await runCommand(command, ctx.cwd, timeoutMs);
    const isTimeout = res.timedOut === true || res.code === 124 || /\[超时\]|\[强制结束\]/.test(res.stderr || '');
    return {
      ok: res.code === 0,
      output: buildOutput(res.stdout, res.stderr),
      error: res.code === 0
        ? undefined
          : isTimeout
          ? `命令超时被终止（超时上限 ${Math.round(timeoutMs / 1000)} 秒，可在调用时传 timeout 参数、设 FH_SHELL_TIMEOUT_MS，或拆分/后台化命令）。下方已附输出尾部供诊断。exit code ${res.code}`
          : `exit code ${res.code}`,
    };
  },
};

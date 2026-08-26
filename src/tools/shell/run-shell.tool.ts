/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具：执行 shell 命令（白名单 + 审批）
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { runCommand, runCommandInContainer, commandHead } from './exec';

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

export const runShellTool: Tool = {
  name: 'run_shell',
  description: '执行 shell 命令（受白名单约束，需审批时会被拦截）',
  jsonSchema: {
    type: 'object',
    properties: { command: { type: 'string', description: '要执行的完整命令' } },
    required: ['command'],
  },
  schema: z.object({ command: z.string().min(1) }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { command } = args as { command: string };
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
        ? await runCommandInContainer(command, ctx.cwd)
        : await runCommand(command, ctx.cwd);
    const combined = `${res.stdout}${res.stderr}`;
    const isTimeout = res.code === 124 || /\[超时\]|\[强制结束\]/.test(res.stderr || '');
    return {
      ok: res.code === 0,
      output: smartTruncate(combined),
      error: res.code === 0
        ? undefined
        : isTimeout
          ? `命令超时（超过60秒未完成）。该命令可能是长时间运行的服务（如 dev server），请改用后台启动方式，或拆分为更短的命令。exit code ${res.code}`
          : `exit code ${res.code}`,
    };
  },
};

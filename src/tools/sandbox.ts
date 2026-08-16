/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-2/P5-4 沙箱模式（对齐 Codex sandbox + OpenHands Docker 隔离）：
 *  - read-only          只读勘察：禁写文件、禁执行 shell（需显式切换）
 *  - workspace-write    工作区可写：文件工具正常，shell 受白名单+审批约束（默认）
 *  - danger-full-access 全权限：绕过写限制与审批（危险命令黑名单仍生效）
 *  - container          容器隔离（P5-4）：文件工具正常，shell 命令在 Docker 容器内执行
 *                       （docker run 挂载工作区，镜像由 FH_SANDBOX_IMAGE 配置，默认 node:22-alpine）
 *
 * 另含网络域名规则：命令中出现的 http(s) 目标域名受 allow/deny 列表约束。
 * 纯函数设计，便于单测；与 RBAC 策略（policy.ts）互为纵深防御：
 *  - 策略负责"该不该做"（deny 优先）
 *  - 沙箱负责"技术边界"（能否做）
 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access' | 'container';

export interface SandboxRules {
  /** 网络允许域名（空 = 不限制） */
  networkAllow: string[];
  /** 网络拒绝域名（命中即拦截，优先级最高） */
  networkDeny: string[];
}

export interface SandboxDecision {
  blocked: boolean;
  reason?: string;
}

/** 规范化沙箱模式：非法值回退默认 workspace-write */
export function normalizeSandboxMode(raw?: string | null): SandboxMode {
  const v = raw?.trim().toLowerCase();
  if (v === 'read-only' || v === 'readonly') return 'read-only';
  if (v === 'danger-full-access' || v === 'full-access' || v === 'full') return 'danger-full-access';
  if (v === 'container' || v === 'docker') return 'container';
  return 'workspace-write';
}

/** 写类工具：read-only 模式下禁止 */
const WRITE_TOOLS = new Set(['write_file', 'edit_file']);

/** 提取命令中出现的 http(s) 目标主机名（简单解析，不做 DNS 解析） */
export function extractNetworkHosts(cmd: string): string[] {
  const hosts = new Set<string>();
  const re = /https?:\/\/([^/\s'"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    let host = m[1].toLowerCase();
    // 剥离端口与路径尾（host:port 或 host/path 已由正则排除 /，仅需剥端口）
    const colon = host.indexOf(':');
    if (colon > 0) host = host.slice(0, colon);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

function hostMatches(rule: string, host: string): boolean {
  const r = rule.trim().toLowerCase();
  if (!r) return false;
  // 精确匹配，或规则为子域通配（如 .github.com 匹配 api.github.com）
  if (r.startsWith('.')) return host === r.slice(1) || host.endsWith(r);
  return host === r;
}

/** 网络域名级检查（web_fetch/web_search 等 URL 入参工具复用）：返回 null 表示放行 */
export function checkNetworkUrl(rules: SandboxRules, url: string): string | null {
  let target = '';
  try {
    const u = new URL(url);
    target = u.hostname.toLowerCase();
  } catch {
    // 非法 URL：交给工具自身报错，沙箱不额外拦截
    return null;
  }
  if (rules.networkDeny.some((r) => hostMatches(r, target))) {
    return `目标域名 ${target} 命中网络黑名单`;
  }
  if (rules.networkAllow.length > 0 && !rules.networkAllow.some((r) => hostMatches(r, target))) {
    return `目标域名 ${target} 不在网络白名单`;
  }
  return null;
}

/** 沙箱判定（纯函数）：先 deny 域名 → 再 read-only 写限制 → 网络 allow 约束 */
export function checkSandbox(
  mode: SandboxMode,
  tool: string,
  args: Record<string, unknown>,
  rules: SandboxRules,
): SandboxDecision {
  // 域名黑名单：无论何种模式都拦截（安全基线，与 danger-full-access 也生效）
  const cmd = String(args.command ?? args.cmd ?? '');
  if (tool === 'run_shell' && cmd) {
    const hosts = extractNetworkHosts(cmd);
    for (const host of hosts) {
      if (rules.networkDeny.some((r) => hostMatches(r, host))) {
        return { blocked: true, reason: `目标域名 ${host} 命中网络黑名单` };
      }
    }
  }

  if (mode === 'danger-full-access') return { blocked: false };

  // read-only：禁写文件 + 禁 shell
  if (mode === 'read-only') {
    if (WRITE_TOOLS.has(tool)) {
      return { blocked: true, reason: 'read-only 模式禁止写文件（仅允许 read/list/grep）' };
    }
    if (tool === 'run_shell') {
      return { blocked: true, reason: 'read-only 模式禁止执行 shell 命令' };
    }
    return { blocked: false };
  }

  // container（P5-4）：文件工具放行（容器内无文件工具），shell 交给容器执行层；
  // 网络域名规则仍生效（容器执行同样受 allow/deny 约束）
  if (mode === 'container') {
    if (tool === 'run_shell' && cmd && rules.networkAllow.length > 0) {
      const hosts = extractNetworkHosts(cmd);
      for (const host of hosts) {
        if (!rules.networkAllow.some((r) => hostMatches(r, host))) {
          return { blocked: true, reason: `目标域名 ${host} 不在网络白名单` };
        }
      }
    }
    return { blocked: false };
  }

  // workspace-write：网络 allow 白名单约束（配置了 allow 列表时，未命中即拦截）
  if (tool === 'run_shell' && cmd && rules.networkAllow.length > 0) {
    const hosts = extractNetworkHosts(cmd);
    for (const host of hosts) {
      if (!rules.networkAllow.some((r) => hostMatches(r, host))) {
        return { blocked: true, reason: `目标域名 ${host} 不在网络白名单` };
      }
    }
  }

  return { blocked: false };
}

/** 沙箱模式 → 人类可读描述（doctor / help 用） */
export function describeSandboxMode(mode: SandboxMode): string {
  switch (mode) {
    case 'read-only':
      return '只读勘察（禁写禁执行）';
    case 'danger-full-access':
      return '全权限（绕过写限制与审批，危险命令仍拦截）';
    case 'container':
      return '容器隔离（shell 在 Docker 容器内执行，镜像 FH_SANDBOX_IMAGE）';
    default:
      return '工作区可写（shell 受白名单+审批约束）';
  }
}

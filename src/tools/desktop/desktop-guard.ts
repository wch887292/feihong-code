/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * C 层 · 停手线（feihong-desktop 内化 · 硬编码安全边界）
 *
 * desktop-touch-mcp 自带 auto-guard（写前必须验证窗口），本模块在其之上再叠一层
 * 「飞虹停手线」——纯函数、可单测、不依赖 MCP 服务器：
 *   1) 目标窗口必填：不允许对「未指定窗口」执行写操作（防误操作/防漂移）
 *   2) 危险窗口黑名单：系统关键窗口/凭据类窗口一律拒绝（管理员也拦）
 *   3) 动作白名单：只允许白名单内的动作类型，其他一律拒绝
 * 策略层（policy.ts）负责"谁能做、要不要审批"；停手线负责"绝对不许做"。
 */
import type { SandboxDecision } from '../sandbox';

/** feihong_desktop_act 支持的动作类型 */
export type DesktopAction =
  | 'type'          // 键盘输入文本（desktop_keyboard）
  | 'click'         // UIA 语义点击元素（desktop_click_element）
  | 'mouse_click'   // 屏幕坐标点击（desktop_mouse_click）
  | 'drag'          // 拖拽（desktop_mouse_drag）
  | 'scroll'        // 滚动（desktop_scroll）
  | 'terminal_send' // 终端发送命令（desktop_terminal）
  | 'launch';       // 启动应用（desktop_workspace_launch）

export const ALLOWED_ACTIONS: DesktopAction[] = [
  'type',
  'click',
  'mouse_click',
  'drag',
  'scroll',
  'terminal_send',
  'launch',
];

/**
 * 危险窗口黑名单（子串匹配，不区分大小写）。
 * 命中即拒绝——这些窗口一旦被 AI 操作，后果不可逆或涉及系统/凭据安全。
 * 用户可通过环境变量 FEIHONG_DESKTOP_BLOCK_WINDOWS（逗号分隔）追加。
 */
export const DEFAULT_BLOCKED_WINDOWS: string[] = [
  '任务管理器',
  'task manager',
  '注册表编辑器',
  'registry editor',
  '用户账户控制',
  'user account control',
  'windows 安全中心',
  'windows security',
  '系统配置',
  'system configuration',
  '设备管理器',
  'device manager',
  '磁盘管理',
  'disk management',
  '本地安全策略',
  '本地组策略',
];

/** 合并默认黑名单 + 用户扩展（FEIHONG_DESKTOP_BLOCK_WINDOWS） */
export function resolveBlockedWindows(extra?: string): string[] {
  const list = [...DEFAULT_BLOCKED_WINDOWS];
  if (extra?.trim()) {
    for (const w of extra.split(',')) {
      const s = w.trim().toLowerCase();
      if (s) list.push(s);
    }
  }
  return list;
}

export interface DesktopActInput {
  windowTitle?: string;
  action?: string;
}

/**
 * 停手线判定：返回 blocked 时，理由写入拒绝信息（模型可见，用于自我纠错）。
 */
export function checkDesktopGuard(
  input: DesktopActInput,
  blockedWindows: string[] = DEFAULT_BLOCKED_WINDOWS,
): SandboxDecision {
  const action = input.action ?? '';
  const title = (input.windowTitle ?? '').trim();

  // 1) 动作白名单
  if (!ALLOWED_ACTIONS.includes(action as DesktopAction)) {
    return {
      blocked: true,
      reason: `停手线：动作 "${action || '(空)'}" 不在白名单（${ALLOWED_ACTIONS.join('/')}）`,
    };
  }

  // 2) 目标窗口必填（launch 无窗口，豁免）
  if (action !== 'launch' && !title) {
    return {
      blocked: true,
      reason: '停手线：写操作必须显式指定 windowTitle（防误操作到无关窗口）',
    };
  }

  // 3) 危险窗口黑名单
  if (title) {
    const t = title.toLowerCase();
    for (const bad of blockedWindows) {
      if (t.includes(bad.toLowerCase())) {
        return { blocked: true, reason: `停手线：目标窗口 "${title}" 命中危险窗口黑名单（${bad}）` };
      }
    }
  }

  return { blocked: false };
}

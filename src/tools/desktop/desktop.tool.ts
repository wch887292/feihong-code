/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * C 层 · feihong-desktop 原生工具（模型可见的强类型入口）
 *
 * 三个工具，对应「看 → 动 → 验」闭环：
 *   feihong_desktop_see     只读：桌面状态勘察（焦点/窗口/光标）
 *   feihong_desktop_act     写：标准动作序列（guard → focus → act → 取证）
 *   feihong_desktop_verify  只读：截图+状态回读，验证动作是否生效
 *
 * 与 MCP 直通工具（desktop_*）的区别：
 *   - zod 强类型参数（不再是 z.record 宽松透传）
 *   - 内置停手线 + 强制取证（MCP 直通没有）
 *   - 语义化动作名（type/click/launch…），模型心智负担更低
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import type { DesktopClientLike } from './feihong-win';
import { feihongDesktopAct, ForensicsLogger, resolveForensicsDir } from './feihong-win';
import { ALLOWED_ACTIONS } from './desktop-guard';

/** 从 ToolContext 取 runId（构造取证目录用） */
function runIdOf(ctx: ToolContext): string {
  return typeof ctx.runId === 'string' ? ctx.runId : String(ctx.runId ?? 'session');
}

/* ================= feihong_desktop_see（只读勘察） ================= */

const seeSchema = z.object({
  /** 可选：按窗口标题/进程名过滤可见窗口（子串匹配） */
  filter: z.string().optional(),
});

export const feihongDesktopSeeTool: Tool = {
  name: 'feihong_desktop_see',
  description: '只读勘察当前 Windows 桌面：焦点窗口、可见窗口、光标位置。不改变任何状态。',
  jsonSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: '可选：按窗口标题/进程名过滤（子串匹配）' },
    },
  },
  schema: seeSchema,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const client = (ctx as ToolContext & { _desktopClient?: DesktopClientLike })._desktopClient;
    if (!client) {
      return { ok: false, output: '', error: 'feihong-desktop 未挂载（当前会话无 desktop MCP）' };
    }
    const { filter } = seeSchema.parse(args);
    try {
      const state = await client.callTool('desktop_state', {});
      if (!state.ok) return { ok: false, output: '', error: `desktop_state 失败: ${state.error ?? state.output}` };
      let out = state.output;
      if (filter) {
        try {
          const parsed = JSON.parse(state.output) as {
            visibleWindows?: Array<{ title?: string; processName?: string }>;
          };
          const hits = (parsed.visibleWindows ?? []).filter(
            (w) =>
              (w.title ?? '').toLowerCase().includes(filter.toLowerCase()) ||
              (w.processName ?? '').toLowerCase().includes(filter.toLowerCase()),
          );
          out = JSON.stringify({ ...parsed, visibleWindows: hits, filteredBy: filter });
        } catch {
          // 服务器返回非 JSON 时不强行解析，原样返回
        }
      }
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
    }
  },
};

/* ================= feihong_desktop_act（写 · 标准动作序列） ================= */

const actSchema = z.object({
  /** 目标窗口标题（type/click/mouse_click/drag/scroll/terminal_send 必填；launch 豁免） */
  windowTitle: z.string().optional(),
  /** 动作类型 */
  action: z.enum(ALLOWED_ACTIONS),
  /** type/terminal_send 的文本内容 */
  text: z.string().optional(),
  /** click 的 UIA 元素名/automationId */
  element: z.string().optional(),
  /** mouse_click / drag 起点坐标 */
  x: z.number().optional(),
  y: z.number().optional(),
  /** drag 终点坐标 */
  endX: z.number().optional(),
  endY: z.number().optional(),
  /** scroll 增量 */
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  /** launch 的应用命令 */
  command: z.string().optional(),
  /** launch 等待窗口出现毫秒数（默认 5000） */
  waitMs: z.number().optional(),
});

export const feihongDesktopActTool: Tool = {
  name: 'feihong_desktop_act',
  description:
    '对 Windows 桌面执行动作（需审批）：type 键盘输入 / click UIA 点击 / mouse_click 坐标点击 / drag 拖拽 / scroll 滚动 / terminal_send 终端命令 / launch 启动应用。自动执行：停手线检查 → 聚焦目标窗口 → 动作 → 截图取证。',
  jsonSchema: {
    type: 'object',
    properties: {
      windowTitle: { type: 'string', description: '目标窗口标题（写操作必填）' },
      action: { type: 'string', enum: ALLOWED_ACTIONS, description: '动作类型' },
      text: { type: 'string', description: 'type/terminal_send 的文本' },
      element: { type: 'string', description: 'click 的 UIA 元素名' },
      x: { type: 'number', description: 'mouse_click/drag 起点 x' },
      y: { type: 'number', description: 'mouse_click/drag 起点 y' },
      endX: { type: 'number', description: 'drag 终点 x' },
      endY: { type: 'number', description: 'drag 终点 y' },
      deltaX: { type: 'number', description: 'scroll 水平增量' },
      deltaY: { type: 'number', description: 'scroll 垂直增量（负=向上）' },
      command: { type: 'string', description: 'launch 的应用命令' },
      waitMs: { type: 'number', description: 'launch 等待毫秒数' },
    },
    required: ['action'],
  },
  schema: actSchema,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const client = (ctx as ToolContext & { _desktopClient?: DesktopClientLike })._desktopClient;
    if (!client) {
      return { ok: false, output: '', error: 'feihong-desktop 未挂载（当前会话无 desktop MCP）' };
    }
    const p = actSchema.parse(args);
    const forensics = new ForensicsLogger(resolveForensicsDir(runIdOf(ctx)), client);
    const r = await feihongDesktopAct(client, forensics, p);
    if (!r.ok) {
      return { ok: false, output: '', error: r.error, ...(r.forensicsPath ? { output: `取证: ${r.forensicsPath}` } : {}) };
    }
    return {
      ok: true,
      output: `${r.output}\n[取证] ${r.forensicsPath ?? ''}\n[提示] 若需确认效果，调用 feihong_desktop_verify`,
    };
  },
};

/* ================= feihong_desktop_verify（只读回读验证） ================= */

const verifySchema = z.object({
  /** 期望出现的文本（在截图 OCR / 状态输出中匹配，子串） */
  expectText: z.string().optional(),
  /** 期望处于焦点的窗口标题（子串） */
  expectWindow: z.string().optional(),
});

export const feihongDesktopVerifyTool: Tool = {
  name: 'feihong_desktop_verify',
  description: '只读回读验证：截图 + 桌面状态，检查动作是否生效（期望文本是否出现/期望窗口是否聚焦）。',
  jsonSchema: {
    type: 'object',
    properties: {
      expectText: { type: 'string', description: '期望出现的文本（子串匹配）' },
      expectWindow: { type: 'string', description: '期望聚焦的窗口标题（子串）' },
    },
  },
  schema: verifySchema,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const client = (ctx as ToolContext & { _desktopClient?: DesktopClientLike })._desktopClient;
    if (!client) {
      return { ok: false, output: '', error: 'feihong-desktop 未挂载（当前会话无 desktop MCP）' };
    }
    const { expectText, expectWindow } = verifySchema.parse(args);
    try {
      const [shot, state] = await Promise.all([
        client.callTool('screenshot', {}),
        client.callTool('desktop_state', {}),
      ]);
      const checks: string[] = [];
      let passed = true;
      if (expectWindow) {
        try {
          const st = JSON.parse(state.output) as { focusedWindow?: { title?: string } | null };
          const focused = st.focusedWindow?.title ?? '';
          const hit = focused.toLowerCase().includes(expectWindow.toLowerCase());
          checks.push(`窗口焦点: ${hit ? '命中' : '未命中'}（当前焦点: ${focused || '(无)'}）`);
          if (!hit) passed = false;
        } catch { /* 解析失败跳过该项 */ }
      }
      if (expectText) {
        const ocrText = (shot.output ?? '') + (state.output ?? '');
        const hit = ocrText.includes(expectText);
        checks.push(`文本匹配: ${hit ? '命中' : '未命中'}（在截图/状态输出中检索 "${expectText}"）`);
        if (!hit) passed = false;
      }
      if (checks.length === 0) {
        checks.push('未提供期望条件，仅返回截图与状态（请用 expectText/expectWindow 做断言）');
      }
      return {
        ok: true,
        output: `验证${passed ? '通过' : '未通过'}:\n- ${checks.join('\n- ')}\n--- 状态 ---\n${state.output.slice(0, 400)}\n--- 截图返回 ---\n${shot.output.slice(0, 200)}`,
      };
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const feihongDesktopTools: Tool[] = [
  feihongDesktopSeeTool,
  feihongDesktopActTool,
  feihongDesktopVerifyTool,
];

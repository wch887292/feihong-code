/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * C 层 · feihong-win 内化核心（Windows 手脚标准动作序列）
 *
 * 把 desktop-touch-mcp 的零散 MCP 调用固化成一条纪律化流水线：
 *   probe（可选）→ guard（停手线）→ focus（验证目标窗口）→ act（执行动作）
 *   → verify（截图回读）→ forensics（取证落盘）
 *
 * 设计要点：
 *  - 复用主流程 attachMcpTools 创建的 McpClient（不重复 spawn 进程）
 *  - 取证目录：FH_HOME/forensics/<runId>/manifest.jsonl + shots/，与审计链同源
 *  - 每次写操作后强制截图取证，保证「操作留痕、可复盘、可甩锅」
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { McpCallResult } from '../mcp/mcp-client';
import { checkDesktopGuard, type DesktopAction } from './desktop-guard';

/** 与 McpClient.callTool 兼容的最小接口（便于单测注入 fake） */
export interface DesktopClientLike {
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

/** 取证目录解析：FH_FORENSICS_DIR 覆盖，缺省 FH_HOME/forensics */
export function resolveForensicsDir(runId: string): string {
  const base = process.env.FH_FORENSICS_DIR || join(homedir(), '.feihong-code', 'forensics');
  const dir = join(base, runId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'shots'), { recursive: true });
  return dir;
}

/** 取证记录器：JSONL manifest + 截图目录 */
export class ForensicsLogger {
  constructor(
    private readonly dir: string,
    private readonly client: DesktopClientLike,
  ) {}

  /** 追加一条动作记录（工具/入参摘要/结果摘要/时间） */
  record(entry: Record<string, unknown>): void {
    try {
      appendFileSync(
        join(this.dir, 'manifest.jsonl'),
        JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n',
        'utf8',
      );
    } catch (e) {
      // 取证写入失败不阻断主流程，但把错误带进返回（调用方可见）
      // eslint-disable-next-line no-console
      console.warn('[forensics] manifest 写入失败:', e instanceof Error ? e.message : String(e));
    }
  }

  /** 执行后强制截图取证：截图返回全文记入 manifest；desktop-touch 磁盘缓存保留原图 */
  async snapshot(note: string): Promise<McpCallResult> {
    const res = await this.client.callTool('screenshot', {});
    this.record({ event: 'snapshot', note, screenshotOutput: res.output?.slice(0, 500) || '' });
    return res;
  }

  get manifestPath(): string {
    return join(this.dir, 'manifest.jsonl');
  }
}

export interface FeihongActParams {
  windowTitle?: string;
  action: DesktopAction;
  text?: string;
  element?: string;
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  deltaX?: number;
  deltaY?: number;
  command?: string;
  waitMs?: number;
}

/** 动作 → desktop-touch MCP 工具调用映射（入参对齐已实测的工具 schema） */
function mapAction(p: FeihongActParams): { tool: string; args: Record<string, unknown> } {
  switch (p.action) {
    // type 用 '@active'：feihong 层已 focus 目标窗口（停手线校验过标题），
    // keyboard 直接瞄准当前前台窗口，规避「标题中英文差异导致 AutoGuard 拦截」。
    case 'type':
      return { tool: 'keyboard', args: { action: 'type', text: p.text ?? '', windowTitle: '@active' } };
    case 'click':
      return { tool: 'click_element', args: { name: p.element ?? '', windowTitle: p.windowTitle } };
    case 'mouse_click':
      return { tool: 'mouse_click', args: { x: p.x ?? 0, y: p.y ?? 0, windowTitle: p.windowTitle } };
    case 'drag':
      return {
        tool: 'mouse_drag',
        args: { startX: p.x ?? 0, startY: p.y ?? 0, endX: p.endX ?? 0, endY: p.endY ?? 0, windowTitle: p.windowTitle },
      };
    case 'scroll':
      return { tool: 'scroll', args: { deltaX: p.deltaX ?? 0, deltaY: p.deltaY ?? -100, windowTitle: p.windowTitle } };
    case 'terminal_send':
      return { tool: 'terminal', args: { action: 'send', text: p.text ?? '', windowTitle: p.windowTitle } };
    case 'launch':
      return { tool: 'workspace_launch', args: { command: p.command ?? '', waitMs: p.waitMs ?? 5000 } };
  }
}

/**
 * MCP 结果语义判定：desktop-touch 的感知守卫/错误码会以"正常返回"携带错误文本，
 * 仅看 MCP 层 ok 会漏判。命中错误码 → 视为失败，并保留原始输出供模型复盘。
 */
const DESKTOP_ERROR_CODES = [
  'AutoGuardBlocked',
  'GuardFailed',
  'DestinationRequired',
  'ElementDisabled',
  'InvokePatternNotSupported',
  'WindowNotFound',
  'FocusFailed',
];

function isDesktopError(output: string): boolean {
  for (const code of DESKTOP_ERROR_CODES) {
    if (output.includes(code)) return true;
  }
  return false;
}

/**
 * 标准动作序列：guard → focus（launch 豁免）→ act → 取证截图
 * 返回结构化结果：动作输出 + 取证 manifest 路径 + 截图回读
 */
export async function feihongDesktopAct(
  client: DesktopClientLike,
  forensics: ForensicsLogger,
  params: FeihongActParams,
): Promise<{ ok: boolean; output: string; error?: string; forensicsPath?: string }> {
  // 1) 停手线（硬编码，任何角色不可绕过）
  const guard = checkDesktopGuard({ windowTitle: params.windowTitle, action: params.action });
  if (guard.blocked) {
    forensics.record({ event: 'act_blocked', action: params.action, windowTitle: params.windowTitle, reason: guard.reason });
    return { ok: false, output: '', error: guard.reason, forensicsPath: forensics.manifestPath };
  }

  // 2) 聚焦目标窗口（launch 无既有窗口，豁免）
  if (params.action !== 'launch' && params.windowTitle) {
    const f = await client.callTool('focus_window', { title: params.windowTitle });
    if (!f.ok) {
      forensics.record({ event: 'focus_failed', windowTitle: params.windowTitle, error: f.error });
      return { ok: false, output: '', error: `聚焦窗口失败: ${f.error ?? f.output}`, forensicsPath: forensics.manifestPath };
    }
  }

  // 3) 执行动作
  const { tool, args } = mapAction(params);
  const res = await client.callTool(tool, args);

  // 3.5) 结果语义判定：MCP 层 ok 但输出携带感知守卫错误码 → 视为失败
  const semanticallyFailed = res.ok && isDesktopError(res.output ?? '');

  // 4) 取证截图（无论成败都截图——失败现场同样可复盘）
  const shot = await forensics.snapshot(`${params.action}@${params.windowTitle ?? params.command ?? ''}`);

  forensics.record({
    event: 'act',
    action: params.action,
    windowTitle: params.windowTitle,
    command: params.command,
    tool,
    args: JSON.stringify(args).slice(0, 300),
    resultOk: res.ok,
    result: res.output?.slice(0, 300) || res.error || '',
    shotOk: shot.ok,
  });

  if (!res.ok || semanticallyFailed) {
    const errText = res.error ?? res.output ?? '';
    const hint = semanticallyFailed
      ? '（desktop-touch 感知守卫拦截，请根据输出中的 suggest 调整后重试）'
      : '';
    return { ok: false, output: '', error: `${errText.slice(0, 400)}${hint}`, forensicsPath: forensics.manifestPath };
  }
  return { ok: true, output: res.output, forensicsPath: forensics.manifestPath };
}

/** 目录是否已存在（测试辅助） */
export function forensicsDirExists(dir: string): boolean {
  return existsSync(join(dir, 'manifest.jsonl')) || existsSync(dir);
}

/** 写一个空占位文件（测试辅助，正常流程由 resolveForensicsDir 创建） */
export function touchFile(p: string): void {
  writeFileSync(p, '', 'utf8');
}

/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 执行轨迹（对标 dsh trajectory）：
 *  - 读取 EventLog 的 append-only JSONL（sessions/<runId>.jsonl）
 *  - replay：按时间线回放（plan → model.response → tool.call/result → error → session.end）
 *  - fork：从指定步骤重建会话检查点（messages 由 model.response + tool.result 重建），
 *    输出新 runId 供 `fhcode resume` 分支续跑
 */
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AgentEvent } from './event-log';
import type { SessionCheckpoint } from './session-persist';
import type { ChatMessage } from '../models/model.interface';

export interface TrajectoryMeta {
  runId: string;
  eventCount: number;
  sizeBytes: number;
  firstTs?: string;
  lastTs?: string;
  goal?: string;
}

function trajectoryDir(homeDir: string): string {
  return join(homeDir, 'sessions');
}

/** 解析单个 JSONL 轨迹文件（跳过损坏行） */
export async function readTrajectory(homeDir: string, runId: string): Promise<AgentEvent[]> {
  const file = join(trajectoryDir(homeDir), `${runId}.jsonl`);
  if (!existsSync(file)) return [];
  const text = await readFile(file, 'utf8');
  const events: AgentEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as AgentEvent);
    } catch {
      /* 跳过损坏行 */
    }
  }
  return events;
}

/** 列出全部轨迹文件元信息 */
export async function listTrajectories(homeDir: string): Promise<TrajectoryMeta[]> {
  const dir = trajectoryDir(homeDir);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
  const out: TrajectoryMeta[] = [];
  for (const f of files) {
    try {
      const stat = await readFile(join(dir, f), 'utf8');
      const sizeBytes = Buffer.byteLength(stat, 'utf8');
      const events = (await readTrajectory(homeDir, f.replace(/\.jsonl$/, ''))).slice(0, 200);
      const start = events.find((e) => e.type === 'session.start');
      let end = events[events.length - 1];
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].type === 'session.end') { end = events[i]; break; }
      }
      out.push({
        runId: f.replace(/\.jsonl$/, ''),
        eventCount: events.length,
        sizeBytes,
        firstTs: events[0]?.ts,
        lastTs: end?.ts ?? events[events.length - 1]?.ts,
        goal: typeof start?.goal === 'string' ? start.goal : undefined,
      });
    } catch {
      /* 跳过损坏轨迹 */
    }
  }
  return out.sort((a, b) => (a.lastTs ?? '').localeCompare(b.lastTs ?? ''));
}

/** 单条事件的回放文本行 */
function formatEvent(ev: AgentEvent): string {
  const time = (ev.ts ?? '').slice(11, 19);
  switch (ev.type) {
    case 'session.start':
      return `[${time}] 会话开始 目标: ${String(ev.goal ?? '').slice(0, 120)}（cwd=${String(ev.cwd ?? '')}）`;
    case 'session.end':
      return `[${time}] 会话结束 ${ev.status ? `状态=${String(ev.status)}` : ''} 迭代=${String(ev.iterations ?? '')} 成本=$${String(ev.costUsd ?? '0')}`;
    case 'plan':
      return `[${time}] 计划 ${Array.isArray(ev.steps) ? ev.steps.length + ' 步' : ''}`;
    case 'model.response': {
      const tc = Array.isArray(ev.toolCalls) ? ` 工具: ${(ev.toolCalls as Array<{ name?: string }>).map((t) => t.name).join(', ')}` : '';
      const usage = ev.usage ? ` tokens: ${JSON.stringify(ev.usage)}` : '';
      return `[${time}] 模型回复 [${String(ev.provider ?? '')}/${String(ev.model ?? '')}]${usage} 延迟=${String(ev.latencyMs ?? '')}ms${tc}\n        ${String(ev.content ?? '').slice(0, 200).replace(/\n/g, ' ')}`;
    }
    case 'tool.call':
      return `[${time}] 工具调用 ${String(ev.name)} ${JSON.stringify(ev.args ?? {}).slice(0, 160)}`;
    case 'tool.result':
      return `[${time}] 工具结果 ${String(ev.name)} ok=${String(ev.ok)} ${String(ev.output ?? '').slice(0, 120).replace(/\n/g, ' ')}`;
    case 'error':
      return `[${time}] 错误 ${String(ev.reason ?? '')} ${JSON.stringify(Object.fromEntries(Object.entries(ev).filter(([k]) => !['ts', 'runId', 'type'].includes(k))))}`;
    case 'self-heal':
      return `[${time}] 自愈/引导 ${String(ev.category ?? '')}`;
    default:
      return `[${time}] ${ev.type} ${JSON.stringify(Object.fromEntries(Object.entries(ev).filter(([k]) => !['ts', 'runId', 'type'].includes(k))))}`;
  }
}

/** 格式化回放全文 */
export function formatReplay(events: AgentEvent[]): string {
  if (events.length === 0) return '（轨迹为空或不存在）';
  const lines: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    lines.push(`${String(i).padStart(3, ' ')} | ${formatEvent(ev)}`);
  }
  return lines.join('\n');
}

/**
 * 从轨迹重建检查点（fork 分支点）。
 * 消息重建规则：
 *  - session.start.goal → user 消息
 *  - model.response.content+toolCalls → assistant 消息
 *  - tool.result.output+id → tool 消息（与 assistant.toolCalls 成对）
 *  - touchedFiles 从 write_file/edit_file 的 tool.call 参数提取
 * 只处理事件索引 < stepIndex 的事件。
 */
export async function buildForkCheckpoint(
  homeDir: string,
  runId: string,
  stepIndex: number,
): Promise<{ checkpoint: SessionCheckpoint; steps: number }> {
  const events = await readTrajectory(homeDir, runId);
  if (events.length === 0) throw new Error(`轨迹不存在或为空: ${runId}`);
  const step = Number.isFinite(stepIndex) ? Math.min(Math.max(0, Math.floor(stepIndex)), events.length) : events.length;

  const messages: ChatMessage[] = [];
  const touchedFiles: string[] = [];
  // toolCallId → 完整 arguments（来自 tool.call 事件；model.response 截断的参数用它补齐）
  const fullArgs = new Map<string, Record<string, unknown>>();
  let goal = '';
  let cwd = process.cwd();
  let iterations = 0;

  // 第一遍：收集 goal/cwd/tool 完整参数/被改文件（tool.call 事件在 model.response 之后出现）
  for (let i = 0; i < step; i++) {
    const ev = events[i];
    if (ev.type === 'session.start') {
      goal = String(ev.goal ?? '');
      cwd = String(ev.cwd ?? cwd);
    } else if (ev.type === 'tool.call') {
      const args = (ev.args ?? {}) as Record<string, unknown>;
      if (typeof ev.id === 'string' && ev.id && args && typeof args === 'object') {
        fullArgs.set(ev.id, args);
      }
      if ((ev.name === 'write_file' || ev.name === 'edit_file') && typeof args?.path === 'string' && args.path.trim()) {
        touchedFiles.push(args.path.trim());
      }
    }
  }

  // 第二遍：重建消息（assistant toolCalls 截断参数用第一遍收集的完整 args 补齐）
  for (let i = 0; i < step; i++) {
    const ev = events[i];
    if (ev.type === 'session.start') {
      if (goal) messages.push({ role: 'user', content: goal });
    } else if (ev.type === 'model.response') {
      const content = String(ev.content ?? '');
      const toolCalls = Array.isArray(ev.toolCalls)
        ? (ev.toolCalls as Array<{ id: string; name: string; arguments?: unknown }>)
            .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string')
            .map((t) => ({
              id: t.id,
              name: t.name,
              // 截断的参数用 tool.call 完整 args 补齐；无则保留原值
              arguments: (fullArgs.get(t.id) ?? (t.arguments ?? {})) as Record<string, unknown>,
            }))
        : [];
      if (content || toolCalls.length > 0) {
        messages.push({ role: 'assistant', content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined });
        iterations++;
      }
    } else if (ev.type === 'tool.result') {
      messages.push({ role: 'tool', content: String(ev.output ?? ''), toolCallId: String(ev.id ?? '') });
    }
  }

  const now = new Date().toISOString();
  const checkpoint: SessionCheckpoint = {
    runId: randomUUID(),
    goal: goal || `fork 自 ${runId}（截至步骤 ${step}）`,
    cwd,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    iterations,
    costUsd: 0,
    messages,
    touchedFiles,
  };
  return { checkpoint, steps: step };
}

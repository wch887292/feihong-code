/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P4-2 Agent teams（对齐 Claude Code agent teams）：
 *  - TeamBus      消息总线：agent 间互发消息（send/receive/broadcast）
 *  - TaskBoard    共享任务清单：add/claim/complete（原子认领，避免重复执行）
 *  - runTeam      协调器：多 agent 并发从共享清单认领任务执行，
 *                  结果经总线汇聚，产出团队报告
 *
 * 设计：
 *  - 纯内存、零依赖；agent 执行复用 runSubTask 回调（CLI 注入真实装配）
 *  - 认领用「状态 + owner」双校验保证原子性（单进程内足够）
 *  - 逐 agent 结果经 summarizeSubTaskAnswer 摘要后回传，隔离中间输出
 */
import { randomUUID } from 'crypto';
import { logger } from '../shared/logger';
import { summarizeSubTaskAnswer } from './subagent-summary';

/** 团队成员名 */
export type AgentId = string;

/** 团队成员声明（供协调器创建） */
export interface TeamMember {
  id: AgentId;
  /** 角色/职责描述，注入 agent 的聚焦提示 */
  role: string;
}

/** 总线消息 */
export interface TeamMessage {
  id: string;
  from: AgentId;
  to: AgentId | '*';
  content: string;
  ts: string;
}

/** 共享任务条目 */
export interface TeamTask {
  id: string;
  goal: string;
  status: 'open' | 'claimed' | 'done' | 'failed';
  /** 认领者（claimed 时非空） */
  owner?: AgentId;
  result?: string;
  error?: string;
}

/** ---------- 消息总线 ---------- */
export class TeamBus {
  private readonly messages: TeamMessage[] = [];
  private readonly inbox = new Map<AgentId, TeamMessage[]>();

  send(from: AgentId, to: AgentId, content: string): TeamMessage {
    const msg: TeamMessage = { id: randomUUID(), from, to, content, ts: new Date().toISOString() };
    this.messages.push(msg);
    if (to === '*') {
      // 广播：每个成员 inbox 都投递
      for (const box of this.inbox.keys()) box && this.deliver(box, msg);
    } else {
      this.deliver(to, msg);
    }
    return msg;
  }

  private deliver(to: AgentId, msg: TeamMessage): void {
    if (!this.inbox.has(to)) this.inbox.set(to, []);
    this.inbox.get(to)!.push(msg);
  }

  /** 成员注册（必须先注册才能收消息） */
  register(id: AgentId): void {
    if (!this.inbox.has(id)) this.inbox.set(id, []);
  }

  /** 取走该成员的所有新消息（清空 inbox） */
  receive(id: AgentId): TeamMessage[] {
    const box = this.inbox.get(id) ?? [];
    this.inbox.set(id, []);
    return box;
  }

  /** 全量历史（报告用） */
  history(): TeamMessage[] {
    return [...this.messages];
  }
}

/** ---------- 共享任务清单 ---------- */
export class TaskBoard {
  private readonly tasks = new Map<string, TeamTask>();

  add(goal: string): TeamTask {
    const task: TeamTask = { id: randomUUID(), goal, status: 'open' };
    this.tasks.set(task.id, task);
    return task;
  }

  /** 认领一个 open 任务（原子：状态 open 且无人持有才成功） */
  claim(agentId: AgentId): TeamTask | null {
    for (const task of this.tasks.values()) {
      if (task.status === 'open') {
        task.status = 'claimed';
        task.owner = agentId;
        return task;
      }
    }
    return null;
  }

  complete(taskId: string, result: string): void {
    const t = this.tasks.get(taskId);
    if (t) {
      t.status = 'done';
      t.result = result;
    }
  }

  fail(taskId: string, error: string): void {
    const t = this.tasks.get(taskId);
    if (t) {
      t.status = 'failed';
      t.error = error;
    }
  }

  list(): TeamTask[] {
    return [...this.tasks.values()];
  }

  get openCount(): number {
    return [...this.tasks.values()].filter((t) => t.status === 'open').length;
  }

  get doneCount(): number {
    return [...this.tasks.values()].filter((t) => t.status === 'done').length;
  }
}

/** ---------- 团队运行 ---------- */

export interface TeamRunOptions {
  /** 成员列表（缺省按任务数生成 3 个通用成员） */
  members?: TeamMember[];
  /** 执行单个任务的回调（CLI 注入真实 Orchestrator 装配） */
  runSubTask: (goal: string) => Promise<{ ok: boolean; finalAnswer: string; iterations: number }>;
  /** 每轮认领间隔（ms，离线 mock 可设 0；真实模式默认 100 防忙轮询） */
  pollIntervalMs?: number;
  /** 单成员最大执行任务数（防个别成员吞掉全部任务） */
  maxTasksPerMember?: number;
}

export interface TeamReport {
  team: TeamMember[];
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  overall: 'success' | 'partial' | 'failed';
  messages: TeamMessage[];
  summary: string;
}

/**
 * 团队协作执行：先把目标拆解为任务清单（由调用方传入 tasks），
 * 然后 N 个 agent 并发认领执行，结果经总线汇报。
 * 协调器等待全部任务完成（或所有成员退出）后产出报告。
 */
export async function runTeam(
  tasks: string[],
  opts: TeamRunOptions,
): Promise<TeamReport> {
  const board = new TaskBoard();
  for (const goal of tasks) board.add(goal);

  const bus = new TeamBus();
  const members: TeamMember[] =
    opts.members ??
    Array.from({ length: Math.min(3, tasks.length || 1) }, (_, i) => ({
      id: `agent-${i + 1}`,
      role: '通用成员',
    }));
  for (const m of members) bus.register(m.id);

  logger.info('team start', { members: members.length, tasks: tasks.length });

  // 每个成员独立循环：认领 → 执行 → 汇报，直到清单空或达个人上限
  const memberRuns = members.map(async (member) => {
    let done = 0;
    const maxPer = opts.maxTasksPerMember ?? Math.ceil(tasks.length / members.length) + 1;
    for (;;) {
      const task = board.claim(member.id);
      if (!task) break; // 无任务可认领 → 退出
      if (done >= maxPer) {
        board.fail(task.id, `${member.id} 达到个人任务上限`);
        break;
      }
      bus.send(member.id, '*', `认领任务: ${task.goal.slice(0, 60)}`);
      try {
        const outcome = await opts.runSubTask(task.goal);
        const s = summarizeSubTaskAnswer(outcome.finalAnswer);
        if (outcome.ok) {
          board.complete(task.id, s.text);
          bus.send(member.id, '*', `完成: ${task.goal.slice(0, 60)} → OK`);
        } else {
          // 执行成功返回但结果失败（ok=false）同样记为 failed
          board.fail(task.id, s.text || '任务执行未成功');
          bus.send(member.id, '*', `失败: ${task.goal.slice(0, 60)} → FAIL`);
        }
        done++;
      } catch (e) {
        board.fail(task.id, e instanceof Error ? e.message : String(e));
        bus.send(member.id, '*', `失败: ${task.goal.slice(0, 60)}`);
        done++;
      }
      if (opts.pollIntervalMs) await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
    }
    return member;
  });

  await Promise.all(memberRuns);

  const list = board.list();
  const completed = list.filter((t) => t.status === 'done').length;
  const failed = list.filter((t) => t.status === 'failed').length;
  const overall = completed === list.length ? 'success' : completed > 0 ? 'partial' : 'failed';
  const messages = bus.history();

  const lines: string[] = [];
  lines.push(`== Agent Team 报告 ==`);
  lines.push(`成员: ${members.map((m) => m.id).join(', ')}`);
  lines.push(`任务: 共 ${list.length} 个, 完成 ${completed} 个, 失败 ${failed} 个`);
  lines.push(`总体: ${overall.toUpperCase()}`);
  lines.push('');
  for (const t of list) {
    const status = t.status === 'done' ? '✅' : t.status === 'failed' ? '❌' : '⏸';
    lines.push(`[${t.id.slice(0, 8)}] ${status} ${t.goal}${t.owner ? ` (${t.owner})` : ''}`);
    if (t.result) lines.push(`    ${t.result.slice(0, 120)}`);
    if (t.error) lines.push(`    错误: ${t.error.slice(0, 120)}`);
  }
  lines.push('');
  lines.push(`消息总线: ${messages.length} 条`);

  return {
    team: members,
    totalTasks: list.length,
    completedTasks: completed,
    failedTasks: failed,
    overall,
    messages,
    summary: lines.join('\n'),
  };
}

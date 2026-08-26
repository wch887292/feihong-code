/**
 * 飞虹 Code - SOLO 全自主编程代理 (P3-2)
 *
 * 在现有 SWE Agent 基础上增强为全自主编程模式：
 * - 任务规划与依赖管理
 * - 并行执行独立任务
 * - 实时进度跟踪（事件回调）
 * - 自动验证与自我修正
 * - 完整的执行报告
 *
 * SOLO 模式 = 全自动端到端编程，用户只需描述需求，Agent 自动完成：
 * 需求理解 → 仓库分析 → 任务规划 → 代码实现 → 自动验证 → 自我修正 → 产出报告
 */
import { readRepository, type RepoSnapshot } from './repo-reader';
import { planSweTask, type SwePlan } from './swe-planner';
import { verifyTask, type VerifyResult } from './swe-verifier';
import { logger } from '../shared/logger';

/** SOLO 任务状态 */
export type SoloTaskStatus = 'pending' | 'planning' | 'in-progress' | 'verifying' | 'retrying' | 'completed' | 'failed' | 'skipped';

/** SOLO 任务 */
export interface SoloTask {
  id: string;
  title: string;
  description: string;
  status: SoloTaskStatus;
  priority: 'critical' | 'high' | 'medium' | 'low';
  dependsOn: string[];
  retries: number;
  maxRetries: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  touchedFiles: string[];
  verifyResult?: VerifyResult;
  error?: string;
  output?: string;
}

/** SOLO 执行阶段 */
export type SoloPhase = 'initializing' | 'analyzing-repo' | 'planning' | 'executing' | 'verifying' | 'self-correcting' | 'generating-report' | 'completed' | 'failed';

/** SOLO 事件类型 */
export type SoloEventType =
  | 'phase-change'
  | 'task-start'
  | 'task-progress'
  | 'task-complete'
  | 'task-fail'
  | 'task-retry'
  | 'verify-start'
  | 'verify-result'
  | 'log'
  | 'error';

/** SOLO 事件 */
export interface SoloEvent {
  type: SoloEventType;
  timestamp: string;
  phase: SoloPhase;
  taskId?: string;
  message: string;
  data?: Record<string, unknown>;
}

/** SOLO 配置 */
export interface SoloConfig {
  cwd: string;
  goal: string;
  maxTasks?: number;
  maxRetries?: number;
  parallel?: boolean;
  maxParallel?: number;
  planOnly?: boolean;
  verifyOnly?: boolean;
  autoCorrect?: boolean;
  includePreviews?: boolean;
  maxFiles?: number;
}

/** SOLO 执行报告 */
export interface SoloReport {
  goal: string;
  cwd: string;
  overall: 'success' | 'partial' | 'failed';
  phase: SoloPhase;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  tasks: SoloTask[];
  repoSummary?: string;
  planSummary?: string;
  summary: string;
  events: SoloEvent[];
}

/** 子任务执行器 */
export type SubTaskExecutor = (focusedGoal: string, taskId: string) => Promise<{
  ok: boolean;
  output: string;
  touchedFiles: string[];
  iterations: number;
}>;

/**
 * SOLO 全自主编程代理
 */
export class SoloAgent {
  private config: Required<SoloConfig>;
  private tasks: SoloTask[] = [];
  private events: SoloEvent[] = [];
  private phase: SoloPhase = 'initializing';
  private repoSnapshot?: RepoSnapshot;
  private plan?: SwePlan;
  private executor: SubTaskExecutor;
  private startedAt?: Date;

  constructor(config: SoloConfig, executor: SubTaskExecutor) {
    this.config = {
      maxTasks: 8,
      maxRetries: 3,
      parallel: false,
      maxParallel: 2,
      planOnly: false,
      verifyOnly: false,
      autoCorrect: true,
      includePreviews: false,
      maxFiles: 200,
      ...config,
    };
    this.executor = executor;
  }

  /**
   * 运行 SOLO 全自主编程
   */
  async run(): Promise<SoloReport> {
    this.startedAt = new Date();
    this.emit('phase-change', 'SOLO 模式启动', { goal: this.config.goal });

    try {
      // 阶段 1: 分析仓库
      this.setPhase('analyzing-repo');
      this.emit('log', '分析代码仓库...');
      this.repoSnapshot = await readRepository(this.config.cwd, { maxFiles: this.config.maxFiles });
      this.emit('log', `仓库分析完成：${this.repoSnapshot.files.length} 个文件`, {
        fileCount: this.repoSnapshot.files.length,
      });

      // 阶段 2: 任务规划
      this.setPhase('planning');
      this.emit('log', '规划任务...');
      this.plan = await planSweTask(this.config.goal, this.repoSnapshot);
      this.tasks = this.plan.tasks.map((t, i) => ({
        id: `task-${i + 1}`,
        title: t.title,
        description: t.description || '',
        status: 'pending' as SoloTaskStatus,
        priority: (t.complexity >= 4 ? 'high' : t.complexity >= 3 ? 'medium' : 'low') as 'critical' | 'high' | 'medium' | 'low',
        dependsOn: t.dependsOn || [],
        retries: 0,
        maxRetries: this.config.maxRetries,
        touchedFiles: [],
      }));
      this.emit('log', `规划完成：${this.tasks.length} 个任务`, { taskCount: this.tasks.length });

      if (this.config.planOnly) {
        return this.generateReport('success');
      }

      // 阶段 3: 执行任务
      this.setPhase('executing');
      if (this.config.parallel) {
        await this.executeTasksParallel();
      } else {
        await this.executeTasksSequential();
      }

      // 阶段 4: 生成报告
      this.setPhase('generating-report');
      const completed = this.tasks.filter((t) => t.status === 'completed').length;
      const failed = this.tasks.filter((t) => t.status === 'failed').length;
      const overall = failed === 0 ? 'success' : completed > 0 ? 'partial' : 'failed';

      return this.generateReport(overall);
    } catch (error) {
      this.setPhase('failed');
      this.emit('error', `SOLO 执行失败: ${error instanceof Error ? error.message : String(error)}`);
      return this.generateReport('failed');
    }
  }

  /**
   * 顺序执行任务
   */
  private async executeTasksSequential(): Promise<void> {
    for (const task of this.tasks) {
      if (task.status === 'skipped') continue;
      await this.executeTask(task);
    }
  }

  /**
   * 并行执行任务（按依赖关系分组）
   */
  private async executeTasksParallel(): Promise<void> {
    const executed = new Set<string>();
    const maxParallel = this.config.maxParallel;

    while (executed.size < this.tasks.length) {
      // 找到所有可执行的任务（依赖已完成且未执行）
      const ready = this.tasks.filter(
        (t) =>
          !executed.has(t.id) &&
          t.status !== 'skipped' &&
          t.dependsOn.every((depId) => {
            const dep = this.tasks.find((x) => x.id === depId);
            return dep && (dep.status === 'completed' || dep.status === 'skipped');
          }),
      );

      if (ready.length === 0) {
        // 检查是否有死锁（所有剩余任务都在等待未完成的依赖）
        const remaining = this.tasks.filter((t) => !executed.has(t.id) && t.status !== 'skipped');
        if (remaining.length > 0) {
          this.emit('log', `警告：${remaining.length} 个任务因依赖问题无法执行，跳过`);
          for (const t of remaining) {
            t.status = 'skipped';
            executed.add(t.id);
          }
        }
        break;
      }

      // 并行执行一批
      const batch = ready.slice(0, maxParallel);
      this.emit('log', `并行执行 ${batch.length} 个任务`);
      await Promise.all(batch.map((t) => this.executeTask(t)));
      batch.forEach((t) => executed.add(t.id));
    }
  }

  /**
   * 执行单个任务（含验证和自我修正）
   */
  private async executeTask(task: SoloTask): Promise<void> {
    task.status = 'in-progress';
    task.startedAt = new Date().toISOString();
    this.emit('task-start', `开始任务: ${task.title}`, { taskId: task.id });

    try {
      while (task.retries <= task.maxRetries) {
        // 执行子任务
        const result = await this.executor(task.description || task.title, task.id);

        if (result.ok) {
          task.touchedFiles = result.touchedFiles;
          task.output = result.output;

          // 验证
          if (!this.config.verifyOnly) {
            task.status = 'verifying';
            this.emit('verify-start', `验证任务: ${task.title}`, { taskId: task.id });

            // 构造 SweSubTask 用于验证
            const sweTask = {
              id: task.id,
              title: task.title,
              description: task.description,
              targetFiles: task.touchedFiles,
              acceptance: task.description,
              dependsOn: task.dependsOn,
              complexity: 3,
            };
            const verifyResult = await verifyTask(this.repoSnapshot!, sweTask, this.config.cwd);
            task.verifyResult = verifyResult;

            if (verifyResult.overall === 'pass') {
              task.status = 'completed';
              task.completedAt = new Date().toISOString();
              task.durationMs = Date.now() - new Date(task.startedAt).getTime();
              this.emit('task-complete', `任务完成: ${task.title}`, {
                taskId: task.id,
                durationMs: task.durationMs,
              });
              return;
            } else if (this.config.autoCorrect && task.retries < task.maxRetries) {
              // 自我修正
              task.retries++;
              task.status = 'retrying';
              this.emit('task-retry', `验证失败，自我修正 (第 ${task.retries} 次): ${task.title}`, {
                taskId: task.id,
                error: verifyResult.errorSummary,
              });
              continue;
            } else {
              // 验证失败且不重试
              task.status = 'failed';
              task.error = verifyResult.errorSummary || '验证失败';
              this.emit('task-fail', `任务验证失败: ${task.title}`, {
                taskId: task.id,
                error: verifyResult.errorSummary,
              });
              return;
            }
          } else {
            // verifyOnly 模式，不验证
            task.status = 'completed';
            task.completedAt = new Date().toISOString();
            this.emit('task-complete', `任务完成 (跳过验证): ${task.title}`, { taskId: task.id });
            return;
          }
        } else {
          // 执行失败
          if (task.retries < task.maxRetries) {
            task.retries++;
            task.status = 'retrying';
            this.emit('task-retry', `执行失败，重试 (第 ${task.retries} 次): ${task.title}`, {
              taskId: task.id,
              error: result.output,
            });
            continue;
          } else {
            task.status = 'failed';
            task.error = result.output || '执行失败';
            this.emit('task-fail', `任务执行失败: ${task.title}`, { taskId: task.id });
            return;
          }
        }
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      this.emit('task-fail', `任务异常: ${task.title} - ${task.error}`, { taskId: task.id });
    }
  }

  /**
   * 设置当前阶段
   */
  private setPhase(phase: SoloPhase): void {
    this.phase = phase;
    this.emit('phase-change', `阶段切换: ${phase}`, { phase });
  }

  /**
   * 发射事件
   */
  private emit(type: SoloEventType, message: string, data?: Record<string, unknown>): void {
    const event: SoloEvent = {
      type,
      timestamp: new Date().toISOString(),
      phase: this.phase,
      message,
      data,
    };
    this.events.push(event);
    logger.info(`[SOLO] ${type}: ${message}`);
  }

  /**
   * 获取当前状态（用于轮询）
   */
  getStatus(): {
    phase: SoloPhase;
    tasks: SoloTask[];
    events: SoloEvent[];
    progress: number;
  } {
    const total = this.tasks.length || 1;
    const completed = this.tasks.filter((t) => t.status === 'completed' || t.status === 'failed' || t.status === 'skipped').length;
    return {
      phase: this.phase,
      tasks: this.tasks,
      events: this.events.slice(-100), // 最近 100 条
      progress: Math.round((completed / total) * 100),
    };
  }

  /**
   * 生成执行报告
   */
  private generateReport(overall: 'success' | 'partial' | 'failed'): SoloReport {
    const completedAt = new Date();
    const durationMs = this.startedAt ? completedAt.getTime() - this.startedAt.getTime() : 0;
    const completed = this.tasks.filter((t) => t.status === 'completed').length;
    const failed = this.tasks.filter((t) => t.status === 'failed').length;
    const skipped = this.tasks.filter((t) => t.status === 'skipped').length;

    const summary = [
      `目标: ${this.config.goal}`,
      `总任务: ${this.tasks.length}`,
      `完成: ${completed}`,
      `失败: ${failed}`,
      `跳过: ${skipped}`,
      `耗时: ${(durationMs / 1000).toFixed(1)}s`,
      `结果: ${overall === 'success' ? '全部成功' : overall === 'partial' ? '部分成功' : '执行失败'}`,
    ].join('\n');

    return {
      goal: this.config.goal,
      cwd: this.config.cwd,
      overall,
      phase: overall === 'failed' ? 'failed' : 'completed',
      startedAt: this.startedAt?.toISOString() || new Date().toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      totalTasks: this.tasks.length,
      completedTasks: completed,
      failedTasks: failed,
      skippedTasks: skipped,
      tasks: this.tasks,
      repoSummary: this.repoSnapshot ? `${this.repoSnapshot.files.length} 个文件` : undefined,
      planSummary: this.plan?.modelPrompt?.slice(0, 200),
      summary,
      events: this.events,
    };
  }
}

/**
 * 便捷函数：创建并运行 SOLO 代理
 */
export async function runSoloAgent(
  config: SoloConfig,
  executor: SubTaskExecutor,
): Promise<SoloReport> {
  const agent = new SoloAgent(config, executor);
  return agent.run();
}

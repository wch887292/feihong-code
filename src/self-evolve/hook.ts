import { SelfEvolveManager } from './manager';

/**
 * Hook: 任务完成后自动检查是否需要记录失败
 * 集成到工具调用流程中
 */
export class SelfEvolveHook {
  private manager: SelfEvolveManager;

  constructor() {
    this.manager = new SelfEvolveManager();
    this.manager.init();
  }

  /**
   * 在工具调用失败时触发
   */
  onToolFailure(context: { 
    tool: string, 
    input: any, 
    error: Error | string,
    attemptedSolutions?: string[]
  }) {
    const { tool, input, error, attemptedSolutions } = context;
    
    console.log(`[自我迭代] 检测到工具 ${tool} 调用失败`);
    
    const failure = this.manager.recordFailure(
      `${tool}: ${JSON.stringify(input).slice(0, 100)}`,
      error,
      attemptedSolutions || []
    );

    // 尝试查找已知解决方案
    const solutions = this.manager.searchSolution(failure.error_type, failure.error_message);
    
    if (solutions.length > 0) {
      console.log(`[自我迭代] 找到已知解决方案: ${solutions[0].name}`);
      // 这里可以自动应用解决方案
    } else {
      console.log(`[自我迭代] 新问题，建议创建技能解决`);
    }

    return failure;
  }

  /**
   * 在任务完成时触发
   */
  onTaskComplete(context: {
    success: boolean,
    task: string,
    error?: Error | string
  }) {
    if (!context.success && context.error) {
      return this.onToolFailure({
        tool: 'task',
        input: { task: context.task },
        error: context.error
      });
    }
    return null;
  }

  /**
   * 每日自动复盘
   */
  async dailyReview() {
    const report = this.manager.generateDailyReport();
    
    if (report.pending > 0) {
      console.warn(`[自我迭代] 今日仍有 ${report.pending} 个未解决问题`);
    }
    
    return report;
  }
}

// 导出单例
export const selfEvolveHook = new SelfEvolveHook();

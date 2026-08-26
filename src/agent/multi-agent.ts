/**
 * 飞虹 Code - 多智能体协同框架 (阶段二-1)
 *
 * 实现多角色 Agent 协同工作：
 * - 架构师 (Architect)：负责系统设计、技术选型、接口定义
 * - 开发者 (Developer)：负责代码实现、单元测试
 * - 测试工程师 (Tester)：负责测试用例设计、集成测试、Bug 发现
 * - 评审员 (Reviewer)：负责代码审查、质量把控、最佳实践建议
 *
 * 工作流程：
 * 1. 架构师分析需求，输出设计方案和接口定义
 * 2. 开发者根据设计方案实现代码
 * 3. 测试工程师根据设计方案编写测试用例并执行
 * 4. 评审员审查代码和测试，给出改进建议
 * 5. 开发者根据评审意见修正代码
 * 6. 循环直到所有角色都确认通过
 */
import { logger } from '../shared/logger';
import type { ModelRouter } from '../models/model-router';
import type { ChatMessage } from '../models/model.interface';

/** Agent 角色类型 */
export type AgentRole = 'architect' | 'developer' | 'tester' | 'reviewer';

/** Agent 角色配置 */
export interface AgentRoleConfig {
  role: AgentRole;
  name: string;
  description: string;
  systemPrompt: string;
  /** 该角色的专长标签，用于能力路由 */
  capabilities: string[];
  /** 最大迭代次数 */
  maxIterations: number;
  /** 温度 */
  temperature: number;
}

/** 预定义的角色配置 */
export const AGENT_ROLES: Record<AgentRole, AgentRoleConfig> = {
  architect: {
    role: 'architect',
    name: '架构师',
    description: '负责系统设计、技术选型、接口定义',
    systemPrompt: `你是一位资深软件架构师。你的职责是：
1. 分析需求，设计系统架构和模块划分
2. 定义接口规范和数据结构
3. 选择合适的技术栈和设计模式
4. 评估技术风险和性能瓶颈
5. 输出清晰的设计文档和接口定义

输出要求：
- 使用结构化格式输出设计方案
- 明确每个模块的职责和接口
- 给出关键代码的骨架实现
- 标注技术选型的理由`,
    capabilities: ['design', 'architecture', 'api-design', 'tech-selection'],
    maxIterations: 2,
    temperature: 0.7,
  },
  developer: {
    role: 'developer',
    name: '开发者',
    description: '负责代码实现、单元测试',
    systemPrompt: `你是一位资深全栈开发者。你的职责是：
1. 根据设计方案实现高质量代码
2. 编写单元测试，确保代码覆盖率
3. 遵循代码规范和最佳实践
4. 处理边界情况和错误处理
5. 优化代码性能和可读性

输出要求：
- 输出完整可运行的代码
- 包含必要的注释和文档
- 遵循项目的代码风格
- 优先使用项目已有的工具和库`,
    capabilities: ['coding', 'implementation', 'unit-test', 'debugging'],
    maxIterations: 3,
    temperature: 0.3,
  },
  tester: {
    role: 'tester',
    name: '测试工程师',
    description: '负责测试用例设计、集成测试、Bug 发现',
    systemPrompt: `你是一位资深测试工程师。你的职责是：
1. 根据需求和设计编写测试用例
2. 设计单元测试、集成测试、端到端测试
3. 发现潜在的 Bug 和边界情况
4. 评估代码质量和可测试性
5. 给出测试报告和改进建议

输出要求：
- 输出完整的测试用例代码
- 覆盖正常流程、边界情况、异常情况
- 明确每个测试的预期结果
- 给出测试覆盖率评估`,
    capabilities: ['testing', 'qa', 'test-design', 'bug-finding'],
    maxIterations: 2,
    temperature: 0.5,
  },
  reviewer: {
    role: 'reviewer',
    name: '评审员',
    description: '负责代码审查、质量把控、最佳实践建议',
    systemPrompt: `你是一位资深代码评审员。你的职责是：
1. 审查代码质量和规范性
2. 检查潜在的安全漏洞和性能问题
3. 评估代码的可维护性和可扩展性
4. 提出改进建议和最佳实践
5. 确认代码是否符合设计要求

输出要求：
- 按严重程度分类问题（严重/中等/轻微/建议）
- 给出具体的修改建议和代码示例
- 评估代码的整体质量评分
- 确认是否可以通过评审`,
    capabilities: ['review', 'quality', 'security', 'best-practices'],
    maxIterations: 2,
    temperature: 0.4,
  },
};

/** 单个 Agent 的输出 */
export interface AgentOutput {
  role: AgentRole;
  content: string;
  /** 结构化数据（如设计方案、测试用例等） */
  structured?: Record<string, unknown>;
  /** 评审结论：pass / needs-changes / reject */
  verdict?: 'pass' | 'needs-changes' | 'reject';
  /** 问题列表 */
  issues?: Array<{
    severity: 'critical' | 'major' | 'minor' | 'suggestion';
    description: string;
    suggestion?: string;
  }>;
  durationMs: number;
}

/** 多智能体协同配置 */
export interface MultiAgentConfig {
  /** 参与的角色（默认全部） */
  roles?: AgentRole[];
  /** 最大协同轮次（默认 3） */
  maxRounds?: number;
  /** 是否启用评审反馈循环（默认 true） */
  enableReviewLoop?: boolean;
  /** 每个角色的自定义配置覆盖 */
  roleOverrides?: Partial<Record<AgentRole, Partial<AgentRoleConfig>>>;
}

/** 多智能体协同结果 */
export interface MultiAgentResult {
  goal: string;
  rounds: number;
  outputs: AgentOutput[];
  /** 最终汇总 */
  summary: string;
  /** 整体质量评分（0-100） */
  qualityScore: number;
  /** 是否通过最终评审 */
  passed: boolean;
  durationMs: number;
}

/**
 * 多智能体协同编排器
 */
export class MultiAgentOrchestrator {
  private router: ModelRouter;
  private config: Required<MultiAgentConfig>;

  constructor(router: ModelRouter, config: MultiAgentConfig = {}) {
    this.router = router;
    this.config = {
      roles: config.roles || ['architect', 'developer', 'tester', 'reviewer'],
      maxRounds: config.maxRounds || 3,
      enableReviewLoop: config.enableReviewLoop !== false,
      roleOverrides: config.roleOverrides || {},
    };
  }

  /**
   * 运行多智能体协同
   */
  async run(goal: string, context?: string): Promise<MultiAgentResult> {
    const startTime = Date.now();
    const allOutputs: AgentOutput[] = [];
    let currentContext = context || '';
    let passed = false;
    let qualityScore = 0;

    logger.info('multi-agent start', { goal, roles: this.config.roles, maxRounds: this.config.maxRounds });

    for (let round = 1; round <= this.config.maxRounds; round++) {
      logger.info(`multi-agent round ${round}/${this.config.maxRounds}`);
      const roundOutputs: AgentOutput[] = [];

      // 按顺序执行各角色
      for (const role of this.config.roles) {
        const output = await this.runAgent(role, goal, currentContext, allOutputs);
        roundOutputs.push(output);
        allOutputs.push(output);

        // 更新上下文
        currentContext = this.buildContext(currentContext, output);

        // 如果是评审员且给出 reject，提前终止
        if (role === 'reviewer' && output.verdict === 'reject' && round < this.config.maxRounds) {
          logger.info('reviewer rejected, will retry in next round');
          break;
        }
      }

      // 检查是否通过最终评审
      const reviewerOutput = roundOutputs.find((o) => o.role === 'reviewer');
      if (reviewerOutput?.verdict === 'pass') {
        passed = true;
        qualityScore = this.calculateQualityScore(allOutputs);
        logger.info('multi-agent passed', { round, qualityScore });
        break;
      }

      // 如果不是最后一轮，准备反馈给下一轮
      if (round < this.config.maxRounds) {
        currentContext = this.buildFeedbackContext(currentContext, roundOutputs);
      }
    }

    // 如果没有通过评审，计算最终质量分
    if (!passed) {
      qualityScore = this.calculateQualityScore(allOutputs);
    }

    const durationMs = Date.now() - startTime;
    const summary = this.buildSummary(goal, allOutputs, passed, qualityScore);

    logger.info('multi-agent complete', {
      rounds: Math.min(allOutputs.length / this.config.roles.length, this.config.maxRounds),
      passed,
      qualityScore,
      durationMs,
    });

    return {
      goal,
      rounds: Math.ceil(allOutputs.length / this.config.roles.length),
      outputs: allOutputs,
      summary,
      qualityScore,
      passed,
      durationMs,
    };
  }

  /**
   * 运行单个 Agent
   */
  private async runAgent(
    role: AgentRole,
    goal: string,
    context: string,
    previousOutputs: AgentOutput[],
  ): Promise<AgentOutput> {
    const roleConfig = this.getRoleConfig(role);
    const startTime = Date.now();

    logger.info(`agent start: ${roleConfig.name}`, { role });

    // 构建消息
    const messages: ChatMessage[] = [
      { role: 'system', content: roleConfig.systemPrompt },
    ];

    // 添加历史输出作为上下文
    if (previousOutputs.length > 0) {
      const historyText = previousOutputs
        .slice(-6) // 最近6条
        .map((o) => `【${this.getRoleConfig(o.role).name}的输出】\n${o.content}`)
        .join('\n\n');
      messages.push({
        role: 'user',
        content: `之前的讨论记录：\n${historyText}\n\n请基于以上信息继续你的工作。`,
      });
    }

    // 添加当前任务
    const userPrompt = context
      ? `目标：${goal}\n\n当前上下文：\n${context}\n\n请输出你的工作成果。`
      : `目标：${goal}\n\n请输出你的工作成果。`;
    messages.push({ role: 'user', content: userPrompt });

    try {
      const resp = await this.router.chat(
        {
          messages,
          temperature: roleConfig.temperature,
          maxTokens: 2000,
          timeoutMs: 30000,
        },
        ['reasoning', 'code-gen'],
      );

      const content = resp.message.content || '';
      const output: AgentOutput = {
        role,
        content,
        durationMs: Date.now() - startTime,
      };

      // 解析评审员的结论
      if (role === 'reviewer') {
        output.verdict = this.parseReviewerVerdict(content);
        output.issues = this.parseReviewerIssues(content);
      }

      logger.info(`agent complete: ${roleConfig.name}`, {
        role,
        durationMs: output.durationMs,
        verdict: output.verdict,
      });

      return output;
    } catch (error) {
      logger.error(`agent failed: ${roleConfig.name}`, { error: String(error) });
      return {
        role,
        content: `执行失败：${error instanceof Error ? error.message : String(error)}`,
        verdict: role === 'reviewer' ? 'needs-changes' : undefined,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 获取角色配置（应用覆盖）
   */
  private getRoleConfig(role: AgentRole): AgentRoleConfig {
    const base = AGENT_ROLES[role];
    const override = this.config.roleOverrides[role] || {};
    return { ...base, ...override };
  }

  /**
   * 构建上下文
   */
  private buildContext(currentContext: string, output: AgentOutput): string {
    const roleName = this.getRoleConfig(output.role).name;
    const newContext = currentContext
      ? `${currentContext}\n\n【${roleName}的最新输出】\n${output.content}`
      : `【${roleName}的输出】\n${output.content}`;
    return newContext.slice(-4000); // 限制上下文长度
  }

  /**
   * 构建反馈上下文（评审未通过时）
   */
  private buildFeedbackContext(currentContext: string, roundOutputs: AgentOutput[]): string {
    const reviewerOutput = roundOutputs.find((o) => o.role === 'reviewer');
    if (!reviewerOutput || !reviewerOutput.issues?.length) return currentContext;

    const feedback = reviewerOutput.issues
      .map((issue, i) => `${i + 1}. [${issue.severity}] ${issue.description}${issue.suggestion ? `\n   建议：${issue.suggestion}` : ''}`)
      .join('\n');

    return `${currentContext}\n\n【评审反馈，请在下一轮修正以下问题】\n${feedback}`;
  }

  /**
   * 解析评审员结论
   */
  private parseReviewerVerdict(content: string): 'pass' | 'needs-changes' | 'reject' {
    const lower = content.toLowerCase();
    if (/通过|pass|approved|可以合并/.test(lower) && !/不通过|reject|拒绝/.test(lower)) {
      return 'pass';
    }
    if (/拒绝|reject|重大问题|必须修改/.test(lower)) {
      return 'reject';
    }
    return 'needs-changes';
  }

  /**
   * 解析评审员问题列表
   */
  private parseReviewerIssues(content: string): AgentOutput['issues'] {
    const issues: NonNullable<AgentOutput['issues']> = [];
    // 简单解析：匹配 [严重程度] 描述 格式
    const issueRegex = /\[(严重|critical|中等|major|轻微|minor|建议|suggestion)\]\s*(.+?)(?=\n\[|\n\d+\.|$)/gsi;
    let match;
    while ((match = issueRegex.exec(content)) !== null) {
      const severityMap: Record<string, 'critical' | 'major' | 'minor' | 'suggestion'> = {
        '严重': 'critical', 'critical': 'critical',
        '中等': 'major', 'major': 'major',
        '轻微': 'minor', 'minor': 'minor',
        '建议': 'suggestion', 'suggestion': 'suggestion',
      };
      issues.push({
        severity: severityMap[match[1].toLowerCase()] || 'suggestion',
        description: match[2].trim(),
      });
    }
    return issues;
  }

  /**
   * 计算质量评分
   */
  private calculateQualityScore(outputs: AgentOutput[]): number {
    let score = 70; // 基础分

    // 评审员通过加分
    const reviewerOutputs = outputs.filter((o) => o.role === 'reviewer');
    const lastReviewer = reviewerOutputs[reviewerOutputs.length - 1];
    if (lastReviewer?.verdict === 'pass') score += 20;
    else if (lastReviewer?.verdict === 'needs-changes') score += 5;

    // 问题数量减分
    const totalIssues = outputs.reduce((sum, o) => sum + (o.issues?.length || 0), 0);
    score -= Math.min(totalIssues * 2, 20);

    // 轮次越少分越高（效率）
    const rounds = Math.ceil(outputs.length / this.config.roles.length);
    if (rounds === 1) score += 10;
    else if (rounds === 2) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 构建最终汇总
   */
  private buildSummary(goal: string, outputs: AgentOutput[], passed: boolean, qualityScore: number): string {
    const roleSummaries = outputs
      .filter((_, i, arr) => {
        // 每个角色只取最后一次输出
        const role = arr[i].role;
        return arr.slice(i + 1).every((o) => o.role !== role);
      })
      .map((o) => {
        const roleName = this.getRoleConfig(o.role).name;
        const preview = o.content.slice(0, 200) + (o.content.length > 200 ? '...' : '');
        return `【${roleName}】\n${preview}`;
      })
      .join('\n\n');

    return `目标：${goal}\n\n最终结论：${passed ? '✅ 通过评审' : '⚠️ 未通过评审'}\n质量评分：${qualityScore}/100\n\n各角色最终输出：\n${roleSummaries}`;
  }
}

/**
 * 便捷函数：运行多智能体协同
 */
export async function runMultiAgent(
  router: ModelRouter,
  goal: string,
  config?: MultiAgentConfig,
  context?: string,
): Promise<MultiAgentResult> {
  const orchestrator = new MultiAgentOrchestrator(router, config);
  return orchestrator.run(goal, context);
}

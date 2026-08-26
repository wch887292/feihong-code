/**
 * 飞虹 Code - 自定义 Agent 框架 (阶段二-3)
 *
 * 允许用户通过 Prompt + 工具集定义自定义 Agent，成为可复用的团队资产。
 *
 * 自定义 Agent 包含：
 * - 名称和描述
 * - 系统 Prompt（定义角色和行为）
 * - 可用工具集（从工具注册表中选择）
 * - 模型配置（温度、最大 token 等）
 * - 触发条件（关键词、命令等）
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../shared/logger';
import type { ModelRouter } from '../models/model-router';
import type { ChatMessage } from '../models/model.interface';

/** 自定义 Agent 定义 */
export interface CustomAgentDefinition {
  id: string;
  name: string;
  description: string;
  /** 系统 Prompt */
  systemPrompt: string;
  /** 可用工具 ID 列表（空表示全部工具） */
  tools: string[];
  /** 模型配置 */
  modelConfig: {
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
  };
  /** 触发关键词（用户输入包含这些词时自动推荐此 Agent） */
  triggers: string[];
  /** 图标（emoji 或 URL） */
  icon: string;
  /** 分类（如 coding、review、testing、documentation） */
  category: string;
  /** 是否为内置 Agent（不可删除） */
  builtin: boolean;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 使用次数 */
  usageCount: number;
  /** 作者 */
  author?: string;
  /** 版本 */
  version: string;
}

/** 自定义 Agent 执行结果 */
export interface CustomAgentResult {
  agentId: string;
  agentName: string;
  input: string;
  output: string;
  /** 对话历史 */
  messages: ChatMessage[];
  /** 使用的工具 */
  toolsUsed: string[];
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  error?: string;
}

/** 内置 Agent 模板 */
export const BUILTIN_AGENTS: Omit<CustomAgentDefinition, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'builtin'>[] = [
  {
    name: '代码审查员',
    description: '专业代码审查，检查代码质量、安全漏洞、性能问题和最佳实践',
    systemPrompt: `你是一位资深代码审查员。请对提供的代码进行专业审查，包括：
1. 代码质量和规范性
2. 潜在的安全漏洞
3. 性能问题和优化建议
4. 可维护性和可扩展性
5. 最佳实践遵循情况

输出格式：
- 按严重程度分类（严重/中等/轻微/建议）
- 每个问题给出具体位置和修改建议
- 最后给出整体评分（0-100）和是否通过审查`,
    tools: ['read_file', 'search_code', 'run_command'],
    modelConfig: { temperature: 0.3, maxTokens: 2000, timeoutMs: 30000 },
    triggers: ['审查', 'review', '代码检查', 'code review'],
    icon: '🔍',
    category: 'review',
    enabled: true,
    author: '飞虹 Code',
    version: '1.0.0',
  },
  {
    name: '测试工程师',
    description: '自动生成测试用例，包括单元测试、集成测试和边界情况测试',
    systemPrompt: `你是一位资深测试工程师。请为提供的代码生成完整的测试用例，包括：
1. 正常流程测试
2. 边界情况测试
3. 异常情况测试
4. 性能测试（如适用）

输出要求：
- 使用项目已有的测试框架
- 每个测试用例包含清晰的描述
- 覆盖所有分支和异常路径
- 给出测试覆盖率评估`,
    tools: ['read_file', 'write_file', 'run_command'],
    modelConfig: { temperature: 0.5, maxTokens: 2000, timeoutMs: 30000 },
    triggers: ['测试', 'test', '单元测试', '单测', 'test case'],
    icon: '🧪',
    category: 'testing',
    enabled: true,
    author: '飞虹 Code',
    version: '1.0.0',
  },
  {
    name: '文档生成器',
    description: '自动生成代码文档、API 文档、README 和使用说明',
    systemPrompt: `你是一位技术文档专家。请为提供的代码生成清晰、完整的文档，包括：
1. 功能描述和用途
2. API 接口说明（参数、返回值、异常）
3. 使用示例
4. 注意事项和最佳实践

输出要求：
- 使用 Markdown 格式
- 语言简洁明了
- 包含可运行的代码示例
- 遵循项目的文档风格`,
    tools: ['read_file', 'write_file', 'search_code'],
    modelConfig: { temperature: 0.4, maxTokens: 2000, timeoutMs: 30000 },
    triggers: ['文档', 'document', 'README', 'api 文档', '注释'],
    icon: '📝',
    category: 'documentation',
    enabled: true,
    author: '飞虹 Code',
    version: '1.0.0',
  },
  {
    name: '重构专家',
    description: '代码重构专家，优化代码结构、消除重复、提升可维护性',
    systemPrompt: `你是一位资深重构专家。请对提供的代码进行重构优化，包括：
1. 消除重复代码（DRY 原则）
2. 优化函数和类的职责划分（单一职责原则）
3. 提升代码可读性和可维护性
4. 应用合适的设计模式
5. 优化性能（如适用）

输出要求：
- 给出重构前后的对比
- 解释每个重构的原因和好处
- 确保重构后的代码功能不变
- 遵循项目的代码风格`,
    tools: ['read_file', 'write_file', 'search_code', 'run_command'],
    modelConfig: { temperature: 0.3, maxTokens: 2000, timeoutMs: 30000 },
    triggers: ['重构', 'refactor', '优化代码', '代码优化', 'clean code'],
    icon: '🔧',
    category: 'refactoring',
    enabled: true,
    author: '飞虹 Code',
    version: '1.0.0',
  },
  {
    name: 'Bug 猎手',
    description: '专业 Bug 分析和修复，定位问题根因并给出修复方案',
    systemPrompt: `你是一位资深 Bug 猎手。请分析提供的错误信息和代码，定位问题根因并给出修复方案：
1. 分析错误信息和堆栈跟踪
2. 定位问题代码的具体位置
3. 解释问题的根本原因
4. 给出完整的修复方案
5. 提供修复后的代码

输出要求：
- 清晰说明问题原因
- 给出可直接应用的修复代码
- 说明修复的影响范围
- 建议如何避免类似问题`,
    tools: ['read_file', 'search_code', 'run_command', 'write_file'],
    modelConfig: { temperature: 0.2, maxTokens: 2000, timeoutMs: 30000 },
    triggers: ['bug', '错误', 'error', '修复', 'fix', 'debug', '调试'],
    icon: '🐛',
    category: 'debugging',
    enabled: true,
    author: '飞虹 Code',
    version: '1.0.0',
  },
];

/**
 * 自定义 Agent 管理器
 */
export class CustomAgentManager {
  private agents: Map<string, CustomAgentDefinition> = new Map();
  private agentsDir: string;

  constructor(homeDir: string) {
    this.agentsDir = join(homeDir, 'custom-agents');
    if (!existsSync(this.agentsDir)) mkdirSync(this.agentsDir, { recursive: true });
    this.loadAgents();
    this.ensureBuiltinAgents();
  }

  /** 加载所有自定义 Agent */
  private loadAgents(): void {
    try {
      const files = readdirSync(this.agentsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const agent = JSON.parse(readFileSync(join(this.agentsDir, file), 'utf-8')) as CustomAgentDefinition;
          this.agents.set(agent.id, agent);
        } catch (e) {
          logger.warn('custom agent load failed', { file, error: String(e) });
        }
      }
      logger.info('custom agents loaded', { count: this.agents.size });
    } catch (e) {
      logger.error('custom agents directory load failed', { error: String(e) });
    }
  }

  /** 确保内置 Agent 存在 */
  private ensureBuiltinAgents(): void {
    for (const template of BUILTIN_AGENTS) {
      const existing = Array.from(this.agents.values()).find(
        (a) => a.name === template.name && a.builtin,
      );
      if (!existing) {
        const agent: CustomAgentDefinition = {
          ...template,
          id: `builtin-${template.name.toLowerCase().replace(/\s+/g, '-')}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          usageCount: 0,
          builtin: true,
        };
        this.agents.set(agent.id, agent);
        this.saveAgent(agent);
      }
    }
  }

  /** 保存 Agent 到文件 */
  private saveAgent(agent: CustomAgentDefinition): void {
    const filePath = join(this.agentsDir, `${agent.id}.json`);
    writeFileSync(filePath, JSON.stringify(agent, null, 2), 'utf-8');
  }

  /** 获取所有 Agent */
  getAllAgents(category?: string): CustomAgentDefinition[] {
    let agents = Array.from(this.agents.values()).filter((a) => a.enabled);
    if (category) agents = agents.filter((a) => a.category === category);
    return agents.sort((a, b) => b.usageCount - a.usageCount);
  }

  /** 获取单个 Agent */
  getAgent(id: string): CustomAgentDefinition | undefined {
    return this.agents.get(id);
  }

  /** 根据输入匹配推荐 Agent */
  matchAgents(input: string, limit = 3): CustomAgentDefinition[] {
    const lower = input.toLowerCase();
    const matched = Array.from(this.agents.values())
      .filter((a) => a.enabled && a.triggers.some((t) => lower.includes(t.toLowerCase())))
      .sort((a, b) => b.usageCount - a.usageCount);
    return matched.slice(0, limit);
  }

  /** 创建自定义 Agent */
  createAgent(data: Omit<CustomAgentDefinition, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'builtin'>): CustomAgentDefinition {
    const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agent: CustomAgentDefinition = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      builtin: false,
    };
    this.agents.set(id, agent);
    this.saveAgent(agent);
    logger.info('custom agent created', { id, name: agent.name });
    return agent;
  }

  /** 更新自定义 Agent */
  updateAgent(id: string, updates: Partial<CustomAgentDefinition>): CustomAgentDefinition | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    if (agent.builtin && updates.builtin !== undefined) {
      // 内置 Agent 不允许修改 builtin 状态
      delete updates.builtin;
    }
    Object.assign(agent, updates, { updatedAt: new Date().toISOString() });
    this.saveAgent(agent);
    logger.info('custom agent updated', { id, name: agent.name });
    return agent;
  }

  /** 删除自定义 Agent */
  deleteAgent(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    if (agent.builtin) {
      logger.warn('cannot delete builtin agent', { id });
      return false;
    }
    this.agents.delete(id);
    const filePath = join(this.agentsDir, `${id}.json`);
    try {
      const { unlinkSync } = require('fs');
      unlinkSync(filePath);
    } catch {
      // 文件不存在忽略
    }
    logger.info('custom agent deleted', { id, name: agent.name });
    return true;
  }

  /** 执行自定义 Agent */
  async executeAgent(
    id: string,
    input: string,
    router: ModelRouter,
    context?: string,
  ): Promise<CustomAgentResult> {
    const agent = this.agents.get(id);
    if (!agent) {
      return {
        agentId: id,
        agentName: '未知',
        input,
        output: '',
        messages: [],
        toolsUsed: [],
        durationMs: 0,
        success: false,
        error: 'Agent 不存在',
      };
    }

    const startTime = Date.now();
    const messages: ChatMessage[] = [
      { role: 'system', content: agent.systemPrompt },
    ];

    if (context) {
      messages.push({ role: 'user', content: `上下文信息：\n${context}\n\n用户请求：${input}` });
    } else {
      messages.push({ role: 'user', content: input });
    }

    try {
      const resp = await router.chat(
        {
          messages,
          temperature: agent.modelConfig.temperature,
          maxTokens: agent.modelConfig.maxTokens,
          timeoutMs: agent.modelConfig.timeoutMs,
        },
        ['reasoning', 'code-gen'],
      );

      const output = resp.message.content || '';
      messages.push({ role: 'assistant', content: output });

      // 更新使用次数
      agent.usageCount++;
      agent.updatedAt = new Date().toISOString();
      this.saveAgent(agent);

      return {
        agentId: id,
        agentName: agent.name,
        input,
        output,
        messages,
        toolsUsed: agent.tools,
        durationMs: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      return {
        agentId: id,
        agentName: agent.name,
        input,
        output: '',
        messages,
        toolsUsed: agent.tools,
        durationMs: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 获取 Agent 分类列表 */
  getCategories(): string[] {
    return Array.from(new Set(Array.from(this.agents.values()).map((a) => a.category))).sort();
  }

  /** 导出 Agent 为 JSON */
  exportAgent(id: string): string | null {
    const agent = this.agents.get(id);
    if (!agent) return null;
    return JSON.stringify(agent, null, 2);
  }

  /** 从 JSON 导入 Agent */
  importAgent(json: string): CustomAgentDefinition | null {
    try {
      const data = JSON.parse(json) as CustomAgentDefinition;
      // 重新生成 ID，避免冲突
      data.id = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      data.builtin = false;
      data.createdAt = new Date().toISOString();
      data.updatedAt = new Date().toISOString();
      data.usageCount = 0;
      this.agents.set(data.id, data);
      this.saveAgent(data);
      logger.info('custom agent imported', { id: data.id, name: data.name });
      return data;
    } catch (e) {
      logger.error('custom agent import failed', { error: String(e) });
      return null;
    }
  }
}

/**
 * 便捷函数：创建自定义 Agent 管理器
 */
export function createCustomAgentManager(homeDir: string): CustomAgentManager {
  return new CustomAgentManager(homeDir);
}

/**
 * 插件配置模块：读取配置、生成默认值、做开关校验。
 * 所有增强能力都是可选项，默认只开规划器（最小集成），其余按需开启。
 */
import type { TheoneEnhanceConfig } from './types.js';

const DEFAULT_CONFIG: TheoneEnhanceConfig = {
  enabled: false,
  planner: true,
  memory: false,
  orchestrator: false,
  mcpRouter: false,
  humanInLoop: true,
};

export interface ConfigSource {
  enabled?: boolean;
  planner?: boolean;
  memory?: boolean;
  orchestrator?: boolean;
  mcpRouter?: boolean;
  memoryDir?: string;
  humanInLoop?: boolean;
}

/** 合并用户配置与默认值，并做一致性校验 */
export function resolveConfig(source: ConfigSource = {}): TheoneEnhanceConfig {
  const merged: TheoneEnhanceConfig = { ...DEFAULT_CONFIG, ...source };

  // 一致性约束：
  //  - 编排依赖规划器
  //  - MCP 路由被编排或记忆使用时才需要，但独立开启也允许
  if (merged.orchestrator && !merged.planner) {
    throw new Error('[theone-enhance] orchestrator 依赖 planner，请同时启用 planner');
  }

  // 记忆若开启但没有提供实现，则由内核提供默认内存/文件存储
  if (merged.memory && !merged.memoryStore && !merged.memoryDir) {
    merged.memoryDir = '.theone-memory/';
  }

  return merged;
}

/** 判断增强大脑是否应接管该次请求 */
export function shouldEnhance(config: TheoneEnhanceConfig, input: string): boolean {
  if (!config.enabled) return false;
  // 极简需求不需要走增强大脑，保持原有轻量路径
  if (input.trim().length <= 8) return false;
  return config.planner || config.memory || config.orchestrator || config.mcpRouter;
}

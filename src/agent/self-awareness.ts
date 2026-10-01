/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Agent 自我认知（v8.6.0 P1 · T1）：tool-schema 自省。
 * 让 Agent 在启动时精确知道自己有哪些工具、各做什么，
 * 杜绝「Agent 不知道自己能干嘛」类失准自述（dots 实测最大坑）。
 *
 * 设计约束：
 * - 能力清单双来源：ToolRegistry（运行时真源，优先）> tool-schema.json（静态）
 * - 降级原则：任何来源失败一律不抛异常，留 warn 后回退基础 system prompt
 * - 向后兼容：SYSTEM_PROMPT 原样保留，orchestrator 可渐进切换
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../shared/logger';
import type { ToolRegistry } from '../tools/tool.registry';
import { SYSTEM_PROMPT } from './prompts';

/** tool-schema.json 最小结构契约（只取自省所需字段） */
export interface ToolSchemaFile {
  name: string;
  version?: string;
  description?: string;
  tools: Array<{ name: string; description?: string }>;
}

export interface SchemaLoadResult {
  ok: boolean;
  schema?: ToolSchemaFile;
  error?: string;
}

export interface CapabilityEntry {
  name: string;
  description: string;
}

export interface BuildPromptOptions {
  /** 运行时工具注册表（优先于 schema 文件） */
  registry?: ToolRegistry;
  /** schema 文件路径（默认包根 tool-schema.json） */
  schemaPath?: string;
  /** 显式关闭自我认知注入（回归开关） */
  disable?: boolean;
}

export interface BuildPromptResult {
  prompt: string;
  /** 自我认知是否注入成功 */
  introspected: boolean;
  source?: 'registry' | 'schema';
  error?: string;
}

const SECTION_HEADER =
  '自我认知（你的能力清单，回答"你能做什么"时必须与此一致，禁止编造不存在的工具）：';

/** 默认定位包根 tool-schema.json：src/agent 与 dist/agent 上溯两级均为包根 */
export function defaultSchemaPath(): string {
  return join(__dirname, '..', '..', 'tool-schema.json');
}

/** 加载并校验 tool-schema.json（永不抛异常） */
export function loadToolSchema(filePath?: string): SchemaLoadResult {
  const p = filePath ?? defaultSchemaPath();
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as ToolSchemaFile;
    if (!parsed || !Array.isArray(parsed.tools)) {
      const msg = 'tool-schema 结构无效：缺少 tools 数组';
      logger.warn('self-awareness: schema 校验失败', { path: p });
      return { ok: false, error: msg };
    }
    return { ok: true, schema: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('self-awareness: tool-schema 加载失败', { path: p, error: msg });
    return { ok: false, error: msg };
  }
}

/** 运行时来源：从 ToolRegistry 提取能力清单 */
export function capabilitiesFromRegistry(registry: ToolRegistry): CapabilityEntry[] {
  return registry.list().map((t) => ({ name: t.name, description: t.description }));
}

/** 静态来源：从 tool-schema.json 提取能力清单（过滤无名条目） */
export function capabilitiesFromSchema(schema: ToolSchemaFile): CapabilityEntry[] {
  return schema.tools
    .filter((t) => typeof t.name === 'string' && t.name.length > 0)
    .map((t) => ({
      name: t.name,
      description: typeof t.description === 'string' ? t.description : '',
    }));
}

/** 单行能力摘要：`- name：描述`，描述压平空白并截断 80 字符 */
export function formatCapabilityLine(entry: CapabilityEntry): string {
  const desc = entry.description.replace(/\s+/g, ' ').trim().slice(0, 80);
  return desc ? `- ${entry.name}：${desc}` : `- ${entry.name}`;
}

/** 构造注入 system prompt 的能力清单段落 */
export function buildCapabilitySection(entries: CapabilityEntry[]): string {
  const lines = entries.map(formatCapabilityLine).join('\n');
  return `能力清单（共 ${entries.length} 项）：\n${SECTION_HEADER}\n${lines}`;
}

/**
 * 构建含自我认知的 system prompt。
 * 失败路径（文件缺失/JSON 损坏/清单为空）一律返回基础 SYSTEM_PROMPT，不抛异常。
 */
export function buildSystemPrompt(options: BuildPromptOptions = {}): BuildPromptResult {
  if (options.disable) {
    return { prompt: SYSTEM_PROMPT, introspected: false };
  }
  try {
    let entries: CapabilityEntry[];
    let source: 'registry' | 'schema';
    if (options.registry) {
      entries = capabilitiesFromRegistry(options.registry);
      source = 'registry';
    } else {
      const loaded = loadToolSchema(options.schemaPath);
      if (!loaded.ok || !loaded.schema) {
        return { prompt: SYSTEM_PROMPT, introspected: false, error: loaded.error };
      }
      entries = capabilitiesFromSchema(loaded.schema);
      source = 'schema';
    }
    if (entries.length === 0) {
      return { prompt: SYSTEM_PROMPT, introspected: false, error: '能力清单为空' };
    }
    return { prompt: `${SYSTEM_PROMPT}\n\n${buildCapabilitySection(entries)}`, introspected: true, source };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('self-awareness: 能力注入失败，回退基础 prompt', { error: msg });
    return { prompt: SYSTEM_PROMPT, introspected: false, error: msg };
  }
}

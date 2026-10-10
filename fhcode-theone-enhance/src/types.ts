/**
 * @fhcode/theone-enhance — 顶层共享类型定义
 *
 * 这是 TheOne 增强插件与 fhcode 内核之间的统一契约。
 * 设计原则：
 *  - fhcode 原有执行引擎（文件/AST/编译/测试/沙箱）保持不动；
 *  - TheOne 增强层只负责任务规划、记忆、编排、路由；
 *  - 所有跨层数据结构在此处统一定义，避免两套系统各自维护类型导致漂移。
 */

/* ============================ 能力边界 ============================ */

/** fhcode 原生执行引擎暴露的最小能力面（插件只依赖它，不依赖 fhcode 内部实现） */
export interface FhcodeEngineCapabilities {
  readFile(path: string): Promise<FileContent>;
  writeFile(path: string, content: string): Promise<FileWriteResult>;
  patchFile(path: string, patch: FilePatch): Promise<FileWriteResult>;
  listTree(path: string, opts?: TreeOptions): Promise<TreeEntry[]>;
  astParse(path: string): Promise<AstResult>;
  runCommand(cmd: string, opts?: CommandOptions): Promise<CommandResult>;
  runBuild(opts?: BuildOptions): Promise<CommandResult>;
  runTests(opts?: TestOptions): Promise<TestResult>;
  git(opts: GitOptions): Promise<CommandResult>;
}

export interface FileContent {
  path: string;
  content: string;
  encoding: 'utf8' | 'buffer';
  stat?: { size: number; mtime: number };
}

export interface FileWriteResult {
  path: string;
  changed: boolean;
  bytesWritten: number;
}

/** 增量补丁，优先于整体覆写，减少破坏面 */
export interface FilePatch {
  path: string;
  edits: Array<{
    type: 'insert' | 'replace' | 'delete';
    /** 定位锚点，使用 fhcode 原生的匹配规则 */
    anchor: string;
    content?: string;
    occurrence?: number;
  }>;
}

export interface TreeOptions {
  depth?: number;
  ignore?: string[];
  includeDotfiles?: boolean;
}

export interface TreeEntry {
  path: string;
  type: 'file' | 'dir' | 'symlink';
  size?: number;
}

export interface AstResult {
  path: string;
  language: string;
  symbols: Array<{ name: string; kind: string; line: number; start: number; end: number }>;
  imports: string[];
  errors: string[];
}

export interface CommandOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** 沙箱权限由 fhcode 内核统一判定，插件只透传标识 */
  permissionHint?: 'read' | 'write' | 'exec' | 'network';
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface BuildOptions extends CommandOptions {
  target?: string;
}

export interface TestOptions extends CommandOptions {
  filter?: string;
  coverage?: boolean;
}

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: Array<{ name: string; message: string; location?: string }>;
}

export interface GitOptions extends CommandOptions {
  action: string;
  args: string[];
}

/* ============================ 任务状态机 ============================ */

/**
 * 统一任务状态（唯一权威来源）
 * fhcode 内核负责执行原子步骤，TheOne 编排层接管生命周期。
 */
export const TASK_STATUS = [
  'pending',
  'running',
  'paused',
  'success',
  'failed',
  'require_approval',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUS)[number];

export interface TaskState {
  /** 全局唯一任务 id */
  id: string;
  /** 中文人类可读标题 */
  title: string;
  status: TaskStatus;
  /** 阶段推进百分比 0-100 */
  progress: number;
  /** 子任务指针 */
  currentStep: number;
  totalSteps: number;
  createdAt: number;
  updatedAt: number;
  error?: TaskError;
  /** 需要人工确认时的挂起信息 */
  awaitingApproval?: ApprovalRequest;
}

export interface TaskError {
  code: string;
  message: string;
  stepId?: string;
  retryable: boolean;
  attempts: number;
}

export interface ApprovalRequest {
  id: string;
  reason: string;
  /** 高危操作（架构变更、批量删除、生产写入等） */
  risk: 'low' | 'medium' | 'high';
  context?: Record<string, unknown>;
  createdAt: number;
}

/* ============================ 子任务 ============================ */

/** 由规划器产出的、交给 fhcode 内核执行的原子步骤 */
export interface SubTask {
  id: string;
  /** 中文描述，透传给 fhcode，不做翻译 */
  title: string;
  /** 依赖的子任务 id（拓扑序） */
  dependsOn: string[];
  /** 对应的 fhcode 能力调用 */
  action: SubTaskAction;
  /** 验收标准：如何判定该步成功 */
  acceptance?: string;
  timeoutMs?: number;
}

export type SubTaskAction =
  | { kind: 'readFile'; path: string }
  | { kind: 'editFile'; patch: FilePatch }
  | { kind: 'writeFile'; path: string; content: string }
  | { kind: 'runCommand'; cmd: string; opts?: CommandOptions }
  | { kind: 'runBuild'; opts?: BuildOptions }
  | { kind: 'runTests'; opts?: TestOptions }
  | { kind: 'git'; opts: GitOptions }
  | { kind: 'callMcp'; server: string; tool: string; args: Record<string, unknown> };

/* ============================ 任务规划 ============================ */

/** 规划器输出：把一个中文大需求拆成可执行任务图 */
export interface TaskPlan {
  id: string;
  goal: string;
  steps: SubTask[];
  /** 校验点：全部 steps 完成后需满足的整体验收 */
  acceptanceCriteria: string[];
  /** 是否可暂停/恢复（默认 true） */
  resumable: boolean;
  /** 是否涉及高危操作需人工确认 */
  requiresApproval: boolean;
  createdAt: number;
}

/* ============================ 记忆 ============================ */

/** 记忆条目，供项目长期记忆与事实抽取 */
export interface MemoryEntry {
  id: string;
  /** 仓库 id，记忆按仓库隔离 */
  repoId: string;
  scope: 'global' | 'repo' | 'session';
  kind: 'decision' | 'lesson' | 'convention' | 'architecture' | 'bug' | 'note';
  /** 中文正文 */
  content: string;
  /** 向量检索用关键词/标签 */
  tags: string[];
  /** 关联文件路径 */
  files?: string[];
  createdAt: number;
  updatedAt: number;
  source?: string;
}

export interface MemoryQuery {
  repoId: string;
  scope?: MemoryEntry['scope'][];
  query: string;
  kinds?: MemoryEntry['kind'][];
  limit?: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

/** 记忆存储适配器接口（便于接入不同向量库/本地文件） */
export interface MemoryStore {
  save(entry: MemoryEntry): Promise<MemoryEntry>;
  search(q: MemoryQuery): Promise<MemorySearchResult[]>;
  get(repoId: string, id: string): Promise<MemoryEntry | null>;
  delete(repoId: string, id: string): Promise<void>;
}

/* ============================ 多Agent编排 ============================ */

/** fhcode 内部可拉起的子角色（底层全部复用 fhcode 沙箱执行） */
export const AGENT_ROLES = ['architect', 'coder', 'tester', 'reviewer'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface SubAgentSpec {
  id: string;
  role: AgentRole;
  /** 中文角色说明 */
  brief: string;
  /** 可调用的能力（默认全部） */
  allowedActions?: SubTaskAction['kind'][];
  /** 是否可执行写操作 */
  canWrite?: boolean;
}

export interface OrchestratorContext {
  plan: TaskPlan;
  memory: MemoryStore;
  engine: FhcodeEngineCapabilities;
  /** 审批回调：编排层需要人工确认时触发 */
  requestApproval?: (req: ApprovalRequest) => Promise<boolean>;
}

/* ============================ MCP 工具路由 ============================ */

/** 封装 fhcode 原生能力为可路由的 MCP 工具 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 权限分类，路由中心据此做统一校验 */
  permission: 'read' | 'write' | 'exec' | 'network';
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

export interface McpRouterOptions {
  tools: McpToolDefinition[];
  /** 文件路径白名单 */
  allowPaths: string[];
  /** 命令黑名单（正则） */
  blockCommands: RegExp[];
  /** 高危操作审批回调 */
  requestApproval?: (req: ApprovalRequest) => Promise<boolean>;
}

/* ============================ 插件配置 ============================ */

/** 插件开关与运行参数 */
export interface TheoneEnhanceConfig {
  /** 总开关：false 时插件完全旁路，fhcode 保持原有行为 */
  enabled: boolean;
  /** 是否启用任务规划器 */
  planner: boolean;
  /** 是否启用长期记忆 */
  memory: boolean;
  /** 是否启用多Agent编排 */
  orchestrator: boolean;
  /** 是否启用 MCP 工具路由 */
  mcpRouter: boolean;
  /** 记忆存储实现（未提供时用默认内存实现） */
  memoryStore?: MemoryStore;
  /** 模型客户端（规划/记忆抽取用；复用 fhcode 现有 LLM 链路） */
  llm?: LlmClient;
  /** 记忆持久化目录（默认：项目目录 .theone-memory/） */
  memoryDir?: string;
  /** 危险操作是否需要人工确认 */
  humanInLoop: boolean;
}

/** 极简 LLM 客户端抽象，复用 fhcode 现有调用链路，无需独立部署 TheOne 服务 */
export interface LlmClient {
  complete(opts: { prompt: string; system?: string; json?: boolean }): Promise<{ text: string; json?: unknown }>;
}

# 飞虹 Code 架构与 API

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

本文面向**开发者/集成者**，讲解分层、编排循环、模型路由、工具协议、事件日志与并行架构。

---

## 1. 分层（feature-first）

```
src/
├── cli/          入口(commands/run/index/repl/version)
├── shared/       config / errors / logger / types
├── agent/        orchestrator / planner / prompts / parallel-orchestrator / subagent
├── tools/        tool.interface / tool.registry / safe-path + file|shell|search|verify
├── models/       model-router / model.interface / model.dto / cost + providers
├── runtime/      event-log / session-store / worktree
└── skills/       plan / grill / goal
```

依赖方向：`cli → agent/tools/models/runtime → shared`，上层可依赖下层，下层不反向依赖。

---

## 2. 编排循环（ReAct）

`Orchestrator.run(goal)`：

```
1. planTask(goal) → 系统提示 + 用户目标 → 初始消息
2. loop (max 12 次):
   a. router.chat(messages, ['code-gen']) → ChatResponse
   b. 若 message.toolCalls 为空 → 视为完成，break
   c. 对每个 toolCall: toolRegistry.execute(...) → 回填 role=tool 消息
3. 返回 { ok, finalAnswer, iterations, costUsd, logFile }
```

- 每次模型调用写入事件日志（`model.response` / `tool.call` / `tool.result`）。
- 温度固定 `0`，`max_tokens=4096`，超时 `180s`（AbortController）。
- `maxIterations` 默认 12，可在构造 `OrchestratorDeps` 时覆盖。

---

## 3. 模型路由

`ModelRouter`：

- `rank(tags?)`：按 tags 过滤（全不命中则退回全量），按 `score()` 排序。
- `score()`：`cost`→`-costPer1k`；`latency`→本地优先；`capability`→reasoning/code-gen 加权。
- `chat(req, tags?)`：依次调用 provider，**任一成功即返回**；全部失败抛最后错误（自动 fallback）。

### Provider 接口（ModelProvider）

```ts
interface ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly tags: CapabilityTag[];
  readonly costPer1k?: number;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
```

已实现：`OpenAICompatibleProvider`（DeepSeek/通义/Agnes/任意 OpenAI 协议）、`OllamaProvider`（本地）、`ScriptedMockProvider`（离线）。

---

## 4. 工具协议

### 契约

```ts
interface Tool {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;   // 给模型看的 JSON Schema
  schema: z.ZodTypeAny;                   // 运行时 zod 校验
  execute(args, ctx: ToolContext): Promise<ToolResult>;
}

interface ToolContext {
  runId: string;
  cwd: string;                            // 沙箱根
  security: { shellAllowlist: string[]; requireApproval: boolean };
  approve?: (action: string) => Promise<boolean>;
}

interface ToolResult { ok: boolean; output: string; error?: string; }
```

### 注册与执行

`ToolRegistry`：`register` / `get` / `definitions()`（→ 模型可见定义）/ `execute()`（zod 校验 + 错误归一）。

### 安全沙箱

`tools/safe-path.ts` 的 `safeJoin(base, target)`：解析绝对路径并校验未超出 `base`（防 `../` 穿越），越界抛 `SecurityError`。所有文件工具均经此校验。

### run_shell 执行

`tools/shell/exec.ts` 用 `spawn(cmd, { shell: true })`；白名单检查命令首词（`commandHead`），审批由 `ctx.approve` 回调决定（CLI 默认审批器：白名单命中自动通过，否则拒绝）。

---

## 5. 事件日志（单一可信源）

`runtime/event-log.ts`：`append-only` JSONL，每条 `{ ts, runId, type, ...payload }`。

事件类型：`session.start` / `session.end` / `model.request` / `model.response` / `tool.call` / `tool.result` / `plan` / `error`。

路径：`${FH_LOG_DIR}/${runId}.jsonl`（默认 `~/.feihong-code/sessions/`）。写入失败不影响主流程（仅告警）。

---

## 6. 并行架构（M2）

`agent/parallel-orchestrator.ts`：

```
runParallel(goal):
  1. decomposeGoal(goal) → SubTask[]
  2. 为每个 SubTask: createWorktree(repoRoot, id) → { path, branch }
  3. Promise.allSettled( 每个 SubTask → runSubAgent({ worktree, goal, router, approve }) )
  4. finally: 逐个 removeWorktree（鲁棒清理）
```

### 子代理隔离

`agent/subagent.ts`：复用 `Orchestrator`，但 `cwd = worktree.path`，故工具沙箱天然将其限制在独立 worktree 内——**物理隔离**。

### worktree 清理鲁棒策略

`runtime/worktree.ts` 的 `removeWorktree` 应对 Windows 上"顺序移除多 worktree 会连带清掉 `.git/worktrees`"的已知缺陷，采用三段式：

1. `git worktree remove --force`（best-effort）
2. `rmSync` 强制删磁盘目录（防孤儿）
3. `git worktree prune`（清元数据残留）

子代理结果在清理前已收集，清理仅针对工作区本身。

---

## 7. 恢复与审计架构（M3）

### 7.1 会话检查点持久化

`runtime/session-persist.ts`：

```
saveCheckpoint(logDir, cp):  写 <runId>.session.json（含 messages / iterations / costUsd / touchedFiles / status）
loadCheckpoint(logDir, id):  精确或前缀匹配读取
listCheckpoints(logDir):     按 updatedAt 倒序列出
updateStatus(logDir, id, s): 标记 running / done / crashed
```

`Orchestrator.run(goal, resume?)` 在**每一轮迭代后**通过注入的 `persist` 回调落盘检查点（见 `cli/run.ts` 装配）。`ChatMessage` 完全可 JSON 序列化，因此检查点可直接重建对话。

### 7.2 断点续跑（resume）

```
resume <id>:
  1. loadCheckpoint → 校验存在且 status != done
  2. SessionStore.restore(cp) 重建会话（保留 runId / 对话历史）
  3. Orchestrator.run(cp.goal, { messages: cp.messages, iterations, costUsd, touchedFiles })
     - 跳过 planTask，直接以检查点对话作为起始上下文
     - 继续 ReAct 循环，直到产出最终答案
  4. 续跑过程仍写入同一 runId 的事件日志，审计连续
```

### 7.3 diff / rollback（会话作用域）

`runtime/git.ts` 仅对会话 `touchedFiles` 操作，绝不整仓回滚：

- `gitDiff(cwd, files?)`：已跟踪文件走 `git diff`；未跟踪文件走 `git diff --no-index /dev/null <file>` 展示新增内容。非 git 仓库安全退出并提示。
- `gitRollback(cwd, files, { yes })`：已跟踪文件 `git checkout --`；未跟踪文件删除。`--yes` 缺失或非 git 仓库时**拒绝执行**，避免误删。

### 7.4 交互式审批流

`cli/run.ts` 的审批解析优先级：

1. 显式传入 `opts.approve`（测试/REPL 注入）。
2. 真实模式 + TTY：交互式审批器 `interactiveApprover()`，逐条 `y/n` 确认高危操作。
3. 真实模式 + 非 TTY（CI/管道）：白名单审批器 `defaultApproverFor()`，命中 `FH_SHELL_ALLOW` 自动通过，其余拒绝留痕。
4. 离线模式：不注入审批（`requireApproval` 仍为真，但 `run_shell` 缺乏 approve 通道时按安全默认拒绝）。

`run_shell` 工具在 `tools/shell/run-shell.tool.ts` 中统一通过 `ctx.approve?.(action)` 发起审批，结果决定放行或拒绝。

---

## 8. 类型速查

- `ChatMessage`：`{ role, content, toolCalls?, toolCallId? }`
- `ToolCall`：`{ id, name, arguments }`
- `ChatResponse`：`{ message, usage, providerId, model, costUsd }`
- `RunResult`：`{ ok, finalAnswer, iterations, costUsd, logFile }`
- `AppError` 子类：`ConfigError` / `ModelError` / `ToolError` / `ApprovalRequiredError` / `SecurityError`

---

© 2026 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

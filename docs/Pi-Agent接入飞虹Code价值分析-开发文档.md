# Pi-Agent 接入飞虹Code（自有代码平台）价值分析 — 开发文档

> **文档定位**：立项决策文档。回答"飞虹Code 要不要接入 Pi-Agent、以什么方式接入、MVP 怎么落地"。
> **分析基线**：`H:\Muse Code复刻` v8.0.0 源码（代码实证，2026-09-05 核验）
> **结论速览**：Pi 的核心卖点（Agent 循环、工具调度、多模型统一层、事件审计）在当前代码库中**已有自研等价实现**；Pi 的真实增量价值集中在 **steer() 中途人工纠偏协议** 与 **事件流 Schema 标准** 两处。**推荐方案：不引入 Pi 运行时依赖，采用"特性移植"路线**；若坚持接入，只允许 SDK 嵌入模式且必须禁用 Pi 原生 bash/文件工具，权限全部落在飞虹Code 平台层。

---

## 0. 代码实证摘要（先看这个）

分析前对 `H:\Muse Code复刻` 全库做了源码核验，关键事实如下：

| # | 事实 | 证据位置 | 对结论的影响 |
|---|------|----------|--------------|
| 1 | 项目已自研 ReAct Agent 循环（含检查点续跑、自愈重试、上下文压缩、经验学习、RAG、符号索引、分层记忆、流式事件、AbortSignal 中断） | `src/agent/orchestrator.ts`（36KB） | Pi「复用成熟 Agent 循环」价值点**已被覆盖** |
| 2 | 项目已自研工具系统（read/write/edit/list/grep/run_shell/web/browser/MCP/技能加载/构建检查/测试运行），zod 校验 + 工具注册表 + 重复调用缓存 | `src/tools/` | Pi「4 个原子工具」价值点**已被覆盖且更完整** |
| 3 | 项目已有「沙箱（4 模式，含 Docker 容器）→ PreToolUse hook → RBAC 守卫」三层工具调用拦截链 | `src/tools/tool.registry.ts`、`src/tools/sandbox.ts`、`src/runtime/hooks.ts` | Pi 无沙箱、无权限体系，**Pi 原生 bash 是风险而非资产** |
| 4 | 项目已有 RBAC 策略引擎（角色-工具矩阵、危险命令黑名单、敏感路径黑名单、越界路径拦截、任务/租户成本上限） | `src/enterprise/policy.ts`、`src/enterprise/guard.ts`、`src/enterprise/tenant.ts`、`src/enterprise/quota.ts` | 「Pi 没有权限体系，由平台拦截」**已实现** |
| 5 | 项目已有 SHA-256 哈希链防篡改审计（脱敏、跨进程锁、`audit verify` 断点定位） | `src/enterprise/audit.ts` | 「会话日志企业可审计」**已被覆盖且更硬** |
| 6 | 项目已有多模型路由（多 provider、cost/capability/latency 策略选优、自动 fallback 轮换、成功率统计、成本预算） | `src/models/model-router.ts` | Pi「多模型统一层 pi-ai」价值点**已被覆盖** |
| 7 | 项目已有变更管理（暂存不落盘、unified diff、逐 hunk 接受/拒绝、冲突检测、原子提交+回滚） | `src/agent/change-manager.ts` | 「生成 diff 草稿、用户确认后合并」**已被覆盖** |
| 8 | 项目已有 Web 控制台（REST API + Bearer 鉴权 + 任务队列 + SSE 消息通道 + Monaco 在线编辑器） | `src/web/server.ts`（124KB）、`src/web/public/` | 「在线编辑器、任务管理」**已有雏形** |
| 9 | 项目已有 SWE Agent（仓库读取→规划→实现+验证+自愈）、事件驱动 Agent（cron/文件监听/webhook）、多智能体编排 | `src/agent/swe-agent.ts`、`src/agent/event-driven-agent.ts`、`src/agent/multi-agent.ts` | 完整 Agent 工程能力**已自研** |
| 10 | 全库搜索 `earendil / pi-agent / pi-ai / pi-tui`：**0 命中**，无任何 Pi 依赖 | 全库 Grep | 接入 Pi 属于**新增第三方运行时依赖**，非补空白 |

**结论**：`飞虹Code` 已自研了 Pi 内核 80% 的能力。本文档的价值判断必须以「增量 vs 重叠」为口径，而不是「从零补能力」。

---

## 1. 现状 vs Pi 能力映射表

| 能力维度 | 飞虹Code 现有实现（代码实证） | Pi 对应物 | 重叠度 |
|----------|------------------------------|-----------|--------|
| Agent 思考/工具循环 | `orchestrator.ts` ReAct 循环：模型→工具→结果→完成，检查点续跑 | `pi-agent-core` 会话状态 + 工具循环 | **高度重叠** |
| 流式输出 | `orchestrator.ts` `onEvent`（model.response / tool.call / tool.result / session.end）+ Web SSE | `pi-agent-core` 流式事件 | 高度重叠（事件命名不同） |
| 错误重试 | `self-heal.ts` 错误分类 + 反思重试（≤3 次）+ 模型级 fallback 轮换 | Pi 错误重试 | 高度重叠 |
| 人工纠偏 | `approve()` 审批回调 + `AbortSignal` 中断 + hooks 拦截；**无"运行中改目标"能力** | `steer()` 中途改目标 | **Pi 有增量** |
| 工具集 | read/write/edit/list/grep/run_shell/web/browser/MCP/技能/构建/测试（zod 校验+注册表） | read/write/edit/bash（4 原子工具） | 飞虹Code 覆盖 Pi 且更全；Pi 原生 bash **无沙箱** |
| 变更落地 | `change-manager.ts`：diff 草稿→hunk 级确认→原子提交+回滚 | 直接写磁盘 | 飞虹Code 更安全 |
| 多模型统一 | `model-router.ts`：策略选优 + fallback + 统计 + 预算 | `pi-ai` 多模型适配 | 高度重叠 |
| 权限体系 | RBAC 策略引擎 + 守卫 + 审批 + 成本上限（`enterprise/`） | **无** | 飞虹Code 独有 |
| 审计 | 哈希链防篡改审计 + 事件日志 + 会话检查点（`audit.ts` / `event-log.ts` / `session-persist.ts`） | 事件流（agent_start/tool_call/turn_end） | 飞虹Code 更硬；Pi 的事件 Schema 可参考 |
| 仓库上下文 | `repo-reader.ts` + `code-rag.ts` + `symbol-index.ts` + AGENTS.md 注入 | 无对应 | 飞虹Code 独有 |
| UI | 终端 TUI + Electron + Web 控制台（Monaco） | `pi-tui`（终端） | **不采用 pi-tui**（一致） |

---

## 2. 逐条核验用户预设的价值点

### 2.1 「复用 Pi 成熟 Agent 循环，不用从零手写」—— ⚠️ 部分成立

**实证**：`orchestrator.ts` 已实现等价的「思考→调用工具→读取代码→修改→执行→复盘」闭环，且额外具备：检查点续跑（`resume`）、自我修复（`self-heal`）、上下文压缩（`context-compactor`）、经验学习（`experience`）、代码图谱（`symbol-index`）、RAG（`code-rag`）、分层记忆（`layered-memory`）。

**修正判断**：飞虹Code **不是从零起步**，是已有完整内核。接入 Pi 意味着「放弃自研内核」或「双内核并存」，而不是「获得内核」。

**唯一真实增量**：Pi 的 `steer()` —— 任务运行中用户插话改目标、模型按新指令继续。当前飞虹Code 只有「审批 / 中断」，没有「运行中改目标」。这一项值得移植。

### 2.2 「把 Pi 的 4 个原子工具替换成飞虹Code 平台 API」—— ✅ 方向正确，但前提已成立

**实证**：飞虹Code 工具层**已经是平台化设计**：
- `read` 等价物：`read_file` / `list_dir` / `grep` / `repo-reader` / `code-rag`（仓库上下文+检索）
- `write/edit` 等价物：`write_file` / `edit_file`，且经 `stageChange` 回调进入 `change-manager`（diff 草稿，不直接落盘）
- `bash` 等价物：`run_shell`，已受 `sandbox.ts`（4 模式含 Docker 容器）+ 网络域名白名单 + `policy.ts` 危险命令黑名单 + 审批通道约束

**修正判断**：不需要「把 Pi 的工具替换成平台 API」——飞虹Code 的工具本来就是平台 API。**接入 Pi 时反而要禁用 Pi 原生 bash/文件工具**，否则等于把无沙箱后门装回平台。

### 2.3 「多模型统一层 pi-ai，直接对接自有模型网关」—— ❌ 重叠

**实证**：`model-router.ts` 已实现：多 provider 注入（OpenAI-compatible / Ollama，可扩展 DeepSeek/Kimi/GLM）、策略选优（cost/capability/latency）、自动轮换（400/401/403/404 立即换，429/5xx 退避重试）、成功率统计落盘、单任务/租户成本预算。

**修正判断**：该点零增量。若未来要接自有模型网关，在 `model-router.ts` 加一个 `OpenAICompatibleProvider` 配置即可，工作量远小于引入 pi-ai。

### 2.4 「会话日志全部落到飞虹Code，企业可审计」—— ❌ 重叠（且现有更强）

**实证**：`audit.ts` 是 SHA-256 哈希链（任何一条被改/删/插都会断链，`fhcode audit verify` 精确定位断点）、自动脱敏（key/token/secret/Bearer/JWT）、跨进程写锁、主备分片降级。`event-log.ts` + `session-persist.ts` 记录完整事件流与会话检查点。

**修正判断**：Pi 的事件流（agent_start/tool_call/turn_end）只是**日志 Schema 参考**，可用于统一飞虹Code 的事件命名，但审计能力本身已远超 Pi 设想。

### 2.5 「两种集成模式可选（SDK 嵌入 / RPC 桥接）」—— ✅ 真实增量

**实证**：当前飞虹Code 是单进程（CLI / Electron / Web 服务），**没有「Agent 内核作为可嵌入库 / 独立服务」的部署形态**。Pi 的两种集成模式描述本身有价值，但它描述的是**架构形态**，不是 Pi 专属能力——飞虹Code 现有内核同样可以按这两种形态服务化。

---

## 3. 「不要照搬」清单—— 与现状对照

| 用户约束 | 飞虹Code 现状 | 结论 |
|----------|---------------|------|
| ❌ 不用 pi-tui，Web UI 自研 | 已有 Web 控制台（Monaco 编辑器 + 任务面板） | ✅ 天然满足 |
| ❌ 不用原生 bash / 本地文件工具 | 工具已平台化（沙箱+审批+审计+变更暂存） | ✅ 天然满足；**接入 Pi 时需显式禁用 Pi 原生工具** |
| ❌ Pi 无权限体系，平台层拦截 | `guard.ts` 在 `ToolRegistry.execute()` 内、工具执行前完成「策略→审批→审计」，等价 `beforeToolCall` 钩子 | ✅ 已实现 |

**接入 Pi 时唯一需要新增的拦截点**：若引入 `pi-agent-core`，其内核自带工具循环会绕过 `ToolRegistry`。必须在 Pi 内核的 `beforeToolCall` 钩子上适配飞虹Code 的 `guard.check()` 与 `sandbox.check()`，**且直接禁用 Pi 内置的 bash/文件工具**。

---

## 4. 价值重估：Pi 对飞虹Code 的真实增量

**修正后的增量（按价值排序）：**

| 增量 | 价值 | 实现成本（特性移植路线） |
|------|------|--------------------------|
| ① `steer()` 中途人工纠偏协议：运行中改目标、模型按新指令继续 | 高——企业用户在长任务中改需求是高频场景 | 中——在 `orchestrator.run()` 循环内监听一个 `steer` 事件源，将新指令作为下轮 system/user 消息注入并重置部分上下文 |
| ② 事件流 Schema 标准化（agent_start / tool_call / turn_end） | 中——统一审计/前端消费的事件命名 | 低——在 `event-log.ts` 增加 Schema 版本映射 |
| ③ 多模型统一层设计参考（若未来接 DeepSeek/Kimi/GLM 网关） | 中——`model-router.ts` 已具备，仅作对照 | 低 |
| ④ 双内核 A/B 跑分（现有 `SWE-bench-Lite-300` 评测脚本可挂 Pi 对照） | 低-中——验证自研内核水平 | 中——需要 RPC 桥接 + 评测适配 |

**其余预设价值点（Agent 循环、工具、多模型、审计）为重叠项，不构成接入理由。**

---

## 5. 三方案对比与决策

### 方案 A：特性移植（推荐）
不引入 `@earendil-works/pi-agent-core` 依赖，从 Pi 的**设计**中吸收 `steer()` 协议与事件 Schema，在现有 `orchestrator.ts` 上实现。

- 优点：零第三方运行时依赖；安全边界（沙箱/RBAC/审计）不动；无双内核维护成本；内核继续由飞虹智完全掌控（与「自主可控、数据不出域」的产品定位一致）
- 缺点：需要自己实现 steer 语义（约 2-3 人日）；不能随 Pi 上游迭代

### 方案 B：SDK 嵌入 pi-agent-core 作内核替换
后端引入 `@earendil-works/pi-agent-core`，自定义工具对接飞虹Code 内部 HTTP 接口，前端消费流式事件。

- 优点：跟随上游 Agent 内核迭代；steer() 开箱即用
- 缺点：**放弃已通过 SWE-bench 验证的自研内核**，需迁移 RAG/记忆/自愈/成本控制/审计钩子到 Pi 内核（Pi 均不提供）；双循环并存期维护成本高；上游 npm 包稳定性/许可证/数据留存策略不可控；Pi 无权限体系，所有安全能力要在 Pi 的钩子上重做；**违背本项目「自研内核」的产品叙事**
- 适用：仅在自研内核出现不可修复的架构缺陷、或 Pi 内核出现碾压性能力时复议

### 方案 C：RPC 桥接作对照实验
Pi 独立进程运行，通过 RPC 与飞虹Code 通信，仅用于评测对照，不进入生产内核。

- 优点：低成本验证 Pi 真实水平；给「自研 vs Pi」提供数据
- 缺点：多一层运维；对生产无直接收益
- 定位：**可选的评测工具，不是产品集成**

### 决策矩阵

| 评估维度 | 方案 A 特性移植 | 方案 B SDK 嵌入 | 方案 C RPC 对照 |
|----------|----------------|-----------------|-----------------|
| 落地成本 | 低（2-3 人日） | 高（双内核+迁移+安全重做） | 中 |
| 安全可控 | 保持现状 | 需重做 | 隔离，安全 |
| 产品叙事一致性 | ✅ 自研内核 | ❌ 依赖第三方内核 | ✅ |
| 长期维护 | 自研承担 | 上游+自研双份 | 低 |
| 获取 steer() | 自研实现 | 开箱即用 | 不可用 |
| **推荐度** | **✅ 首选** | ❌ 不建议 | ⚪ 可选 |

---

## 6. MVP 落地范围（不依赖 Pi，直接用现有组件闭环）

用户提出的 5 步 MVP 闭环，用现有组件即可完整实现：

| MVP 步骤 | 现有组件（代码实证） | 待补工作量 |
|----------|----------------------|-----------|
| ① 用户在飞虹Code 输入需求 | Web 控制台输入 → 任务队列（`src/web/task-queue.ts`） | 基本为零（已有） |
| ② Agent 读取当前项目仓库上下文（限定用户有权限的文件） | `repo-reader` + `code-rag` + `symbol-index`；权限限定在 `guard.check` 内追加「仓库级 ACL」 | 中：当前 RBAC 是工具级，需加**仓库/路径级 ACL**（多租户仓库场景） |
| ③ 生成代码 diff 草稿，保存到平台，不直接提交主分支 | `change-manager.stageChange()` 已实现「暂存不落盘」；Web 变更面板数据 `toPanelData()` 已存在 | 低：把 `orchestrator` 的 `stageChange` 回调接上 Web 面板（`orchestrator.ts` 已预留该注入点） |
| ④ 返回修改预览，用户确认后才合并 | `ChangeManager.acceptFile/acceptHunk + commit()`（原子提交+回滚） | 低：Web 端确认按钮 → 调 commit API |
| ⑤ 完整调用日志留存 | `audit.ts`（哈希链）+ `event-log.ts`（事件流） | 低：补「runId 维度查询 API」 |

**MVP 总工作量估算：约 2-3 人周**（仓库级 ACL + Web 面板接线 + 确认/回滚 API + 日志查询），不涉及任何 Pi 集成。

---

## 7. 开发任务拆解清单（方案 A 落地）

### 阶段 1：内核服务化（Web 平台底座，1 周）
- [ ] P1.1 把 `Orchestrator` 从 CLI 装配中解耦，提供 `createAgentSession(config)` 工厂（注入 router/tools/guard/changeManager/eventLog）
- [ ] P1.2 Web 端新增 `POST /api/agent/sessions`（建会话）、`POST /api/agent/sessions/:id/run`（跑任务）、`GET /api/agent/sessions/:id/events`（SSE 事件流）
- [ ] P1.3 会话级 ACL：`guard.check` 增加仓库/路径维度校验（tenant → repo → path 三级）

### 阶段 2：变更闭环接线（0.5 周）
- [ ] P2.1 `orchestrator` 的 `stageChange` 回调 → 持久化到 `sqlite-store`
- [ ] P2.2 Web 变更面板：加载 `toPanelData()`、逐 hunk 接受/拒绝、提交（`commit()`）、回滚
- [ ] P2.3 变更提交动作写入 `audit.ts`（action=`change:commit`）

### 阶段 3：steer() 中途纠偏（2-3 人日）
- [ ] P3.1 定义 `SteerEvent`：`{ sessionId, message, focus? }`，经 SSE 上行通道（WebSocket/HTTP POST）注入 `orchestrator`
- [ ] P3.2 循环内监听：收到 steer 后，把新指令作为下轮 user 消息注入，重置错误计数与重复调用缓存，保留已确认的变更
- [ ] P3.3 审计记录 `agent.steer` 事件（含原始 prompt、注入时迭代数）

### 阶段 4：事件 Schema 统一 + 审计查询（0.5 周）
- [ ] P4.1 定义统一事件类型 `agent_start / tool_call / tool_result / steer / turn_end / session_end`
- [ ] P4.2 `event-log` 按 Schema 版本写入，兼容旧日志
- [ ] P4.3 新增 `GET /api/audit?runId=` 查询接口（哈希链校验后返回）

### 阶段 5（可选）：Pi 对照评测（0.5-1 周）
- [ ] P5.1 搭 Pi 独立进程 + RPC 桥（方案 C）
- [ ] P5.2 复用 `SWE-bench-Lite-300` 脚本跑 Pi vs 自研内核对照
- [ ] P5.3 输出对照报告，作为「是否值得换内核」的数据依据

---

## 8. 最小集成伪代码（方案 B 备用：pi-agent-core 对接飞虹Code 自定义工具）

> 仅当决策层最终选择方案 B 时参考。核心原则：**禁用 Pi 原生工具，全部工具走飞虹Code 平台 API，在 beforeToolCall 挂平台守卫。**

```ts
// backend/src/pi-bridge.ts —— SDK 嵌入模式（方案 B 备用）
import { createAgent, type Tool } from '@earendil-works/pi-agent-core';

// ① 自定义工具：全部走飞虹Code 内部 HTTP 接口，不碰本地磁盘
const readRepoFile: Tool = {
  name: 'read_repo_file',
  description: '读取仓库文件（经平台鉴权）',
  async run(args: { repo: string; path: string }, ctx) {
    // 平台侧校验：tenant → repo → path ACL，命中 denyPaths / 越界即拒绝
    const res = await fetch(`${FHCODE_API}/internal/repo/read`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.sessionToken}` },
      body: JSON.stringify(args),
    });
    if (res.status === 403) return { ok: false, error: '[平台拒绝] 无权访问该文件' };
    return res.json();
  },
};

const writeDiffDraft: Tool = {
  name: 'write_diff_draft',
  description: '生成变更 Diff 草稿（不直接写服务器磁盘）',
  async run(args: { repo: string; path: string; content: string }, ctx) {
    // 落到 change-manager 暂存，生成 PR/草稿，等用户确认
    return fetch(`${FHCODE_API}/internal/repo/stage-diff`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.sessionToken}` },
      body: JSON.stringify(args),
    }).then((r) => r.json());
  },
};

const runSandboxBuild: Tool = {
  name: 'run_sandbox_build',
  description: '在平台沙箱执行构建/测试（不执行任意 shell）',
  async run(args: { repo: string; command: string }, ctx) {
    return fetch(`${FHCODE_API}/internal/sandbox/exec`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.sessionToken}` },
      body: JSON.stringify(args),
    }).then((r) => r.json());
  },
};

// ② 创建 Pi 会话：禁用原生工具，只挂平台工具
const agent = createAgent({
  model: { gateway: 'https://llm-gateway.klai.top/v1', model: 'deepseek-v3' },
  tools: [readRepoFile, writeDiffDraft, runSandboxBuild], // 不注册 Pi 原生 read/write/edit/bash
  beforeToolCall: async (call, ctx) => {
    // ③ 平台守卫：RBAC 策略 → 审批 → 审计（复用 src/enterprise/guard.ts）
    const verdict = await enterpriseGuard.check(call.tool, call.args);
    if (!verdict.allowed) return { action: 'reject', reason: verdict.reason };
    return { action: 'proceed' };
  },
  // ④ steer：Pi 原生支持，任务中注入新指令
  onSteer: (steerMsg) => {
    audit.record({ action: 'agent.steer', resource: steerMsg, decision: 'info', ... });
  },
});

// ⑤ 事件流透传：Pi 事件 → 飞虹Code 审计/前端 SSE
agent.on('event', (ev) => {
  eventLog.append(ev.type, { runId, ...ev });
  sseChannel.broadcast(runId, ev);
});
```

**方案 B 安全红线（不可妥协）：**
1. 不注册 Pi 原生 `bash` / `write` / `edit` 工具（无沙箱、无审批、无审计）
2. `beforeToolCall` 必须复用 `enterpriseGuard.check()`（策略 deny 优先，审计失败=拒绝）
3. Pi 进程内禁止持有服务器文件系统句柄；文件 IO 只能经平台 API
4. 审计链（哈希链）与事件日志以平台为准，Pi 事件仅作入参

---

## 9. 风险与开放问题

| 风险/问题 | 说明 | 缓解 |
|-----------|------|------|
| 上游依赖风险 | `@earendil-works/pi-agent-core` 为第三方 npm 包：版本演进、许可证（需核验 MIT 之外的商用条款）、数据留存策略均不可控 | 方案 A 完全规避；方案 B 需法务核验 + 锁版本 + 源码审计 |
| 双内核维护 | 方案 B 下 Pi 循环与现有 orchestrator 并存，修复/能力需要双份 | 方案 A 规避；方案 B 需明确切换时间窗 |
| 安全边界映射 | Pi 无沙箱/权限/审计，接入必须在其工具层与钩子上全部重建 | 见第 8 节安全红线；接入前做一次安全评审 |
| 产品叙事冲突 | 项目定位「对标 Muse Code · 自研内核」；引入 Pi 作内核会动摇「自主可控」卖点（README/软著材料均强调自研） | 方案 A；如需宣传可注明「参考业界 Agent 协议」 |
| 仓库级 ACL 缺口 | 当前 RBAC 是工具级（角色×工具矩阵），无「仓库/路径级」授权；Web 平台多租户场景必须补 | MVP 阶段 P1.3 补上 |
| 平台化路径 | 目标态是「代码仓库+在线编辑器+任务管理」Web 平台；Pi 不提供仓库/PR 能力，平台化仍需自研 | 平台化与 Pi 无耦合，独立推进 |

---

## 10. 一句话结论

> **Pi 对飞虹Code 的真正价值是「设计参考」，不是「运行时依赖」**：Agent 循环、工具系统、多模型统一层、审计在现有自研内核中均已实现；唯一值得吸收的是 `steer()` 中途纠偏协议与事件流 Schema。**推荐按方案 A（特性移植）推进，MVP 直接用现有 orchestrator + change-manager + audit 组件闭环，预计 2-3 人周**；方案 B（SDK 嵌入）仅在自研内核出现不可修复缺陷时复议，且必须遵守第 8 节安全红线。

---

*文档版本：v1.0（2026-09-05）· 依据源码：H:\Muse Code复刻 v8.0.0 · 编制：飞虹智科技 · 飞扬企源研发中心*

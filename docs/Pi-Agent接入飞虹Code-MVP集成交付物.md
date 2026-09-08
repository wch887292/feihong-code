# Pi-Agent 接入飞虹Code — MVP 集成交付物

> **文档定位**：按「Pi-Agent 接入飞虹Code 价值分析」一文末尾要求，输出两份可扩展交付物：
> ① `pi-agent-core` 对接飞虹Code 自定义工具的最小集成伪代码示例；
> ② MVP 版本完整开发任务拆解清单。
>
> **基线声明**：本交付物以 `docs/Pi-Agent接入飞虹Code价值分析-开发文档.md`（v1.0，2026-09-05，源码实证）为事实基线。该文档核验结论：飞虹Code 现有自研内核已覆盖 Pi 约 80% 能力（Agent 循环、工具系统、沙箱/RBAC、哈希链审计、多模型路由、变更管理、Web 控制台）。因此：
> - 伪代码提供**方案 B（SDK 嵌入 pi-agent-core）**的完整最小实现，供决策层若选接入时使用，并附不可妥协的安全红线；
> - 任务拆解按**方案 A（特性移植，推荐）**落地，复用现有组件，仅补齐已验证的真实缺口（仓库级 ACL、Web 变更面板接线、steer()、事件 Schema、审计查询）。
>
> *编制：飞扬企源研发中心 · 2026-09-05*

---

## 交付物一：pi-agent-core 对接飞虹Code 自定义工具 · 最小集成伪代码

### 0. 使用前提与安全红线（先读）

本伪代码仅在决策层最终选择**方案 B（SDK 嵌入模式）**时使用。嵌入前必须满足：

| # | 红线 | 说明 |
|---|------|------|
| 1 | **不注册 Pi 原生工具** | 禁止注册 Pi 内置 `read/write/edit/bash`（无沙箱、无审批、无审计），全部替换为下方平台封装工具 |
| 2 | **beforeToolCall 挂平台守卫** | 必须复用 `src/enterprise/guard.ts` 的 RBAC 策略检查，deny 优先，审计失败=拒绝 |
| 3 | **Pi 进程禁止持有服务器文件系统句柄** | 文件 IO 只能经飞虹Code 内部 HTTP API；Pi 内核运行在受限进程/容器内 |
| 4 | **审计以平台为准** | 哈希链审计（`audit.ts`）与事件日志（`event-log.ts`）为唯一权威记录，Pi 事件流仅作入参 |
| 5 | **不采用 pi-tui** | Web 端交互 UI 全部由飞虹Code 自研（现有 Web 控制台 + Monaco） |
| 6 | **上游依赖核验** | 引入前完成：许可证商用条款核验、版本锁死、源码审计、数据留存策略确认 |

### 1. SDK 嵌入模式 · 完整最小实现

```ts
// ============================================================
// backend/src/pi-bridge.ts
// SDK 嵌入模式：后端引入 pi-agent-core，前端仅消费流式事件
// ============================================================

import { createAgent, defineTool } from '@earendil-works/pi-agent-core';
import { createModelAdapter } from 'pi-ai';
import { feihongApi } from './feihong-api-client';      // 飞虹Code 内部 HTTP 客户端
import { enterpriseGuard } from '../enterprise/guard';  // 复用平台 RBAC 守卫
import { audit, eventLog } from '../enterprise/audit';  // 复用平台审计/事件日志
import { sseChannel } from '../web/sse-channel';        // 复用平台 SSE 通道

// ------------------------------------------------------------
// ① pi-ai 多模型统一适配层：一套配置切换 DeepSeek / Kimi / GLM / 企业微调
// ------------------------------------------------------------
const model = createModelAdapter({
  provider: 'openai-compatible',            // 统一 OpenAI 兼容协议
  baseURL: process.env.LLM_GATEWAY,         // 例：https://llm-gateway.klai.top/v1
  apiKey: process.env.LLM_API_KEY,
  defaultModel: process.env.LLM_DEFAULT_MODEL, // 'deepseek-v3' | 'kimi-k2' | ...
  timeoutMs: 120_000,
  // Token 统计、调用限流、流式消息封装由 pi-ai 开箱提供
});

// ------------------------------------------------------------
// ② 自定义工具层：read / write / edit / bash 的能力映射，全部走平台 API
// ------------------------------------------------------------
const feihongReadFile = defineTool({
  name: 'feihong_read_file',
  description: '读取仓库文件或检索企业代码库（经平台鉴权与沙箱）',
  inputSchema: {
    repoId:   { type: 'string' },
    path:     { type: 'string' },
    ref:      { type: 'string', optional: true },   // 分支/commit，默认当前分支
    maxDepth: { type: 'number', optional: true },   // 目录展开深度
  },
  async run(args, ctx) {
    // 全部操作经飞虹Code 内部接口，服务器磁盘不可达
    const res = await feihongApi.repo.read({
      repoId: args.repoId, path: args.path, ref: args.ref,
      userId: ctx.userId,
    });
    if (res.status === 403) {
      return { ok: false, error: '[平台拒绝] 当前用户无权访问该仓库/路径' };
    }
    return { ok: true, content: res.content };
  },
});

const feihongSearchCode = defineTool({
  name: 'feihong_search_code',
  description: '企业代码库语义/符号检索（AST、符号索引、RAG）',
  inputSchema: {
    repoId: { type: 'string' },
    query:  { type: 'string' },
    topK:   { type: 'number', optional: true },
  },
  async run(args, ctx) {
    return feihongApi.repo.search({
      repoId: args.repoId, query: args.query, topK: args.topK ?? 20, userId: ctx.userId,
    });
  },
});

const feihongWriteDiff = defineTool({
  name: 'feihong_write_diff',
  description: '生成代码变更 Diff 草稿并保存到平台，不直接写磁盘/主分支',
  inputSchema: {
    repoId:    { type: 'string' },
    path:      { type: 'string' },
    newContent:{ type: 'string' },
  },
  async run(args, ctx) {
    // ① 读旧内容 → ② 计算 unified diff → ③ 落平台草稿（等人工确认）
    const old = await feihongApi.repo.read({ repoId: args.repoId, path: args.path, userId: ctx.userId });
    const diff = computeUnifiedDiff(old.content, args.newContent);
    const draft = await feihongApi.repo.stageDiff({
      repoId: args.repoId, path: args.path, diff, userId: ctx.userId,
    });
    // 绝不 writeFile 到服务器磁盘，绝不 merge 主分支
    return { ok: true, draftId: draft.id, diffPreview: diff };
  },
});

const feihongRunBuild = defineTool({
  name: 'feihong_run_build',
  description: '在平台沙箱执行构建/单元测试（限时、限额、禁任意 shell）',
  inputSchema: {
    repoId:     { type: 'string' },
    command:    { type: 'string' },           // 白名单命令：build / test 等
    timeoutSec: { type: 'number', optional: true },
  },
  async run(args, ctx) {
    return feihongApi.sandbox.exec({
      repoId: args.repoId,
      command: args.command,
      timeoutSec: Math.min(args.timeoutSec ?? 120, 300),  // 强制上限
      userId: ctx.userId,
    });
  },
});

// ------------------------------------------------------------
// ③ 创建 Agent 会话：禁用原生工具 + 平台鉴权钩子 + 全量事件审计
// ------------------------------------------------------------
export async function createPiSession(userId: string, repoId: string, repoContext: object) {
  const session = await createAgent({
    model,
    tools: [feihongReadFile, feihongSearchCode, feihongWriteDiff, feihongRunBuild],
    // ⚠️ 不注册 Pi 原生 read/write/edit/bash —— 安全红线 #1

    // beforeToolCall：等价于平台 ToolRegistry 前置拦截（安全红线 #2）
    beforeToolCall: async (call, ctx) => {
      const verdict = await enterpriseGuard.check(call.tool, call.args, {
        userId, repoId,           // 角色×工具矩阵 + 仓库/路径级 ACL + 配额
      });
      if (!verdict.allowed) {
        await audit.record({
          action: 'tool:deny', resource: call.tool, detail: call.args,
          decision: verdict.reason, userId, repoId,
        });
        return { action: 'reject', reason: verdict.reason };
      }
      await audit.record({
        action: 'tool:call', resource: call.tool, detail: call.args, userId, repoId,
      });
      return { action: 'proceed' };
    },

    // 全量事件下沉平台（安全红线 #4）
    onEvent: (ev) => {
      const normalized = normalizeEvent(ev);            // → agent_start/tool_call/tool_result/turn_end
      eventLog.append(session.id, normalized);          // 持久化（供审计查询）
      sseChannel.broadcast(session.id, normalized);     // 实时推给前端渲染
    },
  });

  await session.start({ prompt: '', repoContext });      // 注入仓库上下文（AGENTS.md/结构/索引）
  return session;
}

// ------------------------------------------------------------
// ④ HTTP 接入层（Fastify 示意）：前端只消费流式事件
// ------------------------------------------------------------
app.post('/api/agent/sessions', async (req, reply) => {
  const { userId, repoId } = req.auth;                  // 平台登录态
  const session = await createPiSession(userId, repoId, await buildRepoContext(repoId, userId));
  return reply.send({ sessionId: session.id });
});

app.post('/api/agent/sessions/:id/run', async (req, reply) => {
  const session = sessions.get(req.params.id);
  const run = session.run({ prompt: req.body.prompt });  // 返回流式句柄
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
  run.on('event', (ev) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`));
});

app.post('/api/agent/sessions/:id/steer', async (req, reply) => {
  // ⑤ 中途人工纠偏：Pi 内核原生能力，审计留痕
  const session = sessions.get(req.params.id);
  await audit.record({ action: 'agent.steer', resource: req.body.message, userId: req.auth.userId });
  await session.steer(req.body.message);
  return reply.send({ ok: true });
});
```

### 2. RPC 桥接模式骨架（后期架构演进用）

```ts
// pi-agent-worker/main.ts —— 独立进程部署，弹性扩容，与主服务解耦
import { createRpcServer } from './rpc';       // gRPC / JSON-RPC
import { createPiSession } from '../pi-bridge';

const server = createRpcServer({
  createSession:  (meta, req) => createPiSession(meta.userId, req.repoId, req.repoContext),
  run:            async (meta, req) => streamTo(meta.sessionId, req.prompt, meta.callbackUrl),
  steer:          async (meta, req) => sessions.get(meta.sessionId).steer(req.message),
  listEvents:     async (meta) => eventLog.query({ sessionId: meta.sessionId }),
});
server.listen(process.env.AGENT_WORKER_PORT ?? 5010);
```

> 两种模式选型：MVP 用 SDK 嵌入（Pi 内核不出浏览器、安全边界可控）；业务规模上涨后再演进为 RPC 独立微服务（独立扩容、与编辑器主业务解耦）。

### 3. 方案 A 对照实现：steer() 特性移植（推荐路径）

若按推荐方案 A（不引入 Pi 依赖），在现有 `orchestrator.ts` 循环内实现等价 steer 语义：

```ts
// src/agent/steer.ts —— 在 orchestrator.run() 循环内注入
import { steer$ } from '../web/steer-channel';   // SSE/WS 上行通道

// 每个循环迭代末尾执行一次非阻塞取指令
async function checkSteer(state: AgentState): Promise<void> {
  const steer = steer$.tryNext();                // 非阻塞，无指令返回 null
  if (!steer) return;

  // 新指令作为下轮 user 消息注入；重置错误计数与重复调用缓存；保留已确认变更
  state.messages.push({ role: 'user', content: steer.message, isSteer: true });
  state.errorCount = 0;
  state.toolCache.clear();
  audit.record({
    action: 'agent.steer',
    resource: steer.message,
    iteration: state.iteration,
    sessionId: state.sessionId,
  });
}
```

> 决策依据：现有 `orchestrator.ts` 已实现等价 Agent 循环、检查点续跑、自愈重试、上下文压缩、RAG、分层记忆；`model-router.ts` 已实现多模型路由与预算；`audit.ts` 为哈希链防篡改审计（强于 Pi 事件流）。方案 B 仅在其上多获得「随上游迭代」与「Pi 原生 steer()」，代价是放弃自研内核、双循环维护、安全能力在 Pi 钩子上重建。**MVP 推荐方案 A。**

---

## 交付物二：MVP 版本完整开发任务拆解清单

### 1. MVP 目标与范围

**产品目标**：用户在飞虹Code Web 工作台输入自然语言开发需求 → Agent 仅读取用户有权限的仓库上下文 → 生成代码 Diff 草稿（不直接合并主分支）→ 用户预览确认后合并 → 全链路可审计。

**范围边界（MVP 不做）**：
- ❌ 多智能体 / 子 Plan / 子 Agent
- ❌ pi-tui 终端 UI（Web UI 自研）
- ❌ Pi 原生 bash / 本地文件工具
- ❌ RPC 微服务部署（仅预留接口）
- ❌ 跨仓库全局代码库（先限单仓库+用户 ACL）

**前置基线**（已代码实证，无需重复开发）：Agent 循环 `orchestrator.ts`、工具系统 `src/tools/`、沙箱 `sandbox.ts`、RBAC `enterprise/policy.ts + guard.ts`、审计 `enterprise/audit.ts`、多模型路由 `model-router.ts`、变更管理 `change-manager.ts`、Web 控制台 `src/web/server.ts`。

### 2. 阶段拆解（含验收标准、依赖、工时）

> 人力假设：2 名后端 + 1 名前端并行；单位「人·日」。总计约 **15 人·日（核心 MVP）**，约 2-3 人周。

#### 阶段 P0：基线核验与接口契约（2 人·日）

| 编号 | 任务 | 验收标准 | 依赖 | 工时 |
|------|------|----------|------|------|
| P0.1 | 复跑源码核验清单：确认 orchestrator/tools/guard/audit/model-router/change-manager 现状与《开发文档》一致 | 核验表 10 项全部勾对；如有偏差更新基线文档 | — | 0.5 |
| P0.2 | 定义统一事件 Schema：`agent_start / tool_call / tool_result / steer / turn_end / session_end` | Schema 版本 v1 评审通过，字段含 sessionId/iteration/tool/args(脱敏)/usage | P0.1 | 0.5 |
| P0.3 | 定义飞虹Code 内部 API 契约：`repo/read`、`repo/search`、`repo/stage-diff`、`repo/commit-draft`、`sandbox/exec`、`audit/query` | OpenAPI 草稿评审通过；鉴权方式（服务间 token）明确 | P0.1 | 0.5 |
| P0.4 | 搭后端工程骨架：Web 服务独立模块 + 会话存储 schema 迁移 | 服务可启动，空会话可建可查 | — | 0.5 |

#### 阶段 P1：内核服务化（Web 平台底座，5 人·日）

| 编号 | 任务 | 验收标准 | 依赖 | 工时 |
|------|------|----------|------|------|
| P1.1 | `Orchestrator` 从 CLI 装配中解耦，提供 `createAgentSession(config)` 工厂（注入 router/tools/guard/changeManager/eventLog） | CLI 与 Web 均可用同一工厂创建会话；原 CLI 行为回归通过 | P0.4 | 1.5 |
| P1.2 | Web 新增 `POST /api/agent/sessions`、`POST /api/agent/sessions/:id/run`、`GET /api/agent/sessions/:id/events`（SSE） | 三接口联调通过：建会话→跑任务→SSE 收到完整事件序列（start→tool→result→turn_end） | P1.1 | 1.5 |
| P1.3 | 会话级 ACL：`guard.check` 增加仓库/路径维度（tenant → repo → path 三级） | 无权限用户读取目标文件返回 403；越界路径（`../`、绝对路径、denyPaths）全部拦截 | P0.3 | 1.5 |
| P1.4 | 会话持久化与断点续跑：sqlite-store 保存消息/工具结果/已确认变更 | 进程重启后会话可恢复、续跑结果与中断前一致 | P1.1 | 0.5 |

#### 阶段 P2：变更闭环接线（2.5 人·日）

| 编号 | 任务 | 验收标准 | 依赖 | 工时 |
|------|------|----------|------|------|
| P2.1 | `orchestrator` 的 `stageChange` 回调持久化到 sqlite（草稿表：repoId/path/diff/status） | Agent 修改文件后草稿落库，主分支无任何写入（git status 验证） | P1.1 | 1 |
| P2.2 | Web 变更面板：加载 `toPanelData()`、Diff 预览、逐 hunk 接受/拒绝、提交 `commit()`、回滚 | 面板可展示 diff；接受/拒绝/提交/回滚四操作走通；提交后主分支出现预期变更 | P2.1 | 1 |
| P2.3 | 变更提交动作写审计（`action=change:commit`，含 diff 哈希） | `fhcode audit verify` 通过；提交记录可查询 | P2.2 | 0.5 |

#### 阶段 P3：steer() 中途纠偏（2 人·日）

| 编号 | 任务 | 验收标准 | 依赖 | 工时 |
|------|------|----------|------|------|
| P3.1 | 定义 `SteerEvent`：`{ sessionId, message, focus? }`；SSE 上行通道（`POST /api/agent/sessions/:id/steer`） | 通道联调通过，指令可达运行中会话 | P1.2 | 0.5 |
| P3.2 | 循环内注入：新指令作为下轮 user 消息；重置错误计数与重复调用缓存；保留已确认变更 | 场景测试：任务运行中改需求，Agent 按新指令继续且未丢失已确认 hunk | P3.1 | 1 |
| P3.3 | 审计记录 `agent.steer`（含原始 prompt、注入时迭代数） | 审计查询可见完整 steer 轨迹 | P3.2 | 0.5 |

#### 阶段 P4：事件 Schema 统一 + 审计查询（2.5 人·日）

| 编号 | 任务 | 验收标准 | 依赖 | 工时 |
|------|------|----------|------|------|
| P4.1 | `event-log` 按 P0.2 Schema 写入，兼容旧日志（版本字段+迁移） | 新旧日志混读不报错；Schema 版本正确标记 | P0.2 | 1 |
| P4.2 | 新增 `GET /api/audit?runId=&type=&tool=` 查询接口（哈希链校验后返回） | 可查：原始 prompt、工具调用清单、访问文件清单、生成 diff、token 消耗；篡改记录被检出并报错 | P0.3 | 1 |
| P4.3 | Token 消耗统计与成本归因（按会话/用户/仓库汇总） | 报表口径与模型网关账单可对账（误差 <2%） | P4.2 | 0.5 |

#### 阶段 P5（可选）：Pi 对照评测 / 方案 B 预研（4 人·日）

| 编号 | 任务 | 验收标准 | 依赖 | 工时 |
|------|------|----------|------|------|
| P5.1 | 方案 C：Pi 独立进程 + RPC 桥（仅评测用，不进生产） | Pi 进程可跑通「建会话→跑任务→取事件」最小链路 | — | 2 |
| P5.2 | 复用 `SWE-bench-Lite-300` 评测脚本，跑 Pi vs 自研内核对照 | 产出对照报告（通过率/耗时/token 成本），作为内核选型数据依据 | P5.1 | 1 |
| P5.3 | 方案 B 预研：pi-agent-core 引入验证 + 安全红线实施清单（禁用原生工具、beforeToolCall 挂 guard、审计以平台为准） | 预研报告输出：可行性、许可证核验、双内核共存方案 | P5.2 | 1 |

### 3. 里程碑与排期

| 里程碑 | 内容 | 建议日期（相对） |
|--------|------|------------------|
| M1 | P0 契约冻结（事件 Schema + 内部 API） | 第 1 周末 |
| M2 | P1+P2 完成：Web 可建会话、跑任务、SSE 展示、Diff 预览确认合并 | 第 2 周末 |
| M3 | P3+P4 完成：steer() 可用、审计可查询 | 第 3 周末 |
| M4 | 全量回归 + 安全测试 + 灰度发布 | 第 4 周（视测试情况） |

### 4. 安全测试清单（上线前必过）

- [ ] 越权读取：无仓库权限用户 → 工具调用 403，审计留痕
- [ ] 路径穿越：`../`、绝对路径、符号链接 → 全部拦截
- [ ] 命令注入：工具参数含 `;`、`&&`、`|` 等 → 白名单外命令拒绝
- [ ] 沙箱逃逸：构建/测试超时、资源耗尽 → 强制终止 + 配额告警
- [ ] Prompt 注入：仓库文件内容诱导 Agent 执行危险操作 → 工具层黑名单最终兜底
- [ ] 审计篡改：改动审计记录 → `audit verify` 断链检出
- [ ] 并发与限流：同用户并发会话数、token 成本上限 → 平台配额生效

### 5. 风险与开放问题

| 风险 | 说明 | 缓解 |
|------|------|------|
| 方案 B 上游依赖 | pi-agent-core 版本演进/许可证/数据留存不可控 | 方案 A 规避；若选 B 需法务核验+锁版本+源码审计 |
| 双内核维护 | 方案 B 下 Pi 循环与现有 orchestrator 并存 | MVP 按方案 A；方案 B 仅预研不投产 |
| 仓库级 ACL 缺口 | 当前 RBAC 为工具级，无仓库/路径级 | P1.3 必做，纳入 M1 冻结 |
| Web 面板工作量 | diff 预览/hunk 确认交互复杂度 | 复用 `toPanelData()` 与现有变更面板数据格式 |
| 事件 Schema 兼容 | 旧日志格式迁移 | P4.1 版本字段+兼容读 |

### 6. 最终验收清单（M4 出口条件）

- [ ] 5 步 MVP 闭环端到端走通：输入需求 → 限权读上下文 → 生成 diff 草稿 → 预览确认 → 合并
- [ ] 全链路会话/工具调用/代码变更日志可审计查询（含 token 消耗）
- [ ] 安全测试清单 7 项全部通过
- [ ] 方案 A 实现下无任何 Pi 运行时依赖；方案 B 预研报告完成
- [ ] 文档更新：架构与 API、使用说明书、部署指南同步

---

*文档版本：v1.0（2026-09-05）· 关联文档：Pi-Agent接入飞虹Code价值分析-开发文档.md · 编制：飞扬企源研发中心*

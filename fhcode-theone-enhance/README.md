# @fhcode/theone-enhance — fhcode 内置 TheOne 增强引擎

> 目标：把 TheOne（the1os.io/os，国内团队全中文 AIOS）的能力，**内化成 fhcode 的原生可选增强模块**。
> 对外仍叫 fhcode，用户感知不到两套系统。fhcode 原有执行引擎（文件/AST/编译/测试/沙箱）**保持不动**。

## 设计定位

- **嵌入式**：核心逻辑以 TS 源码/产物直接挂进 fhcode，不做 HTTP 跨进程通信（避免延迟与稳定性问题）。
- **低侵入**：`enabled=false` 时插件完全旁路，fhcode 保持原有行为，向下兼容。
- **能力内化**：TheOne 的调度、记忆、多Agent、中文任务拆解，作为可选组件按需加载。

## 目录结构

```
fhcode-theone-enhance/
├─ package.json              # 插件包声明
├─ tsconfig.json             # 严格 TS 配置
└─ src/
   ├─ index.ts               # 插件唯一入口：createTheoneEnhance()
   ├─ types.ts               # ★ 顶层共享类型（fhcode 内核 ↔ TheOne 增强层的统一契约）
   ├─ config.ts              # 配置解析 + 开关一致性校验
   ├─ planner/planner.ts     # 任务规划器：中文大需求 → 有序子任务图
   ├─ memory/memory.ts       # 项目长期中文记忆（按仓库隔离，recall/absorb）
   ├─ orchestrator/orchestrator.ts  # 多子Agent编排（架构/编码/测试/评审，复用 fhcode 沙箱）
   └─ mcp-router/router.ts   # MCP 工具路由 + 统一权限校验 + 高危人工审批
```

## 四大能力模块

| 模块 | 解决的问题 | 提供的增强 |
|------|-----------|-----------|
| **planner** | 复杂需求一次性处理易断片 | 自动拆解大需求为带依赖的子任务，逐级校验、失败复盘 |
| **memory** | 会话上下文有限、重启丢历史 | 项目级长期记忆（决策/踩坑/约定），任务前检索、任务后抽取 |
| **orchestrator** | 单一 Agent 难以多角色协同 | fhcode 内部拉起架构/编码/测试/评审子角色，共享沙箱执行 |
| **mcp-router** | 工具调用权限不统一 | 原生能力封装 MCP 工具总线，白名单+黑名单+高危人工审批 |

## 如何挂载进 fhcode

fhcode 在收到用户需求后调用统一入口：

```ts
import { createTheoneEnhance } from '@fhcode/theone-enhance';

// fhcode 内核将自身能力暴露为 FhcodeEngineCapabilities
const enhance = createTheoneEnhance(engine, {
  enabled: true,      // 总开关
  planner: true,      // 开启任务规划
  memory: true,       // 开启长期记忆
  orchestrator: true, // 开启多Agent编排（依赖 planner）
  mcpRouter: true,    // 开启 MCP 工具路由
  humanInLoop: true,  // 高危操作需人工确认
}, {
  llm: fhcodeLlmClient, // 复用 fhcode 现有 LLM 链路，无需独立 TheOne 服务
});

// 统一入口：true 表示增强大脑接管本次请求
const handled = await enhance.handle(userChineseRequest, {
  repoId: currentRepoId,
  onProgress: (state) => log(state),
});
if (handled) return; // 增强模式已处理
// 否则走 fhcode 原有简易 LLM 路径（完全兼容旧行为）
```

## 关键安全边界

1. **沙箱权限唯一来源是 fhcode**：文件路径白名单、命令黑名单在此统一校验，TheOne 增强层只负责任务编排，**不新增独立权限判断**，避免两套规则冲突。
2. **高危操作强制人工审批**：`humanInLoop=true` 时，批量删除、架构变更、生产写入、`rm -rf` 类命令需用户确认。
3. **中文上下文透传**：中文 prompt 原样传给 fhcode，不做翻译，减少信息损耗。
4. **向下兼容**：原有调用方式/API/命令行参数不变，增强能力可选。

## 版本里程碑

- [x] **v0.1** — 插件骨架 + 完整类型定义（当前交付）
- [ ] v0.2 — 接入 fhcode 真实仓库，跑通规划→执行→记忆闭环
- [ ] v0.3 — 子Agent并发控制、审批 UI 接入
- [ ] v0.4 — 外部 MCP 服务接入、记忆导出导入

## 开发命令

```bash
npm install
npm run typecheck   # 类型检查（严格模式）
npm run build       # 编译到 dist/
npm test            # 单元测试
```

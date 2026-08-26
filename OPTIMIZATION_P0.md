# P0 优化落地记录（O1 / O2 / O3）

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 时间：2026-08-26 ｜ 基于《全面复盘与竞品对标分析_v7.2.0.md》的优化方案

## 一、本次交付

| 项 | 内容 | 关键文件 | 状态 |
|---|---|---|---|
| **O1 VS Code 扩展壳** | 薄壳扩展：行内补全（接 `/api/completion`）+ 侧边栏对话（接 `/api/tasks` 轮询）+ 选中即发 + 状态栏 | `vscode-extension/`（package.json / extension.js / api-client.js / README.md） | ✅ 可安装运行（纯 JS，免构建） |
| **O3 超长上下文路由** | token 估算 + 预算分配 + 相关性路由；并给 `context-compactor.ts` 加 token 感知压缩入口 | `src/agent/context-budget.ts`（新增）、`src/agent/context-compactor.ts`（增强） | ✅ 模块跑通（tsx 自测通过） |
| **O2 补全质量** | 补全后处理（去代码围栏 / 裁尾部半截行 / 去后缀重复 / 质量打分）+ 可量化评测脚本 | `src/agent/completion-postprocess.ts`（新增）、`scripts/eval-completion.ts`（新增） | ✅ 后处理跑通 + 离线评测 4/4 通过 |

## 二、为什么这么落地（重要约束）

探查发现**本工作区的 `src/` 与 `dist/` 不同步**：
- `dist/web/server.js` 含 `/api/completion`、`/api/completion/accept`、`suggest-next` 等路由；
- `src/web/server.ts`（已读全 1976 行）**不含**这些路由；
- `src/agent/` 也缺 `completion-engine / code-rag / repo-context / layered-memory`。

因此**不能**用 `npm run build`（tsc 全量重编译）来让 O2/O3 的新源码生效——`tsc` 会把 `src/web/server.ts` 覆盖回 `dist/web/server.js`，**导致补全路由丢失、产品被破坏**。

对策（已采用）：
- O1 扩展完全独立成包，不触碰主工程 `dist`。
- O2/O3 写成**独立、可独立验证的纯模块**，用 `tsx` 直接运行验证（不触发全量重编译）。
- 服务端串联（把后处理接进 `/api/completion` 路由、把 `compactContextByTokens` 接进 `orchestrator`）作为**集成点**留给"源码树对齐"之后再做（见第四节）。

## 三、验证方式（已执行）

```bash
# 托管 Node + tsx
export PATH="/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2:$PATH"
cd "H:/Muse Code复刻"

node_modules/.bin/tsx src/agent/context-budget.ts          # O3 路由自测
node_modules/.bin/tsx src/agent/completion-postprocess.ts  # O2 后处理自测
node_modules/.bin/tsx scripts/eval-completion.ts           # O2 量化评测（离线 4/4；有服务时出 before/after）
node --check vscode-extension/extension.js                 # O1 语法
```

在线评测（需先 `fhcode serve`）：
```bash
FHCODE_SERVER=http://localhost:8080 node_modules/.bin/tsx scripts/eval-completion.ts
```
会输出每个样例的 before/after 质量分、围栏剥离率、后缀去重率、平均延迟。

## 四、集成点（源码树对齐后执行）

1. **O2 接进补全路由**：在 `web/server.ts` 的 `POST /api/completion` 处理里，对 `complete()` 结果
   的每条 `suggestion.text` 调用 `postProcessCompletion(text, { suffix })`（suffix 可由 fileContent/cursorOffset 推出），再返回。
2. **O3 接进 orchestrator**：在 `agent/orchestrator.ts` 的上下文组装处，把
   `compactContext(messages)` 替换为 `compactContextByTokens(messages, focus, {maxTokens, recentRounds})`，
   `focus` 取当前目标或当前编辑文件路径。
3. **O1 接进后处理**：扩展端已内置 `postProcessCompletion`（客户端即时收益）；服务端就绪后可改为信任服务端结果。

## 五、前置建议（给负责人）

- **尽快对齐 `src/` 与 `dist/`**：当前 `dist/` 是从一份更完整的源码树编译而来，但那份源码未完全落到本工作区。
  补齐缺失源文件后，再统一 `npm run build`，否则任何全量编译都会"降级"产品。
- 补齐后即可把 O2/O3 的集成点一次性合入，并跑 `npm run verify` 全量回归。

## 六、下一步（P1 项，待启动）

- O4 SWE-bench 公开跑分（能力可量化）
- O5 Docker 沙箱隔离
- O6 官方连接器目录（复用已有 77+ 连接器生态）
- O7 截图转码泛化（design-to-code 多场景）

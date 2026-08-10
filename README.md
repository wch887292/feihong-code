# 飞虹 Code（fhcode）

> 终端 AI 编程智能体 · **Muse Code 参照复刻**
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

---

## 一、产品定位

**飞虹 Code（fhcode）** 是一款运行在终端的 AI 编程智能体，参照 Meta Muse Code 的设计理念：用自然语言描述需求，智能体自主完成**规划 → 读写代码 → 运行验证 → 汇报结果**的闭环。

- 不绑定任何单一大模型厂商，通过**多模型路由层**在 DeepSeek / 通义 / Ollama（本地）/ 任意 OpenAI 兼容网关之间按需调度。
- 所有行为以 **append-only 事件日志**为单一可信源，完全可审计、可恢复。
- 遵循**安全合规底线**：文件沙箱、shell 白名单、密钥脱敏、危险操作审批。
- **M2 多子代理并行**：用 `git worktree` 物理隔离多个子代理工作区，并发推进互不干扰。

---

## 二、核心特性

- ✅ **自然语言 → 代码闭环**：描述需求，自动调用工具完成改码与验证。
- ✅ **多模型路由**：cost / capability / latency 三种策略选优，失败时自动 fallback。
- ✅ **离线可跑**：未配置 `FH_PROVIDERS` 时自动进入脚本化 Mock 闭环，用于演示与回归（零成本）。
- ✅ **强工具系统**：文件读写改、代码搜索、受控 shell、测试/构建验证（共 8 个工具）。
- ✅ **多子代理并行（M2）**：`--parallel` 自动拆目标、建 worktree、并发执行、安全清理。
- ✅ **高级技能（M2）**：`/plan` 实现计划、`/grill` 红队审查、`/goal` 目标跟踪，均为只读。
- ✅ **完全可审计**：每次运行生成结构化事件日志（JSONL），含 `runId`。
- ✅ **安全优先**：路径沙箱、shell 白名单、密钥脱敏、审批拦截。

---

## 三、安装

### 方式一：从源码构建（推荐开发 / 内网部署）

```bash
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build              # 编译到 dist/
node dist/cli/index.js --version
```

或一行安装（已提供脚本）：

```bash
bash install.sh
```

### 方式二：全局安装（发布到 npm 后）

```bash
npm install -g feihong-code
fhcode --version           # 直接调用 bin（Windows 下为 fhcode.cmd）
```

> 要求 Node.js >= 18。入口 `dist/cli/index.js` 已带 `#!/usr/bin/env node` shebang。

### 方式三：Docker

```bash
docker build -t feihong-code .
docker run --rm feihong-code --version
# 挂载密钥与日志卷以启用真实模型：
docker run --rm -v "$PWD/.env:/app/.env" -v feihong-data:/data/feihong-code feihong-code "你的需求"
```

---

## 四、快速开始

### 4.1 离线模式（无需任何 API Key）

```bash
node dist/cli/index.js "帮我写一个 hello.ts 并打印一句话"
```

未配置 `FH_PROVIDERS` 时，自动用内置 Mock 驱动器跑通完整闭环（规划 → 调工具写文件 → 总结）。

### 4.2 接入真实大模型

```bash
cp .env.example .env
# 编辑 .env，填入 FH_PROVIDERS（baseURL / apiKey / model 等）
fhcode "把 src/utils 的日期格式化抽成独立模块并补测试"
```

真实配置示例（已验证可用的 Agnes 网关）：

```json
FH_PROVIDERS='[{"id":"agnes","type":"openai-compatible","baseURL":"https://api.agnes-ai.cn/v1","apiKey":"<你的key>","model":"agnes-2.5-flash","tags":["code-gen"],"costPer1k":0.001}]'
```

### 4.3 多子代理并行

```bash
fhcode --parallel "实现登录模块并且添加用户管理并且写集成测试"
```

自动拆成 3 个子任务，各自在 `git worktree` 隔离工作区并发执行，结束后清理。

> ⚠️ **真实并行的并发额度**：`--parallel` 会并发调用 API。免费套餐（如 Agnes free tier）对并发请求有严格限流（HTTP 429），可能导致子任务失败。建议：① 升级 API 套餐；② 或改用单命令模式顺序执行大目标；③ 或用 `FH_OFFLINE=true fhcode --parallel "..."` 验证并行机制（离线不耗额度）。

### 4.4 交互 REPL

```bash
fhcode            # 不带参数进入 REPL，逐条输入需求；exit 退出
```

### 4.5 只读技能（不修改代码）

```bash
fhcode /plan  "实现登录并且添加支付并且写报表"   # 生成实现计划
fhcode /grill src                              # 红队式代码审查
fhcode /goal  "搭建多子代理体系并且完善文档"      # 分解并保存目标
```

---

## 五、命令参考

| 命令 | 说明 |
| --- | --- |
| `fhcode` | 进入交互式 REPL（逐条需求） |
| `fhcode "<需求>"` | 单命令模式执行一条需求 |
| `fhcode --parallel "<需求>"` | 多子代理并行（git worktree 隔离） |
| `fhcode /plan "<目标>"` | 生成结构化实现计划（只读） |
| `fhcode /grill [路径]` | 红队式代码审查（只读，默认当前目录） |
| `fhcode /goal "<目标>"` | 分解并保存高层目标到 `~/.feihong-code/goals` |
| `fhcode --version` / `-v` | 显示版本与署名 |
| `fhcode --help` / `-h` | 显示帮助 |

> 未配置 `FH_PROVIDERS`（或 `FH_OFFLINE=true`）时自动离线模式。

---

## 六、工具系统

| 分类 | 工具 | 说明 |
| --- | --- | --- |
| 文件 | `read_file` / `write_file` / `edit_file` / `list_dir` | 沙箱内读写，防 `../` 穿越 |
| 搜索 | `grep` | 代码内容递归检索（忽略 node_modules/.git） |
| Shell | `run_shell` | 白名单 + 危险拦截 + 审批 |
| 验证 | `run_tests` / `build_check` | 运行测试套件 / 构建校验（默认 `npm test` / `npm run build`） |

所有工具入参经 **zod 校验**，错误归一为 `ToolError`；文件操作一律限制在 `cwd` 沙箱内。

---

## 七、安全模型

1. **路径沙箱**：`safeJoin` 校验每个文件路径不得超出 `cwd`，杜绝 `../` 越权。
2. **Shell 白名单**：`run_shell` 仅在命令首词命中 `FH_SHELL_ALLOW` 时放行；非交互 CLI 下，命中白名单者由默认审批器自动通过，其余拒绝并留痕。
3. **密钥脱敏**：日志按 key 名（`apikey|secret|token|...`）将值替换为 `[REDACTED]`，且不回显完整 API key。
4. **审批拦截**：`FH_REQUIRE_APPROVAL=true`（默认）时，危险操作需审批通道；CLI 无交互通道，由白名单机制兜底。
5. **`.env` 不入库**：已被 `.gitignore` 排除；`package.json` 的 `files` 白名单确保 `npm publish` 不会携带 `.env`。

---

## 八、配置参考（.env）

| 变量 | 说明 | 默认 / 示例 |
| --- | --- | --- |
| `FH_HOME` | 应用主目录（可缺省） | `~/.feihong-code` |
| `FH_LOG_DIR` | 会话日志目录 | `~/.feihong-code/sessions` |
| `FH_PROVIDERS` | 模型供应商 JSON 数组 | 见 `docs/配置参考.md` |
| `FH_MODEL_STRATEGY` | 路由策略：`cost`/`capability`/`latency` | `cost` |
| `FH_BUDGET_USD` | 单任务预算上限（美元，仅告警不阻断） | `0.5` |
| `FH_SHELL_ALLOW` | shell 白名单（逗号分隔） | `git,npm,node,ls,cat` |
| `FH_REQUIRE_APPROVAL` | 危险操作是否需审批 | `true` |

> 完整配置说明见 [`docs/配置参考.md`](./docs/配置参考.md)。`.env` 含密钥，切勿提交。

---

## 九、架构（feature-first 分层）

```
src/
├── cli/          入口、参数解析、REPL、运行时装配（run.ts）
├── shared/       基础设施：config / errors / logger / types
├── agent/        Orchestrator（ReAct 循环）/ Planner / Prompts / 并行编排 / 子代理
├── tools/        工具实现（file / shell / search / verify）+ registry + 安全沙箱
├── models/       模型路由 ModelRouter + providers（openai-compatible / ollama / mock）
├── runtime/      事件日志 EventLog、会话状态 SessionStore、git worktree 隔离
└── skills/       高级技能：/plan /grill /goal
```

**单命令执行流**：`CLI → Orchestrator → ModelRouter（选模型）→ 模型返回工具调用 → ToolRegistry（校验+执行）→ 结果回填模型 → 循环至完成 → 事件日志归档`。

**并行执行流**：`CLI --parallel → 分解目标 → 为每子任务创建 git worktree（独立分支）→ Promise.allSettled 并发子代理 → 收集结果 → 强制清理 worktree`。

> 架构详解见 [`docs/架构与API.md`](./docs/架构与API.md)。

---

## 十、开发

```bash
npm install
npm run build      # tsc 编译到 dist/
npm run dev        # tsx 直接跑源码（免构建）
npm run typecheck  # 仅类型检查
node dist/cli/index.js --version
```

### 工程规范（全栈铁律）

1. 边界必须校验（CLI 参数 / 模型响应 / 工具入参 → zod）。
2. 集中配置（`shared/config.ts`，启动校验、fail-fast、懒加载）。
3. 类型化错误（`AppError` 子类，禁止裸 `throw`）。
4. 结构化日志（JSON + `runId`，密钥脱敏）。
5. 单一可信源（行为以 `runtime/event-log` 为准）。

---

## 十一、部署

- **npm 全局**：`npm install -g .` 或发布后 `npm install -g feihong-code`。
- **Docker**：见 `Dockerfile`（多阶段，已含 `git` 以支持 `--parallel`）。
- **CI**：见 `.github/workflows/ci.yml`（push/PR 触发，离线冒烟，不触碰密钥）。
- **发布**：`npm publish` 仅携带 `files` 白名单（dist + 文档），密钥安全。
- 部署细节见 [`docs/部署指南.md`](./docs/部署指南.md)。

---

## 十二、里程碑进度

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M0 脚手架** | 工程结构、shared 基础设施、CLI 入口 | ✅ 完成 |
| **M1 P0 闭环** | 模型路由、文件/shell 工具、REPL、事件日志、离线闭环验证 | ✅ 完成 |
| **M2 多子代理** | `git worktree` 隔离、并行子代理、`/plan` `/grill` `/goal` 技能 | ✅ 完成 |
| **M2 真实联调（B）** | 接入 OpenAI 兼容真实模型（Agnes），ReAct 闭环跑通 | ✅ 完成 |
| **M3 长时任务恢复** | 基于事件日志的断点续跑 / diff 展示与回滚 / 审批流 | ⏳ 待启动 |
| **M4 企业级** | 权限/审计/多租户/CI 集成 | ⏳ 待启动 |

---

## 十三、文档导航

- [用户手册](./docs/用户手册.md) — 各命令详解、工具说明、审批与安全、最佳实践
- [配置参考](./docs/配置参考.md) — 全部 `FH_*` 环境变量与 `FH_PROVIDERS` 详解
- [架构与 API](./docs/架构与API.md) — 分层、编排循环、模型路由、工具协议、事件日志
- [部署指南](./docs/部署指南.md) — npm / Docker / CI / 发布 / 密钥安全
- [常见问题与故障排查](./docs/常见问题与故障排查.md) — FAQ 与排错
- [产品开发文档](./docs/产品开发文档.md) — 需求/里程碑/设计决策（演进稿）

---

## 十四、版权与署名

- **公司**：晋江市飞虹智科技企业管理有限公司
- **中心**：飞扬企源研发中心
- **负责人**：吴赐虹

© 2026 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
Released under the [MIT License](./LICENSE).

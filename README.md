# 飞虹 Code（fhcode）

> 终端 AI 编程智能体 · **Muse Code 参照复刻**
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

---

## 一、产品定位

**飞虹 Code（fhcode）** 是一款运行在终端的 AI 编程智能体，参照 Meta Muse Code 的设计理念：用自然语言描述需求，智能体自主完成**规划 → 读写代码 → 运行验证 → 汇报结果**的闭环。

- 不绑定任何单一大模型厂商，通过**多模型路由层**在 DeepSeek / 通义 / Ollama（本地）等之间按需调度。
- 所有行为以 **append-only 事件日志**为单一可信源，完全可审计、可恢复。
- 遵循**安全合规底线**：文件沙箱、shell 白名单、密钥脱敏、危险操作审批。

---

## 二、核心特性

- ✅ **自然语言 → 代码闭环**：描述需求，自动调用工具完成改码与验证。
- ✅ **多模型路由**：cost / capability / latency 三种策略选优，失败时自动 fallback。
- ✅ **离线可跑**：未配置 `FH_PROVIDERS` 时自动进入脚本化 Mock 闭环，用于演示与回归。
- ✅ **强工具系统**：文件读写改、代码搜索、受控 shell、测试/构建验证。
- ✅ **完全可审计**：每次运行生成结构化事件日志（JSONL），含 `runId`。
- ✅ **安全优先**：路径沙箱、shell 白名单、密钥脱敏、审批拦截。
- 🚧 **规划中（M2+）**：多子代理并行、`git worktree` 隔离、`/plan` `/grill` `/goal` 技能。

---

## 三、安装

### 方式一：从源码构建（推荐开发）

```bash
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build          # 编译到 dist/
node dist/cli/index.js --version
```

### 方式二：全局安装（发布后）

```bash
npm install -g feihong-code
fhcode --version        # 直接调用 bin
```

> 要求 Node.js >= 18。入口 `dist/cli/index.js` 已带 `#!/usr/bin/env node` shebang。

---

## 四、快速开始

### 4.1 离线模式（无需任何 API Key）

```bash
node dist/cli/index.js "帮我写一个 hello.ts 并打印一句话"
```

未配置 `FH_PROVIDERS` 时，自动用内置 Mock 驱动器跑通完整闭环（规划 → 调工具写文件 → 总结），用于验证链路与演示。

### 4.2 接入真实大模型

```bash
cp .env.example .env
# 编辑 .env，填入 apiKey 与 model（见第七节配置参考）
export $(grep -v '^#' .env | xargs)   # 或 source .env
node dist/cli/index.js "把 src/utils 的日期格式化抽成独立模块并补测试"
```

### 4.3 交互 REPL

```bash
node dist/cli/index.js        # 不带参数进入 REPL
```

---

## 五、命令参考

| 命令 | 说明 |
| --- | --- |
| `fhcode` | 进入交互式 REPL |
| `fhcode "<需求>"` | 单命令模式执行一条需求 |
| `fhcode --version` / `-v` | 显示版本与署名 |
| `fhcode --help` / `-h` | 显示帮助 |

---

## 六、架构（feature-first 分层）

```
src/
├── cli/          入口、参数解析、REPL、运行时装配（run.ts）
├── shared/       基础设施：config / errors / logger / types
├── agent/        Orchestrator（ReAct 循环）/ Planner / Prompts
├── tools/        工具实现（file / shell / search / verify）+ registry
├── models/       模型路由 ModelRouter + providers（openai-compatible / ollama / mock）
├── runtime/      事件日志 EventLog、会话状态 SessionStore（单一可信源）
└── skills/       高级技能（M2+：/plan /grill /goal）
```

**执行流**：`CLI → Orchestrator → ModelRouter（选模型）→ 模型返回工具调用 → ToolRegistry（校验+执行）→ 结果回填模型 → 循环至完成 → 事件日志归档`。

---

## 七、配置参考（.env）

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `FH_HOME` | 应用主目录（必需） | `~/.feihong-code` |
| `FH_LOG_DIR` | 会话日志目录 | `~/.feihong-code/sessions` |
| `FH_PROVIDERS` | 模型供应商 JSON 数组 | 见下 |
| `FH_MODEL_STRATEGY` | 路由策略：`cost`/`capability`/`latency` | `cost` |
| `FH_BUDGET_USD` | 单任务预算上限（美元） | `0.5` |
| `FH_SHELL_ALLOW` | shell 白名单（逗号分隔） | `git,npm,node,ls` |
| `FH_REQUIRE_APPROVAL` | 危险操作是否需审批 | `true` |

`FH_PROVIDERS` 完整示例（含 `model` 字段）：

```json
[
  {"id":"deepseek","type":"openai-compatible","baseURL":"https://api.deepseek.com/v1","apiKey":"sk-xxx","model":"deepseek-chat","tags":["code-gen","cheap"],"costPer1k":0.0001},
  {"id":"qwen","type":"openai-compatible","baseURL":"https://dashscope.aliyuncs.com/compatible-mode/v1","apiKey":"sk-xxx","model":"qwen-plus","tags":["code-gen","long-context"],"costPer1k":0.0002},
  {"id":"ollama","type":"ollama","baseURL":"http://localhost:11434","apiKey":"","model":"qwen2.5-coder:7b","tags":["code-gen","local"],"costPer1k":0}
]
```

> ⚠️ `.env` 含密钥，**已被 `.gitignore` 排除，切勿提交**。日志与响应中密钥字段自动转 `[REDACTED]`。

---

## 八、工具系统

| 分类 | 工具 | 说明 |
| --- | --- | --- |
| 文件 | `read_file` / `write_file` / `edit_file` / `list_dir` | 沙箱内读写，防 `../` 穿越 |
| 搜索 | `grep` | 代码内容检索 |
| Shell | `run_shell` | 白名单 + 危险拦截 + 审批 |
| 验证 | `test_run` / `build_check` | 运行测试 / 构建校验 |

所有工具入参经 **zod 校验**，错误归一为 `ToolError`。

---

## 九、开发

```bash
npm install
npm run build      # tsc 编译
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

## 十、里程碑进度

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M0 脚手架** | 工程结构、shared 基础设施、CLI 入口 | ✅ 完成 |
| **M1 P0 闭环** | 模型路由、文件/shell 工具、REPL、事件日志、离线闭环验证 | ✅ 完成 |
| **M2 多子代理** | `git worktree` 隔离、并行子代理、`/plan` `/grill` `/goal` | 🚧 规划中 |
| **M3 长时任务恢复** | 基于事件日志的断点续跑 | ⏳ 待启动 |
| **M4 企业级** | 权限/审计/多租户/CI 集成 | ⏳ 待启动 |

---

## 十一、版权与署名

- **公司**：晋江市飞虹智科技企业管理有限公司
- **中心**：飞扬企源研发中心
- **负责人**：吴赐虹

© 2026 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
Released under the [MIT License](./LICENSE).

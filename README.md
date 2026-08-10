# 飞虹 Code（fhcode）

> 终端 AI 编程智能体 · **对标 Muse Code · 超越级自我进化能力**
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
- ✅ **恢复与审计（M3）**：`sessions` 列会话、`resume` 断点续跑、`diff`/`rollback` 会话作用域变更管理、交互式审批流。
- ✅ **企业级能力（M4）**：RBAC 权限矩阵、哈希链审计日志、多租户物理隔离、日预算配额熔断、三流水线 CI。
- ✅ **Web 管理控制台（M5）**：`fhcode serve` 启动只读观测面板，可视化租户/策略/审计/配额。
- ✅ **自我进化（M6）**：错误自动识别与自愈重试、长对话上下文压缩、经验学习、模型性能追踪。

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

### 4.6 恢复与审计（M3）

每次任务都会把**完整对话、迭代计数、成本、被改动文件**落盘为会话检查点（`<runId>.session.json`），可随时恢复与审计：

```bash
fhcode sessions                                  # 列出历史会话（状态/迭代/成本/文件数）
fhcode resume <id>                              # 从检查点续跑中断的任务（离线/真实皆可）
fhcode diff <id>                                # 展示该会话相对基线的变更（会话作用域）
fhcode rollback <id> --yes                      # 回滚该会话产生的改动（危险，需 --yes 确认）
```

- `resume`：任务被中断（进程崩溃 / 达到最大迭代）后，加载检查点重建对话并继续 ReAct 循环，直到产出最终结果。
- `diff`：仅对**本会话 touchedFiles** 生成 git diff（未跟踪文件用 `--no-index` 展示新增内容），绝不整仓比对。
- `rollback`：已跟踪文件 `git checkout --`，未跟踪文件直接删除；**未确认（--yes）或非 git 仓库时拒绝执行**，避免误删。

> 会话 id 支持 8 位前缀（即 `sessions` 列表所展示的前缀），无需完整 uuid。
> 离线模式下会话落在临时目录、工作区为独立 git 仓库，同样支持完整的 diff / rollback 演示。

### 4.7 交互式审批（M3）

`FH_REQUIRE_APPROVAL=true`（默认）时，危险操作需审批：

- **TTY 交互终端**：运行期逐条弹出 `y/n` 确认（`run_shell`、写文件等高危动作须显式批准）。
- **非交互（CI / 管道）**：无 TTY 时回退到白名单审批器——命中 `FH_SHELL_ALLOW` 的命令自动通过，其余拒绝并留痕。

```bash
fhcode "删除临时缓存并重建"      # TTY 下每条 shell 命令会询问；非 TTY 仅白名单命令可过
```

### 4.8 企业能力：权限 / 审计 / 多租户 / 配额（M4）

企业模式**默认开启**（`FH_ENTERPRISE=false` 可关闭并退化为 M3 行为），身份由环境变量注入，便于容器与网关下发：

```bash
export FH_TENANT=acme        # 租户 ID（缺省 default）
export FH_USER=wuchihong     # 用户标识（缺省系统用户名）
export FH_ROLE=developer     # viewer | developer | operator | admin

fhcode whoami                # 当前租户/用户/角色/隔离目录/今日用量
fhcode policy                # 生效的 RBAC 策略与四角色矩阵
fhcode audit --limit 20      # 审计记录（默认最近 20 条）
fhcode audit verify          # 校验审计哈希链是否被篡改
fhcode tenants               # 全部租户用量汇总（会话数/成本/审计条数）
```

**① 权限（RBAC + deny 优先）**

| 角色 | 直接允许 | 需审批 | 单任务上限 |
| --- | --- | --- | --- |
| `viewer` | `read_file` `list_dir` `grep` | — | $0.1 |
| `developer` | 上述 + `write_file` `edit_file` `run_tests` `build_check` | `run_shell` | $1 |
| `operator` | 全部 | `run_shell` | $5 |
| `admin` | 全部 | `run_shell` | 不限 |

判定顺序为 **危险命令黑名单 → 敏感路径黑名单 → 沙箱越界 → 角色矩阵 → shell 白名单**。前三条 **deny 优先，admin 也无法绕过**：`rm -rf /`、`mkfs`、`curl | sh` 等 23 条危险命令，`.env`、`.ssh/id_rsa`、`.npmrc`、`.kube/config` 等 11 类敏感路径一律拒绝并留痕。

策略可用 `policy.json` 覆盖（全局 `<FH_HOME>/policy.json` → 租户 `<租户目录>/policy.json` → `FH_POLICY` 内联 JSON），**黑名单取并集，只能加严不能放松**。

**② 审计（防篡改哈希链）**

每条审计记录携带 `prevHash` 与自身 `sha256`，形成链式结构；任何改写、删除、插入都会导致链断裂：

```bash
$ fhcode audit verify
✅ 审计链完整：3 条记录，哈希链自洽未被篡改。
# 若被篡改：
❌ 审计链校验失败：共 5 条，断点在第 3 条
   记录内容被篡改：hash 不自洽（期望 8b3a6990664e…）
```

记录内容自动脱敏（`apiKey=` / `Bearer` / `sk-xxx` → `***`），审计写入失败时**工具执行一律拒绝**——宁可不做，不可无痕。

**③ 多租户（物理目录隔离）**

```
<FH_HOME>/tenants/<tenantId>/
├── sessions/     会话检查点与事件日志
├── audit/        审计链（按月切分 audit-YYYY-MM.jsonl）
├── goals/        /goal 产物
└── policy.json   租户级策略覆盖（可选）
```

租户 ID 经 `^[A-Za-z0-9._-]{1,64}$` 校验，杜绝 `../` 穿越；租户之间 `sessions` / `audit` / `goals` 完全互不可见。默认租户在旧版目录存在时自动沿用，升级不丢历史会话。

**④ 配额（成本熔断）**

- **单任务**：超过角色 `maxCostUsd` 立即中止，可调高后 `resume` 续跑。
- **租户日预算**：`FH_TENANT_BUDGET_USD`（或策略 `tenantDailyBudgetUsd`）在任务启动前 fail-fast，**不产生任何模型费用**：

```bash
$ FH_TENANT_BUDGET_USD=0.30 fhcode "超预算任务"
[飞虹 Code] 运行失败 (QUOTA_EXCEEDED): 租户 acme 今日成本 $0.420000 已达上限 $0.3，任务被拒绝。
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
| `fhcode sessions` | 列出历史会话检查点（状态/迭代/成本/文件数） |
| `fhcode resume <id>` | 从检查点恢复并续跑中断的任务 |
| `fhcode diff [<id>]` | 展示会话作用域（或当前工作区）变更 |
| `fhcode rollback <id> [--yes]` | 回滚会话改动（危险操作，需 `--yes` 确认） |
| `fhcode whoami` | 当前租户 / 用户 / 角色 / 隔离目录 / 今日用量（M4） |
| `fhcode policy` | 查看生效 RBAC 策略与角色矩阵（M4） |
| `fhcode audit [--limit N]` | 查看审计记录，默认最近 20 条（M4） |
| `fhcode audit verify` | 校验审计哈希链完整性（M4） |
| `fhcode tenants` | 列出全部租户与用量汇总（M4） |
| `fhcode model-stats` | 查看各模型性能统计（M6） |
| `fhcode experiences` | 列出经验库（M6） |
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
4. **审批拦截**：`FH_REQUIRE_APPROVAL=true`（默认）时，危险操作需审批通道；**TTY 交互终端逐条弹 `y/n` 确认**，非交互（CI/管道）则回退白名单审批器——命中 `FH_SHELL_ALLOW` 自动通过、其余拒绝并留痕。
5. **`.env` 不入库**：已被 `.gitignore` 排除；`package.json` 的 `files` 白名单确保 `npm publish` 不会携带 `.env`。
6. **RBAC 策略引擎（M4）**：角色-工具矩阵 + **deny 优先**的危险命令 / 敏感路径黑名单，`admin` 亦不可绕过；策略只能被下级配置**加严**。
7. **防篡改审计（M4）**：全量动作（allow/deny/approved/rejected）写入 sha256 哈希链，`fhcode audit verify` 可定位篡改位置；**审计写失败即拒绝执行**。
8. **租户隔离与配额（M4）**：会话 / 审计 / 目标物理分目录，租户 ID 严格校验；单任务成本熔断 + 租户日预算 fail-fast。

> M4 起守卫（guard）是**唯一权威闸门**：策略判定、人工审批、审计留痕都在工具执行前一次性完成，工具层不再重复弹审批，避免"审批打架"与重复询问。

---

## 八、配置参考（.env）

| 变量 | 说明 | 默认 / 示例 |
| --- | --- | --- |
| `FH_HOME` | 应用主目录（可缺省） | `~/.feihong-code` |
| `FH_LOG_DIR` | 会话日志目录 | `~/.feihong-code/sessions` |
| `FH_PROVIDERS` | 模型供应商 JSON 数组 | 见 `docs/配置参考.md` |
| `FH_MODEL_STRATEGY` | 路由策略：`cost`/`capability`/`latency` | `cost` |
| `FH_BUDGET_USD` | 单任务预算上限（美元，仅告警不阻断） | `0.5` |
| `FH_SHELL_ALLOW` | shell 白名单（逗号分隔，命中即免审批） | `git,npm,node,ls,cat` |
| `FH_REQUIRE_APPROVAL` | 危险操作是否需审批 | `true` |
| `FH_ENTERPRISE` | 企业模式开关（权限/审计/多租户/配额） | `true` |
| `FH_TENANT` | 租户 ID（决定隔离目录） | `default` |
| `FH_USER` | 用户标识（写入审计 actor） | 系统用户名 |
| `FH_ROLE` | 角色：`viewer`/`developer`/`operator`/`admin` | `developer` |
| `FH_TENANT_BUDGET_USD` | 租户日成本上限（0 = 不限） | `0` |
| `FH_POLICY` | 内联策略 JSON（优先级最高） | 未设置 |

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
├── runtime/      事件日志 EventLog、会话状态 SessionStore、会话检查点持久化、git diff/rollback、git worktree 隔离
├── enterprise/   M4 企业能力：tenant（多租户）/ policy（RBAC）/ audit（哈希链）/ quota（配额）/ guard（守卫）
└── skills/       高级技能：/plan /grill /goal
```

**单命令执行流**：`CLI → Orchestrator → ModelRouter（选模型）→ 模型返回工具调用 → ToolRegistry（校验+执行）→ 结果回填模型 → 循环至完成 → 每轮落盘检查点 + 事件日志归档`。

**并行执行流**：`CLI --parallel → 分解目标 → 为每子任务创建 git worktree（独立分支）→ Promise.allSettled 并发子代理 → 收集结果 → 强制清理 worktree`。

**恢复执行流（M3）**：`sessions 列出检查点 → resume <id> 加载检查点重建对话 → 续跑 ReAct 循环 → 产出最终结果`；`diff/rollback` 基于检查点的 touchedFiles 做会话作用域的 git 比对与回退。

**企业管控流（M4）**：`环境注入身份（tenant/user/role）→ 加载策略（默认→全局→租户→内联）→ 配额前置校验 → 每次工具调用经 guard：策略判定 → 必要时人工审批 → 写入哈希链审计 → 放行/拒绝`。

> 架构详解见 [`docs/架构与API.md`](./docs/架构与API.md)。

---

## 十、开发

```bash
npm install
npm run build      # tsc 编译到 dist/
npm run dev        # tsx 直接跑源码（免构建）
npm run typecheck  # 仅类型检查
npm run verify:m4  # M4 企业能力断言套件（41 项，全离线）
npm run verify     # typecheck + build + M4 断言，一条命令过全链路
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
- **CI**：见 `.github/workflows/ci.yml`，三条流水线全离线、零 Secrets：
  - `build`：Node 18/20/22 矩阵 → typecheck → 编译 → 离线端到端 → 只读技能；
  - `enterprise`：M4 断言套件（41 项）+ CLI 企业命令冒烟 + **租户隔离断言**（beta 租户不得读到其它租户会话）；
  - `security`：`npm pack` 白名单校验（禁止 `.env`/`src`/`policy.json` 入包）+ 仓库明文密钥扫描 + `npm audit`。
- **发布**：`npm publish` 仅携带 `files` 白名单（dist + 文档），密钥安全。
- 部署细节见 [`docs/部署指南.md`](./docs/部署指南.md)，企业落地见 [`docs/企业部署与合规.md`](./docs/企业部署与合规.md)。

---

## 十二、里程碑进度

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M0 脚手架** | 工程结构、shared 基础设施、CLI 入口 | ✅ 完成 |
| **M1 P0 闭环** | 模型路由、文件/shell 工具、REPL、事件日志、离线闭环验证 | ✅ 完成 |
| **M2 多子代理** | `git worktree` 隔离、并行子代理、`/plan` `/grill` `/goal` 技能 | ✅ 完成 |
| **M2 真实联调（B）** | 接入 OpenAI 兼容真实模型（Agnes），ReAct 闭环跑通 | ✅ 完成 |
| **M3 恢复与审计** | `sessions`/`resume` 断点续跑、`diff`/`rollback` 会话作用域变更管理、交互式审批流 | ✅ 完成 |
| **M4 企业级** | RBAC 策略引擎、防篡改审计链、多租户隔离与配额、三流水线 CI | ✅ 完成 |
| **M5 Web 控制台** | 只读观测面板（租户/策略/审计/配额可视化）| ✅ BETA |
| **M6 自我进化** | 自愈循环、上下文压缩、经验学习、模型性能追踪 | ✅ 完成 |

---

## 十三、文档导航

> **权威文档（稳定版首选）**
- [技术说明书](./docs/技术说明书.md) — 架构、企业能力技术细节、数据契约、CLI/Web API、部署架构、安全模型、构建验证
- [使用说明书](./docs/使用说明书.md) — 安装、快速上手、命令总览、核心工作流、企业版/Web 控制台使用、配置、排错

> **补充参考**
- [用户手册](./docs/用户手册.md) — 各命令详解、工具说明、审批与安全、最佳实践
- [配置参考](./docs/配置参考.md) — 全部 `FH_*` 环境变量与 `FH_PROVIDERS` 详解
- [架构与 API](./docs/架构与API.md) — 分层、编排循环、模型路由、工具协议、事件日志
- [部署指南](./docs/部署指南.md) — npm / Docker / CI / 发布 / 密钥安全
- [企业部署与合规](./docs/企业部署与合规.md) — RBAC 角色设计、审计取证、多租户方案、配额治理（M4）
- [常见问题与故障排查](./docs/常见问题与故障排查.md) — FAQ 与排错
- [产品开发文档](./docs/产品开发文档.md) — 需求/里程碑/设计决策（演进稿）

> 稳定部署产物：`Dockerfile`、`docker-compose.yml`、`install.sh`、`CHANGELOG.md`（见仓库根目录）。

---

## 十四、版权与署名

- **公司**：晋江市飞虹智科技企业管理有限公司
- **中心**：飞扬企源研发中心
- **负责人**：吴赐虹

© 2026 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
Released under the [MIT License](./LICENSE).

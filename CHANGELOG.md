# 更新日志 (CHANGELOG)

本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 约定，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.0] — 2026-08-16（Skills 市场对接：search / install / list）

> 对接 agentskills.io 开放技能市场（discovery index 规范 0.2.0）：`fhcode skill-market search <关键词>` 检索、`install <技能名>` 安装（支持 SKILL.md 直下与 tar.gz 归档解包）、`list` 查看本地技能；安装后自动被任务技能发现（渐进式披露）复用。

### 新增（Added）
- **`src/skills/skill-market.ts` 市场模块**：well-known 发现（`/.well-known/agent-skills/index.json`）、`$schema` 兼容判定（0.2.0/0.1.0，未知告警）、RFC 3986 URL 解析（绝对/根相对/相对）、评分搜索（名称精确>前缀>包含>描述）、sha256 digest 校验（防投毒）、skill-md 直下与 tar.gz 归档解包（**零依赖手写 tar 解析**，路径穿越防护）。
- **`fhcode skill-market` CLI**：`search <关键词>`（`--repo <市场源>` 指定源，缺省 agentskills.io 或 `FH_SKILL_MARKET`）、`install <技能名>`（安装到 `~/.feihong-code/skills/`）、`list`（本地已装技能）；安装校验 SKILL.md 含 name frontmatter，失败回滚。
- **i18n**：11 组中英双语词条（本地空/拉取失败/schema 告警/搜索空/标题/安装提示/未找到/安装成功/失败等）。

### 测试（Tests）
- 新增 `skill-market.test.ts` 10 个用例（索引解析/schema 判定/搜索排序/URL 解析/digest 校验/skill-md 安装/归档解包/篡改拒绝/路径穿越防护），含本地 mock 市场服务器与手写 tar.gz 夹具。
- `npm test` **156/156** ✅

### 校验（Verified）
- typecheck ✅ · build ✅ · `npm run eval` ✅（5/5 场景，完成率 100%）
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 ✅ 零回归

## [0.4.0] — 2026-08-16（P5 生态收尾：任务面板 + webhook 调度 + VSCode 扩展 + Docker 沙箱 + 语义索引 + 消息渠道）

> 对标生态全景后补齐六项工程缺口：Web 控制台从只读升级为可交互任务面板、任务状态 webhook 调度入口（可被 CI/外部系统编排）、VSCode 扩展壳（编辑器侧调起 CLI）、Docker 容器沙箱第四档、轻量语义符号索引、Telegram/企业微信消息渠道推送。

### 新增（Added）
- **P5-1 Web 任务面板**：`index.html` 从只读仪表盘升级为可交互任务面板——token 输入（URL 参数或 localStorage 持久化）、目标提交（`POST /api/tasks`）、任务列表（5s 轮询 + 徽章状态）、点击展开结果详情（迭代/成本/日志/最终答案/错误）。
- **P5-2 调度入口 webhook**：`TaskQueue` 状态机每个节点（queued→running→done|failed）触发回调；`fireWebhook` 携带**状态快照**（修复 submit 后 pump 同步改状态导致 queued 回调读不到的问题）；`POST /api/webhook` 动态注册、`GET /api/webhook` 查询；`FH_TASK_WEBHOOK_URL` 初始化。
- **P5-3 VSCode 扩展壳**：`vscode-extension/`（package.json 清单 + extension.js + README）——`fhcode.run` 调起 CLI 执行任务（输出流式写入 Output Channel）、`fhcode.diff` 查看工作区 diff；`fhcode.binaryPath`/`fhcode.offline` 配置。
- **P5-4 Docker 沙箱模式**：沙箱新增第四档 `FH_SANDBOX_MODE=container`——shell 命令在 Docker 容器内执行（`docker run --rm -v <cwd>:/workspace`，镜像 `FH_SANDBOX_IMAGE` 默认 `node:22-alpine`）；网络域名规则照常生效；`docker` 别名可写。
- **P5-5 轻量语义索引**：`src/agent/symbol-index.ts` 正则级符号提取（函数/类/接口/const/type，跨 TS/JS），目录扫描跳过 node_modules/.git，磁盘缓存（FH_HOME/symbol-index.json，根路径匹配防串库），`findSymbol`/`symbolsForFile`/`indexStats` 查询。
- **P5-6 消息渠道**：`src/web/channels.ts` 聚合 Telegram（`FH_CHANNEL_TELEGRAM_BOT_TOKEN`+`FH_CHANNEL_TELEGRAM_CHAT_ID`）与企业微信（`FH_CHANNEL_WECOM_KEY` 逗号分隔多 key）推送；任务状态变化自动推送紧凑消息；未配置渠道零开销、投递失败仅告警。

### 修复（Fixed）
- **task-queue webhook 时序缺陷**：submit() 后 pump 同步把状态改为 running，若回调读取当前状态则 queued 节点永远发不出去——改为回调携带 status 快照。
- **symbol-index 两处缺陷**：扩展名匹配用整个文件名（应为 `extname`）；缓存路径用 `homedir()` 在 Windows 不读 `HOME`（改为尊重 `FH_HOME`）。

### 测试（Tests）
- 新增 6 个测试文件、27 个用例：`task-webhook.test.ts`（3 例：生命周期回调/动态注册/不可达容错）、`symbol-index.test.ts`（5 例：提取/扫描跳过/缓存往返/查询/统计）、`channels.test.ts`（5 例：开关识别/消息生成/未配置无操作/启用检测/TaskQueue 集成）；`sandbox.test.ts` 扩充 container 用例、`web-tools`/`task-queue` 回归。
- `npm test` **147/147** ✅

### 校验（Verified）
- typecheck ✅ · build ✅ · `npm run eval` ✅（5/5 场景，完成率 100%）
- Web 任务面板冒烟 ✅（401 鉴权 / 201 创建 / 任务 done 含结果）
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 ✅ 零回归

## [0.4.0] — 2026-08-16（P4 云端与协作：/api/tasks 任务队列 + Agent teams 多 agent 协作）

> 路线图最终阶段：把 CLI 执行能力暴露为 HTTP 任务队列（云执行雏形），并引入 Agent teams 多 agent 协作（共享任务清单 + 消息总线，对齐 Claude Code agent teams）。

### 新增（Added）
- **P4-1 云执行（`/api/tasks`）**：从 `runGoal` 抽取服务端可复用执行函数 `executeTask`（静默执行、返回结构化结果）；Web 控制台新增任务队列 `TaskQueue`（提交/列表/查询，并发上限默认 2，`FH_TASK_CONCURRENCY` 可调，状态机 queued → running → done/failed）；`POST /api/tasks`（201 创建）、`GET /api/tasks`、`GET /api/tasks/:id`（404 兜底），全部经 Bearer 鉴权。
- **P4-2 Agent teams（`fhcode team "<目标>"`）**：`src/agent/team.ts` 实现 `TeamBus`（消息总线，send/receive/broadcast 定向与广播）、`TaskBoard`（共享任务清单，claim 原子认领防重复）、`runTeam`（多 agent 并发认领执行，逐任务摘要回传，产出团队报告）；目标经 planner 拆解为任务清单，成员可自定义角色。

### 修复（Fixed）
- **runTeam 完成判定**：`runSubTask` 返回 `ok=false` 时任务须记为 failed（此前仅抛错才记 failed，导致 overall 误判为 success）。

### 测试（Tests）
- 新增 2 个测试文件、10 个用例：`task-queue.test.ts`（4 例：异步执行到 done/列表倒序/按 id 查询/并发上限）、`team.test.ts`（6 例：总线定向+广播/认领原子性/多 agent 全完成/部分失败/抛错失败/个人上限）。
- `npm test` **133/133** ✅

### 校验（Verified）
- typecheck ✅ · build ✅ · `npm run eval` ✅（5/5 场景，完成率 100%）
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 ✅ 零回归

## [0.4.0] — 2026-08-16（P3 体验与生态：TUI + web 工具 + 插件分发 + 子代理嵌套）

> P0-P2 补齐能力底座后，P3 聚焦终端体验与生态延展：REPL 升级为 sticky-header TUI（无闪烁渲染）、新增实时信息检索工具（受沙箱网络规则约束）、插件打包分发（skills+hooks+MCP 一键安装）、子代理递归嵌套（深度上限 + 逐层摘要）。

### 新增（Added）
- **P3-1 TUI 升级（`src/cli/tui.ts`）**：REPL 在 TTY 下自动进入交替屏幕缓冲（`\x1b[?1049h`），sticky header 常驻显示模式/runId/迭代/成本/状态，内容区滚动；整屏单次 write 无闪烁渲染；滚轮/滚动偏移查看历史（SGR 鼠标模式）；非 TTY 自动退化普通输出。
- **P3-2 web 工具（`web_search` / `web_fetch`）**：零依赖实时信息检索（默认 DuckDuckGo HTML 接口，`FH_SEARCH_ENDPOINT` 可覆盖）；HTML 转纯文本、输出 6KB 截断、15s 超时；`checkNetworkUrl` 与沙箱网络规则联动（FH_NETWORK_ALLOW/DENY 对 URL 入参同样生效）。
- **P3-3 插件打包分发（`fhcode plugin install/list`）**：`plugin.json` 清单打包 skills + hooks + MCP 服务器；用户级 `~/.feihong-code/plugins` + 项目级 `.fhcode/plugins` 双级发现；`installPlugin` 支持本地目录复制与 git clone，覆盖安装、非法插件拒绝；`loadConfig` 自动聚合插件技能目录/hooks/MCP。
- **P3-4 子代理嵌套**：`runSubAgent` 新增深度控制（默认 3 层），目标可拆解且未达上限时递归派生子代理（子目录隔离，不建 git worktree），逐层用摘要结果回传（复用 P2-2 `summarizeSubTaskAnswer`），深度达上限或目标不可拆解时直接执行。

### 修复（Fixed）
- **run.ts 装配**：runGoal 传入 `pluginSkillDirs`，让插件技能进入编排器技能索引（此前插件技能仅可被 load_skill 发现）。

### 测试（Tests）
- 新增 4 个测试文件、13 个用例：`web-tools.test.ts`（5 例：本地 mock HTTP 抓取/黑名单/白名单/搜索解析/URL 检查）、`plugin-loader.test.ts`（5 例：清单解析/发现聚合/安装覆盖/非法拒绝/缺源）、`subagent-nesting.test.ts`（3 例：深度上限直执行/递归嵌套摘要/不可拆解直执行）。
- `npm test` **123/123** ✅

### 校验（Verified）
- typecheck ✅ · build ✅ · `npm run eval` ✅（5/5 场景，完成率 100%）
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 ✅ 零回归

## [0.4.0] — 2026-08-16（P2 确定性控制：hooks 事件系统 + 子代理摘要 + AGENTS.md 路径级规则）

> 对标 Claude Code 补上"确定性控制"短板：hooks 事件系统（工具调用前可拦截、编辑后自动跑命令）、子代理结果摘要化回主上下文（隔离中间大输出）、AGENTS.md 支持 paths frontmatter 路径级规则（JIT 按需注入省 token）。

### 新增（Added）
- **P2-1 hooks 事件系统（`FH_HOOKS`）**：PreToolUse（工具执行前，命令退出码非 0 → 硬拦截）/ PostToolUse（执行后记录，可跑 lint/格式化）/ PostEdit（编辑工具成功落盘后，针对被改文件）/ SessionStart（预留）；支持 `{cwd} {tool} {path} {runId} {ok}` 占位符与 `tools`/`paths` 匹配过滤；零上下文成本（hook 是命令而非指令文本）。
- **P2-2 子代理结果摘要**：`subagent-summary.ts` 把子任务最终答案摘要化（默认 600 字符，超长截断并标注原文长度），`swe`/并行子任务回主上下文只带摘要+元数据，隔离中间大输出。
- **P2-3 AGENTS.md 路径级规则**：`paths` frontmatter（`["src/**","tests/**"]`）声明规则作用域；无 paths 的正文作为全局指令常驻 system prompt，带 paths 的规则在工具操作相关文件时 JIT 注入（按文件去重）；`pathMatches` 支持目录前缀 / `**` 任意深度 / `*` 单层通配 / 精确匹配。

### 修复（Fixed）
- **repo-context 返回结构重构**：`readRepoInstructions` 从返回字符串改为返回 `{global, scoped}` 结构化结果，兼容原全局注入语义。
- **pathMatches 通配符顺序缺陷**：`**`/`*` 需在正则转义前处理，改为手写 globToRegex 转换器（顺序敏感），修复 `**/*.test.ts` 等模式误判。

### 测试（Tests）
- 新增 `hooks.test.ts` 8 个用例（解析过滤/占位符/PreToolUse 拦截/PostToolUse 不阻断/PostEdit 路径匹配/注册表集成）、`subagent-summary.test.ts` 4 个用例（短结果/截断/边界/空串）；`repo-context.test.ts` 重构适配新结构并新增 paths 规则与 pathMatches 用例。
- `npm test` **110/110** ✅

### 校验（Verified）
- typecheck ✅ · build ✅ · `npm run eval` ✅（5/5 场景，完成率 100%）
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 ✅ 零回归

## [0.4.0] — 2026-08-16（P1 核心增强：子代理模型分工 + SKILL.md 技能标准 + eval 跑分）

> 在 P0 基础上继续对标 Codex：子任务自动路由低成本模型（编排器/worker 分工）、引入 Agent Skills 开放标准（SKILL.md 渐进式披露，现有 /plan /grill /goal 迁入）、新增本地 mock 跑分基准（完成率/工具效率/自愈率可量化）。

### 新增（Added）
- **P1-1 子代理模型分工**：Orchestrator 新增 `tags` 路由选项（缺省 `['code-gen']`）；`swe` 子任务与并行子代理（subagent）自动带 `['code-gen','cheap']`，让低成本模型分担高频子任务（对齐 Codex 编排器 gpt-5.4 + worker gpt-5.4-mini 模式）。无 cheap 标签 provider 时自动回退全部 provider，零配置零风险。
- **P1-2 SKILL.md 技能标准**：`src/skills/skill-loader.ts` 实现 open agent skills 兼容解析（frontmatter name/description + 正文）、多级发现（仓库 `.agents/skills` / `.claude/skills` 逐级回溯 + 打包 `skills/` + 用户级 `~/.feihong-code/skills`）、渐进式披露（name+description 索引常驻 ≤8KB，完整正文由 `load_skill` 工具按需加载）；`load_skill` 注册为内置工具；现有 /plan /grill /goal 迁入 `skills/plan|grill|goal/SKILL.md` 打包技能。
- **P1-3 eval 跑分基准（`npm run eval`）**：`scripts/eval.mjs` 用 ScriptedMockProvider 跑 5 组标准场景（简单回答/单工具/多工具/自愈/多轮），复用 P0-1 事件流统计完成率、平均迭代、工具效率（工具调用/任务）、自愈触发率；支持 `--json` 结构化输出供横向对比；退出码可接入 CI。

### 测试（Tests）
- 新增 `skill-loader.test.ts` 7 个用例（frontmatter 解析/无 frontmatter 回退/仓库发现回溯/打包目录/索引预算截断/按名加载/未知技能）。
- `npm test` **95/95** ✅

### 校验（Verified）
- typecheck ✅ · build ✅ · `npm run eval` ✅（5/5 场景通过，完成率 100%）
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 ✅ 零回归

## [0.4.0] — 2026-08-16（P0 快速见效：流式输出 + 沙箱三模式 + MCP + AGENTS.md）

> 对标 Codex 差距分析后优先落地 P0 四项工程级升级：任务过程流式可见、沙箱从"白名单"升级为可证明边界（三模式 + 网络域名规则）、打通 MCP 工具生态（零依赖 stdio 客户端）、支持仓库级 AGENTS.md 指令自动注入。

### 新增（Added）
- **P0-1 流式输出（`--stream`）**：编排器新增事件流回调 `onEvent`（model.response / tool.call / tool.result / self-heal / context.compact / session.end），CLI 增量渲染到 stdout（🧠🔧✅❌🩹📦🏁），长任务过程实时可见；事件与展示解耦，后续 TUI 可复用同一事件流。
- **P0-2 沙箱三模式（`FH_SANDBOX_MODE`）**：`read-only`（只读勘察，禁写禁执行）/ `workspace-write`（默认，文件工具正常，shell 受白名单+审批）/ `danger-full-access`（绕过写限制与审批，危险命令黑名单仍生效）；网络域名规则 `FH_NETWORK_ALLOW` / `FH_NETWORK_DENY`（deny 全模式生效，allow 未命中即拦截）；沙箱作为"能否做"的硬边界先于 RBAC 守卫执行，审批/策略无权放行被拦截动作。
- **P0-3 MCP 客户端（`FH_MCP_SERVERS`）**：零依赖 MCP stdio 客户端（NDJSON JSON-RPC 2.0，initialize 握手 → tools/list → tools/call），远程工具以 `<serverName>_<tool>` 前缀注册进 ToolRegistry（沙箱/守卫同样生效）；服务器启动失败自动跳过不阻塞主流程；支持配置文件 `mcp.servers` 字段。
- **P0-4 仓库指令（AGENTS.md）**：自动发现 cwd → 仓库根（`.git` 判定）逐级向上的 `AGENTS.md`（含 CLAUDE.md / .atomcode.md 别名兜底），内容注入 system prompt（限 8KB），与经验注入叠加生效。

### 修复（Fixed）
- **MCP 客户端 pending 映射缺陷**：超时/进程退出时错误地把 `Error` 传给 resolve 通道（类型与行为双重错误），改为 `{resolve, reject, timer}` 结构，resolve 时清理定时器。
- **沙箱接入顺序**：沙箱校验先于 RBAC 守卫执行，避免策略/审批放行沙箱硬边界外的动作。

### 测试（Tests）
- 新增 4 个测试文件、20 个用例：`sandbox.test.ts`（8 例：三模式/网络规则/域名解析）、`mcp.test.ts`（6 例：握手/列工具/调用/注册/容错/解析）、`repo-context.test.ts`（6 例：命中/回溯/兜底/截断/片段生成）。
- 新增 mock MCP 服务器夹具 `tests/fixtures/mock-mcp-server.mjs`（NDJSON 协议）。
- `npm test` **88/88** ✅

### 校验（Verified）
- typecheck ✅ · build ✅ · `--stream` 冒烟 ✅（增量事件可见）
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 ✅ 零回归

## [0.4.0] — 2026-08-16（自我优化迭代：doctor 环境自检 + 统计闭环 + 测试加固）

> 在 v0.3.3 复盘修复基础上继续自我优化：新增 `fhcode doctor` 环境自检命令；修复模型统计只在内存不落盘的半成品闭环；审计写锁忙等改指数退避；清除全部 `as any` 弱类型；为核心模块补齐单元测试（68/68 全绿）。

### 新增（Added）
- **`fhcode doctor` 环境自检命令**：一键检查 Node 版本 / git 可用性 / 模型 provider 配置 / 网络连通 / 主目录可写，全部通过输出 ✅、异常项以 ⚠️ 列明，帮助快速定位接入问题；中英文双语词条与帮助文本同步。
- **模型性能统计自动落盘**：`ModelRouter` 新增 `statsHomeDir`（`fromConfig` 自动注入 `cfg.app.homeDir`），`updateStat` 更新后自动 `saveStats`，`model-stats` 命令从"永远读空"变为真正可用。

### 修复（Fixed）
- **ModelRouter 失败统计空条目**：失败时 `model=''` 会污染统计报表与成功率加权，改用 provider 配置的模型名；`score()` 统计查找与键控统一为 providerId+model。
- **`~` 路径展开**（Windows）：`expandHome` 改用 `os.homedir()`（原 `process.env.HOME` 在 Windows 常缺失）；`FH_LOG_DIR` 新增 `expandTilde()` 展开（`.env.example` 推荐写法此前失效）。
- **版本号漂移**：`config.ts` 硬编码 `APP_VERSION='0.3.1'` 与 CLI v0.3.3 不一致，统一从 `cli/version.ts` 单一来源导入。
- **延迟统计污染**：`startTime` 在 fallback 循环外取值会把前序 provider 失败耗时计入成功方，移入每次尝试内。
- **REPL 交互**：Ctrl+D 中断与斜杠命令支持（`/plan` `/grill` `/goal`），退出更自然。
- **`as any` 清零**：`logRecoveryAttempt` 以 `Pick<EventLog,'append'>` 结构化类型替代 `as any`；`self-heal.attempt` 补入 `EventType` 联合。

### 优化（Changed）
- **审计写锁指数退避**：`withAuditLock` 固定 10ms 轮询改为 10ms→200ms 指数退避（锁清理后重置），降低锁竞争下 CPU 空转；`SharedArrayBuffer` 提升为模块级复用。
- **路径统一**：`runModelStats`/`runExperiences` 硬编码 `~/.feihong-code` 改用 `resolveHomeDir()`（尊重 `FH_HOME`），删除 `require('os')` 运行时 require。
- **验证套件接线**：`npm run verify` 补全 m6/m7/m8/m9（此前只跑 m4），一键全量回归。

### 测试（Tests）
- 新增 3 个测试文件、17 个用例：`model-router.test.ts`（统计聚合/落盘往返/fallback）、`audit.test.ts`（哈希链/篡改检测/跨实例续链/脱敏）、`web-auth.test.ts`（fail-closed 鉴权）。
- `npm test` **68/68** ✅

### 校验（Verified）
- typecheck ✅ · build ✅ · doctor 冒烟 ✅（环境全绿）
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 ✅

## [0.3.3] — 2026-08-16（代码复杂度治理 + 双语收尾）

> 用 TS AST 圈复杂度扫描（`scripts/complexity.cjs`）量化热点，针对性重构最高复杂度的函数，不改动任何对外行为。同时把上一轮已完成的 v0.3.2 中英文双语界面一并随本次提交收尾上线。

### 优化（Changed · 复杂度治理）
- **`cli/commands.parseArgs`**：~50 个 if 分支的参数解析改为 `FLAG_SPECS` 规格表 + `applyFlag()` 统一分发；~18 个管理命令 if 链改为 `MANAGE_BUILDERS` 分发表；抽出 `buildSweCommand()`。圈复杂度 **73 → 13**，函数长度 142 → 44 行。
- **`agent/self-heal.classifyError`**：6 类错误长 if 链改为声明式 `ERROR_RULES` 规则表。圈复杂度 **41 → <10**。
- **`agent/repo-reader.readRepository`**：内部嵌套 BFS `walk` 提到模块级 `walkRepository()`；抽出 `detectTestBuild()`（package.json 优先 + Python/Go/Rust 兜底）。圈复杂度 **39 → 10**，行数 174 → 77。
- **`agent/orchestrator.run`**：抽出 `recordTouchedFiles()` / `executeToolRound()` / `handleRecovery()`（自愈密集分支用判别返回值 `{signal}` 承载原 `break/continue` 控制流，零行为变更）。圈复杂度 **39 → 28**。
- **`cli/index.main`**：抽出 `dispatchSkill()` / `dispatchManage()`（`switch(m.kind)` 派发，判别联合自动收窄字段，类型安全）。圈复杂度 **30 → <10**。

### 新增（Added）
- **复杂度量化工具**：`scripts/complexity.cjs`（基于 TS 编译器 API 的圈复杂度 + 函数长度扫描，输出 `cc≥10 || 行数≥80` 热点榜），可随时复测。

### 校验（Verified）
- typecheck ✅ · build ✅
- `npm test` **51/51** ✅ 无回归
- parseArgs 9 组用例输出与原实现逐字节一致；readRepository 扫真实仓库验证遍历/测试命令探测正确
- 原 Top 5 热点（parseArgs 73 / classifyError 41 / orchestrator.run 39 / readRepository 39 / main 30）**全部降级**

## [0.3.2] — 2026-08-15（中英文双语界面升级）

> 全量国际化（i18n）：CLI 与 Web 控制台界面支持中文/英文一键切换，默认按系统 locale 自动检测，可用 `--lang zh|en` 或环境变量 `FHCODE_LANG` 强制指定。新增 `src/shared/i18n.ts` 双语词库与 `t()` 插值函数，覆盖 banner/help/REPL/全部子命令输出/企业身份与策略渲染/质量门禁报告。Web 控制台由占位页升级为真正的双语仪表盘（含语言切换按钮，前端直接拉取免鉴权的 `/api/health`）。

### 新增（Added）
- **i18n 基础设施**：`src/shared/i18n.ts` 提供 `zh`/`en` 双语词库、`t(key, params?)` 插值、`detectLang()`（FHCODE_LANG > 系统 locale）、`setLang/getLang` 运行时切换。
- **CLI 双语**：`--lang zh|en` 参数；banner/help/异常/REPL/全部 run 命令（sessions/resume/diff/rollback/whoami/policy/audit/tenants/model-stats/experiences/serve/code-write/quality-gate/self-improve/swe/审批器）输出可切换。
- **企业命令与质量门禁双语**：`renderWhoami`/`renderPolicy` 与质量门禁报告接入 `t()`。
- **Web 双语仪表盘**：`src/web/public/index.html` 真正的观测页，含中英文切换（?lang / localStorage / 浏览器语言 / 服务端 lang 四级回退）；`/api/health` 新增 `lang` 字段并改为免鉴权公开端点。

### 校验（Verified）
- typecheck ✅ · build ✅

## [0.3.1] — 2026-08-15（自我迭代系统 / 写代码能力 宇宙级升级）

> 把"自我迭代"从断环变成闭环：经验库升级为强化学习式（稳定 id + upsert 去重加权），反思器真正分析对话并写入与 orchestrator **共用**的同一经验库（此前孤岛目录互不回流），让既往任务的成功/失败/自愈经验真正注入后续任务。同时修复 code-writer 两处真实 bug（通配正则整体覆盖文件、空规则导致审查失效）。

### 修复（Fixed · 真实 bug）
- **code-writer `fix()` 灾难性修复**：原 `issueToFix` 默认分支用 `pattern: /.*/` 会把**整个文件替换成建议文本**，造成数据破坏。改为仅对「硬编码密钥 / SQL 拼接」等已知安全模式做针对性替换，其余一律跳过并提示人工处理。
- **code-writer 审查/修复失效**：构造时 `rules` 默认 `[]` 被透传给 `reviewCode`，使默认审查规则不生效（默认参数仅 `undefined` 时触发）。改为规则为空时回落默认规则。
- **reviewCode 跨行误判**：规则正则带 `g` 标志导致 `RegExp.test()` 的 `lastIndex` 跨行残留，后续行误判为无问题。每次匹配前重置 `lastIndex`。

### 优化（Changed · 自我迭代闭环）
- **经验系统强化学习化**（experience.ts）：新增 `upsertExperience`（同 id 合并、sessionCount 累积、成功率加权平均、标签合并）、`retrieveRelevantExperiences`（标签重叠 + 新鲜度 + 成功率加权召回）、`extractFixPattern`（从自愈成功会话提取可复用修复经验）；`extractExperience` 改用 `classifyError` 精确错误分类并生成稳定 id。
- **反思器打通回流**（self-improver.ts）：`reflect` 基于真实对话统计工具调用/错误簇/自愈恢复，产出具体模式与改进，并以 `upsertExperience` 写入与 orchestrator 共用目录（默认 `~/.feihong-code/experiences`），新增 `getLearnedPrompt(goal)` 召回既往学习。
- **orchestrator 闭环**：加载改用加权检索并注入 system prompt；提取改用 `upsert` 强化；`selfHealed` 成功时额外固化修复经验；修正 usage 统计更新的是"被加载并使用的经验"。
- **错误分类中英双语**（self-heal.ts）：`classifyError` 新增中文关键词识别（路径/权限/超时/编译/未定义等），对中文工具输出分类更准确。

### 新增（Added）
- **self-improve 命令增强**：展示经验库规模/Top 经验/反思记录，并预览"将注入模型的学习提示"，可直观看到自我迭代积累。
- **测试扩充**：`tests/unit/self-learn.test.ts`（6 例：upsert 合并/加权召回/稳定 id/修复经验提取/反思回流）、`tests/unit/code-writer.test.ts`（3 例：安全修复不破坏文件/空规则跳过/自愈收敛）。

### 校验（Verified）
- typecheck ✅ · build ✅ · `npm test` 51/51 ✅
- verify:m4 41/41 · m6 29/29 · m7 12/12 · m8 27/27 · m9 25/25 · m9-real 11/11 ✅ 全部 100% 通过

## [0.3.0] — 2026-08-15（宇宙能量级复盘优化 · GitHub + npm 上线准备）

> 全面复盘查漏补缺后的收口版本：修复版本链路不一致、修复命令无输出、扩充核心模块单元测试到 42 例、补齐 GitHub 社区健康文件与 npm 发布白名单，为 GitHub 升级与 npm 首发做完整准备。

### 修复（Fixed）
- **版本号全链路一致性**：`package.json` 0.2.3 与 `src/cli/version.ts`、`src/shared/config.ts` 的 `0.2.1` 不一致，统一升级到 `0.3.0`（运行时 / 包 / 配置三方一致）。
- **`model-stats` / `experiences` 命令无输出**：`runModelStats` / `runExperiences` 未导入 `index.ts` 调用，现已补全，命令正常输出（空状态给出友好提示，执行任务后自动累积数据）。

### 优化（Changed）
- **GitHub 仓库指向**：`package.json` 的 `repository` / `bugs` 由 GitCode 镜像切回 GitHub 主仓（`wch887292/feihong-code`），README 同步修正迁移说明与社区板块（二维码改为官网链接，避免失效资源）。
- **GitHub 仓库元数据升级**：通过 API 更新仓库描述为 `v0.3.0` 并突出 npm 可装 / MIT 开源；Topics 补充至 19 个合规标签。

### 新增（Added）
- **单元测试扩充**：新增 `tests/unit/experience.test.ts`（9 例，覆盖经验提取/持久化/加载/排序/注入）、`tests/unit/orchestrator.test.ts`（6 例，覆盖 ReAct 循环/工具执行/成本熔断/迭代上限/检查点恢复/经验提取），单元测试总量 42 例。
- **GitHub 社区健康文件**：新增 `.github/FUNDING.yml`（Sponsor 按钮）、`.github/dependabot.yml`（每周依赖与安全自动化更新）。
- **本地部署调试指南**：`DEPLOYMENT-GUIDE.md`（安装 / 配置模板 / 调试命令 / 故障排查）。
- **npm 上线预检清单**：`NPM-RELEASE.md`（发布前自动校验、包字段核对、发布流程、回滚预案）。

### 校验（Verified）
- TypeScript 零错误（tsc --noEmit）；`npm test` 42/42；`verify:m4` 41/41；`verify:m6` 29/29；`verify:m7` 12/12；`verify:m8` 27/27；`verify:m9` 25/25；`verify:m9-real` 11/11；全部 100% 通过。
- `npm run build` 成功，`npm pack --dry-run` 白名单校验通过（无 `.env`/`src`/`policy.json`/`node_modules` 泄露），运行时显示 `fhcode v0.3.0`，署名信息完整。

## [0.2.3] — 2026-08-12（npm 可见度优化）

> 扩充 `package.json` 关键词 / 描述、README 增加 npm 徽章、对比表与一键安装 CTA，`feihong-cli` 别名包同源发布（bin 同为 `fhcode`）。

## [0.2.1] — 2026-08-11（M9.1 真实模型接入与实测调优）

> 让 `swe` 与常规命令可一键接入真实模型，并以 mock HTTP 服务实测"真实 provider 全链路"。

### 新增（Added）
- **三级供应商解析**：`loadConfig` 现依次支持 `FH_PROVIDERS`（JSON 数组）、`fhcode.config.json`（`models.providers`）、单环境变量快速接入（`FH_MODEL_NAME`/`FH_MODEL_TYPE`/`FH_MODEL_BASE_URL`/`FH_MODEL_API_KEY`/`FH_MODEL_TAGS`）。
- **`swe` 新增 `--max-iterations`**：控制每个子任务的模型推理轮数（真实模型建议 4~8，控成本/耗时）。
- **真实模型执行纪律强化**：`swe-planner` 增加"必须通过工具落地、必须真跑验证、禁谎报、只改相关文件"等约束；`swe-agent` 自愈注入改为携带验证命令的**真实输出**，更具可操作性。
- **真实接入就绪检查**：`fhcode swe` 在真实模式未配置任何供应商时给出明确的三种接入指引，避免盲目失败。
- **接入实测脚本** `scripts/verify-m9-real.mjs`：以本地 mock HTTP 服务（兼容 OpenAI / Ollama 协议）驱动 `swe` 走完整的"真实 HTTP provider → 编排器工具循环 → 验证器"链路，11 项断言全通过，无需任何外部模型。

### 校验（Verified）
- TypeScript 零错误；M4 企业能力验证 41/41 通过；M9 验证 25/25 通过；M9 真实接入实测 11/11 通过。

## [0.2.0] — 2026-08-11（M9 全自动软件工程 Agent）

> 新增全自动软件工程 Agent（M9），对标业界"读取仓库→拆解→改码→跑测试→验证"长链路自主开发范式。

### 新增（Added）
- **仓库读取器（repo-reader）**：扫描整个（大型）代码仓库，含文件数/体积限流、`.gitignore` 解析、语言分布、关键文件识别、测试/构建命令探测、目录树与上下文串。
- **任务拆解规划器（swe-planner）**：将目标拆解为有序、可独立验证的子任务（勘察→实现/修复/重构→测试→构建验证），每个子任务携带目标文件、验收标准与验证命令。
- **验证器（swe-verifier）**：根据仓库快照自动执行构建与测试，解析 exit code 与输出，判定每步/整体通过/失败，产出错误摘要供自愈注入。
- **全自动 Agent 主编排（swe-agent）**：读取仓库→规划→逐任务（委托 Orchestrator 实现 + 构建/测试验证 + 失败自愈重试）→ 产出结构化 `SweReport`；支持 `plan-only` / `verify-only` / `max-tasks` / `max-retries` 模式。
- **CLI 命令**：`fhcode swe "<目标>" [--repo PATH] [--plan-only] [--verify-only] [--max-tasks N] [--max-retries N]`。
- **验证脚本**：`scripts/verify-m9.mjs`（25 项离线断言，覆盖四阶段 + 自愈路径）。

### 校验（Verified）
- TypeScript 零错误；M4 企业能力验证 41/41 通过；M9 验证 25/25 通过。

## [0.1.0] — 2026-08-10（稳定版 / Stable）

> M4 企业级能力合入，fhcode 进入可稳定部署状态。

### 新增（Added）
- **企业级权限（RBAC）**：四角色矩阵（viewer / developer / operator / admin）+ deny 优先判定顺序；内置 23 条危险命令黑名单、11 类敏感路径黑名单；策略覆盖仅能加严（黑名单取并集）。
- **防篡改审计**：sha256 哈希链（按月切分 `audit-YYYY-MM.jsonl`），写入即链式校验；`audit verify` 可定位断点；日志脱敏（apiKey/secret/token/Bearer/sk- 等）。
- **多租户隔离**：物理目录隔离 `<FH_HOME>/tenants/<tenantId>/{sessions,audit,goals}`，租户 ID 正则校验 `^[A-Za-z0-9._-]{1,64}$` 防穿越；默认租户兼容旧版 `<FH_HOME>/sessions`。
- **成本治理**：单任务 `maxCostUsd` 熔断 + 租户日预算 `FH_TENANT_BUDGET_USD` fail-fast；`whoami` 展示用量。
- **企业命令**：`whoami` / `policy` / `audit [--limit N]` / `audit verify` / `tenants`。
- **CI 三流水线**：`build`（Node 18/20/22 矩阵 + 离线闭环）/ `enterprise`（41 项全离线断言 + 租户隔离）/ `security`（发布包白名单 + 明文密钥扫描 + npm audit），零 Secrets 全离线。
- **Web 管理控制台（BETA）**：`fhcode serve [--port 8080]`，Bearer Token 鉴权（fail-closed），只读观测 API（tenants/whoami/policy/audit/audit verify/sessions/quota）+ 原生静态仪表盘。
- 文档体系：README、用户手册、配置参考、架构与API、部署指南、常见问题、企业部署与合规、产品开发文档。

### 变更（Changed）
- `guard` 作为唯一权威闸门：策略判定 → 人工审批 → 审计留痕在工具执行前一次性完成；工具层不再二次弹审批（注入后 `security` 置空去重）。
- 向后兼容：未注入 guard 或 `FH_ENTERPRISE=false` 时行为同社区版（M3），无感降级。

### 安全（Security）
- 密钥仅存 gitignored `.env`，不回显完整 key；日志脱敏。
- 发布包白名单（`files` + `.npmignore`）双重保障：`.env` / `src` / `.workbuddy` 不随 `npm publish` 泄露。

---

## [0.0.x] — 里程碑演进（已提交）

- **M0+M1**：CLI 骨架 + 单代理闭环（需求解析 → 规划 → 工具调用 → 反思）。
- **M2**：多子代理并行编排（`/plan` `/grill` `/goal` 技能）。
- **B 方案**：接入真实模型（`.env` 加载器 + 联调验证）。
- **M3**：恢复与审计（`sessions`/`resume`/`diff`/`rollback` + 交互式审批流）。
- **M4**：见上 [0.1.0]。

### 进行中（In Progress）
- **M5 Web 管理控制台**：S1 服务骨架 + `serve` 命令已完成并验证（见 [0.1.0] BETA）；S2 观测 API / S3 前端仪表盘 / S4 安全加固 / S5 文档与 verify-m5 待推进。

---

## 署名

晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

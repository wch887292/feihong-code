# 飞虹 Code v0.4.0 — 复盘 + 对标 Codex 差距分析与提升路线图

**项目**：`H:\Muse Code复刻` (feihong-code v0.4.0)
**日期**：2026-08-16
**对标对象**：OpenAI Codex（CLI / IDE 扩展 / 桌面 App / Codex Web 云）
**数据来源**：本项目源码实测 + OpenAI Codex 官方文档检索（sandboxing / agent skills / subagents / MCP / model）

---

## 一、项目复盘（v0.4.0 现状）

### 1.1 已完成的能力矩阵

| 维度 | feihong-code v0.4.0 | 验证状态 |
|------|---------------------|----------|
| 核心循环 | ReAct 编排器（规划→工具执行→自愈→上下文压缩→经验回流） | ✅ M6 29/29 |
| 多模型路由 | 成本/能力/延迟策略 + fallback + 统计择优 + 自动落盘 | ✅ M6 |
| SWE Agent | 仓库读取→拆解→子任务实现+验证+自愈→报告（`swe` 命令） | ✅ M9 25/25 |
| 并行执行 | git worktree 隔离的多子代理并行（`--parallel`） | ✅ 部分覆盖 |
| 自我迭代 | 经验库（强化学习式 upsert/召回）+ 反思器回流 + 自愈 | ✅ M6 |
| 代码质量 | 质量门禁、代码审查、测试生成、复杂度扫描 | ✅ M7/M8 |
| 企业安全 | RBAC、审计哈希链、配额熔断、多租户、脱敏 | ✅ M4 41/41 |
| Web 控制台 | 双语仪表盘 + Bearer 鉴权 | ✅ 冒烟 |
| i18n | 中英双语全界面 | ✅ |
| 工具链 | 文件读写编辑/搜索/受管 shell/构建检查/测试运行 | ✅ |
| 环境自检 | `fhcode doctor` | ✅ 冒烟 |
| 验证体系 | 68 单测 + 134 里程碑断言全绿 | ✅ |

### 1.2 已知短板（技术债清单）
1. 无流式输出（逐字 token 流 / TUI 渲染），长任务体验静默。
2. 沙箱仅"白名单 + 审批"级，无操作系统级强制隔离。
3. 无 MCP 支持（README 写了 mcp 关键词但无实现）。
4. 无 Agent Skills 标准（`SKILL.md` / 渐进式加载）。
5. 无 IDE 集成（编辑器内 diff 审查、选区上下文）。
6. 无模型内部子代理分工（orchestrator/worker 模式）。
7. 无云端执行环境（本地独占，不可远程/CI 漂移）。
8. 无 Git 原生 PR/Issue 交互（仅本地 git 操作）。
9. 前端仅只读仪表盘，无任务交互控制台。
10. 无 eval/基准回归体系（SWE-bench 等可量化验证）。

---

## 二、Codex 现状（2026 年中，调研要点）

### 2.1 产品面
- **多端覆盖**：Codex CLI（开源 Rust）、IDE 扩展（VS Code/Cursor/Windsurf，选区上下文+就地 diff 审查）、ChatGPT 桌面 App、Codex Web 云（chatgpt.com/codex）、GitHub Actions 自动化。
- **云端**：云沙箱环境、任务可远程执行、scheduled automation。

### 2.2 技术面
- **OS 级沙箱**：macOS Seatbelt / Linux bubblewrap+seccomp / Windows 原生沙箱；三种模式（read-only / workspace-write / danger-full-access）+ 网络域名规则 + 本地/私网默认阻断 + 审批策略分层（sandbox 定边界、approval 定何时停下询问）。
- **Agent Skills 标准**：`SKILL.md`（name+description frontmatter）+ `references/` + `scripts/`；渐进式披露（元数据→指令→资源三级加载，初始列表 ≤2% 上下文）；仓库 `.agents/skills` / 用户 / 插件多级发现；与 AGENTS.md 互补。
- **子代理（subagents）**：编排器（gpt-5.4 类，planning/协调/终审）+ worker（gpt-5.4-mini 类，窄子任务并行）；模型/推理强度可配（agent 文件）；配额经济学（5×mini ≈ 1.5×主模型）。
- **模型矩阵**：gpt-5.4（日常/编排）、gpt-5.4-mini（30% 配额，探索/子任务）、gpt-5.3-codex（SWE 重活）、spark（实时迭代）；reasoning effort 分级（minimal→xhigh）。
- **MCP 生态**：config.toml 统一管理；插件可捆绑 MCP 服务器；官方示例含 GitHub（PR/Issue/Actions）、Playwright（浏览器）、Sentry、Figma、Context7（文档）。
- **上下文工程**：AGENTS.md 精简指引、技能渐进式加载、引用文件按需读取。

---

## 三、差距分析（按影响排序）

| # | 差距维度 | Codex | feihong-code v0.4.0 | 影响 | 差距等级 |
|---|----------|-------|---------------------|------|----------|
| G1 | **模型能力** | gpt-5.4 系列（闭源前沿） | 路由到用户自配的 DeepSeek/通义/Ollama 等 | 代码生成质量上限 | 🔴 结构性（依赖外部模型） |
| G2 | **OS 级沙箱** | Seatbelt/bubblewrap/Windows 原生强制隔离 | 词法白名单+审批（`run_shell` allowlist） | 自主性上限 | 🔴 大 |
| G3 | **MCP 生态** | MCP 服务器+插件+官方工具集 | 无 MCP（关键词仅 marketing） | 工具扩展性 | 🔴 大 |
| G4 | **子代理分工** | 编排器+worker 模型级分工 | 单模型多 worktree 并行（无模型分工） | 成本/速度 | 🟠 中 |
| G5 | **流式输出/TUI** | 实时 token 流+交互 TUI | 一次性 JSON 输出 | 体验/可观测 | 🟠 中 |
| G6 | **IDE 集成** | 选区上下文+就地 diff+编辑器内 review | 纯终端 | 工作流嵌入 | 🟠 中 |
| G7 | **Agent Skills** | SKILL.md 开放标准+渐进式加载 | 固定 3 个技能（/plan /grill /goal） | 扩展性 | 🟠 中 |
| G8 | **云端执行** | Codex Web 云沙箱+自动化 | 仅本地 | 场景覆盖 | 🟠 中 |
| G9 | **Git 平台交互** | GitHub MCP：PR/Issue/Actions | 仅本地 git（diff/rollback） | 协作闭环 | 🟡 小-中 |
| G10 | **eval/基准** | 内部 SWE-bench 等评估体系 | verify:m4–m9 冒烟断言 | 可量化改进 | 🟡 中 |
| G11 | **AGENTS.md 生态** | 项目指令+技能互补 | 有 AGENT-GUIDE.md（固定文档） | 上下文精度 | 🟡 小 |
| G12 | **上下文管理** | 技能渐进披露+引用按需加载 | 固定 system prompt+经验注入+压缩 | 长任务质量 | 🟡 小-中 |

**核心结论**：差距分两类——
1. **结构性差距（无法本地追赶）**：G1 模型智力。Codex 的 gpt-5.4 系列是闭源前沿，本项目作为开源工具只能"路由到最好的可用模型"，这是定位差异而非缺陷。
2. **工程性差距（完全可追赶）**：G2–G12 是工程实现问题，全部可在本仓库内落地。

---

## 四、提升路线图（按投入产出排序）

### P0 快速见效（1 轮迭代，低风险高感知）
| 项 | 目标 | 落地要点 |
|----|------|----------|
| 1. 流式输出 | 任务过程实时可见 | 编排器事件流 → `process.stdout` 增量打印（模型响应/工具调用/自愈逐步输出），先文本流后 TUI |
| 2. 沙箱升级 | 从"白名单"到"可证明边界" | 借鉴 Codex 三模式：`read-only` / `workspace-write` / `danger-full-access`；在现有 `safeJoin`+allowlist 上补**网络域名规则**（允许/阻断外连）与写路径限制的显式分级 |
| 3. MCP 客户端 | 打通工具生态 | 实现 MCP 客户端（stdio/SSE 传输 + 工具注册进 ToolRegistry），先支持 `GitHub` 与通用文档类 MCP 服务器；补真正的 README 说明 |
| 4. AGENTS.md 优先 | 项目上下文更精准 | 支持按仓库根/子目录加载 AGENTS.md 并注入 system prompt（替代固定 AGENT-GUIDE） |

### P1 核心增强（2–3 轮迭代）
| 项 | 目标 | 落地要点 |
|----|------|----------|
| 5. 子代理模型分工 | 成本-质量平衡 | 编排器用主模型，`swe`/并行子任务用低成本模型（已有 model-router 按策略选 provider，只需把"子任务用 mini/cheap 标签"接入路由） |
| 6. Agent Skills 标准 | 可扩展技能 | 实现 `SKILL.md` 解析器（name/description frontmatter + 渐进式加载），仓库 `.agents/skills` 发现，把现有 /plan /grill /goal 迁移为技能；初始技能列表 ≤2% 上下文预算 |
| 7. TUI 交互 | 体验对标 | 用 readline/ink 重写 REPL：状态行、审批内联、/mcp /skills 斜杠命令 |
| 8. Git 平台交互 | 协作闭环 | GitHub MCP 接入（PR 创建/审查、Issue 认领、Actions 触发），或轻量 REST 封装 |
| 9. eval 回归 | 可量化改进 | 基于现有 verify 脚本搭 `scripts/eval`：本地 mock 基准（任务完成率/工具效率/自愈率），每次迭代跑分对比 |

### P2 生态延展（后续）
| 项 | 目标 |
|----|------|
| 10. 云执行 | 轻量服务端（复用 enterprise/web 基建）支持远端任务队列 |
| 11. IDE 集成 | VS Code 扩展（选区上下文+diff 审查）或 LSP 桥 |
| 12. 插件分发 | 技能+连接器打包为可安装插件（对齐 Codex plugins） |

---

## 五、一句话总结

> **本项目在"工程骨架"上已具备 Codex 的绝大多数模块（编排/路由/SWE/企业安全/自我迭代），真正的差距是：① 前端体验（流式/TUI/IDE）② 生态标准（MCP/Skills/AGENTS.md）③ 隔离边界（OS 级沙箱）④ 模型分工与云端场景。前三项是本仓库完全可自行追赶的工程题，P0+P1 即可把"参照复刻"升级为"可日常自用的开源 Codex 平替"。**

---

*对比信息基于 2026-08 OpenAI Codex 官方文档检索，模型代号与产品功能以官方为准。*

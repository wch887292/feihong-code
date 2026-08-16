# 终端 AI 编程 Agent 横向对比 —— Claude Code / Codex CLI / Gemini CLI vs feihong-code v0.4.0

**项目**：`H:\Muse Code复刻` (feihong-code v0.4.0)
**日期**：2026-08-16
**对标**：Claude Code / OpenAI Codex CLI / Google Gemini CLI（2026 年中官方文档 + 源码检索）

---

## 一、四方能力矩阵

| 维度 | Claude Code | Codex CLI | Gemini CLI | feihong-code v0.4.0 |
|------|-------------|-----------|------------|---------------------|
| **模型** | 仅 Claude 系列（闭源，推理强） | GPT 系列优先（闭源前沿） | Gemini（**1M token 上下文**，免费层 1000 请求/天） | **多模型路由**（DeepSeek/通义/Ollama/OpenAI 兼容，开源自由） |
| **沙箱/权限** | permissions + **hooks 确定性护栏**（PreToolUse 可拒绝） | **OS 级沙箱三模式**（Seatbelt/bubblewrap/Windows） | approval modes + plan mode | 白名单+审批+**三模式沙箱**（v0.4 已做）+ 网络域名规则 |
| **技能标准** | Skills（SKILL.md 渐进式加载） | Agent Skills（≤2% 上下文索引） | Agent Skills（预览） | **SKILL.md 标准**（v0.4 已做，load_skill 按需加载） |
| **子代理** | Subagents（隔离上下文）+ **Agent teams**（相互通信）+ **嵌套 5 层** | 编排器 gpt-5.4 + worker mini 并行 | subagents + generalist agent + JIT 上下文注入 | **并行 worktree + swe 子任务**（v0.4 已加 cheap 模型分工） |
| **项目上下文** | CLAUDE.md + `.claude/rules/`（路径级）+ 压缩 | AGENTS.md | GEMINI.md + **JIT 上下文发现** + 压缩服务 | AGENTS.md（v0.4 已做）+ 经验库 + 压缩 |
| **MCP** | ✅（插件可捆绑） | ✅（config.toml + 插件） | ✅（含 Imagen/Veo 等生成类） | ✅ **stdio 客户端**（v0.4 已做） |
| **确定性控制** | **hooks 事件系统**（edit/tool/session 生命周期） | 沙箱+审批策略 | persistent approvals | 无（仅审批） |
| **插件生态** | **Plugins + 市场**（技能/hooks/子代理/MCP 打包） | plugins | 自定义扩展/命令 | 无 |
| **IDE 集成** | ✅ VSCode 扩展 | ✅ VS Code/Cursor/Windsurf | 终端优先 | 无 |
| **云端执行** | ✅ 云 | ✅ Codex Web + 自动化 | 可脚本化（非交互） | 本地仅 |
| **搜索 grounding** | 无内置 | — | ✅ **Google Search** | 无 |
| **会话恢复** | ✅ | ✅ | ✅ checkpointing + token caching | ✅ resume（M3） |
| **免费/开源** | 订阅制 | 订阅/API | **免费层** + Apache 2.0 | **MIT 开源、零成本** |

---

## 二、关键差距（按影响排序）

### 🔴 结构性差距（开源工具天然无法本地追赶）
1. **模型智力**：三家都绑自家前沿闭源模型（Claude 推理 / GPT-5.4 / Gemini 1M）。本项目只能路由到"市面可用模型"，这是定位差异，不是缺陷。但本项目也因此是**唯一不绑定厂商**的方案——用户自选模型，这是差异化卖点。

### 🟠 工程性差距（完全可在本仓库内落地）
2. **确定性控制（hooks）**：Claude Code 独有的事件系统（文件编辑后自动跑 linter、工具调用前可拒绝、会话开始注入 prompt）。本项目只有"审批"一种控制手段，缺少"**确定性脚本钩子**"。
3. **子代理深度**：Claude Code 子代理可**嵌套 5 层**、Agent teams 相互通信；Gemini 有 JIT 上下文注入 + generalist 路由。本项目子任务是"worktree 隔离 + 结果汇总"，**无隔离上下文摘要返回**（子任务全量结果回主上下文）、无嵌套。
4. **上下文管理精度**：Gemini 的 JIT 发现（按文件操作注入相关规则）与 Claude 的路径级 rules（`paths` frontmatter，只在操作相关文件时加载）比本项目的"整份 AGENTS.md 常驻"更省 token。
5. **TUI 交互**：Gemini 的 sticky headers / mouse support / 无闪烁渲染；本项目的 REPL 仍是基础 readline。
6. **插件打包分发**：三家（Claude 最成熟）都能把技能+hooks+MCP 打包成可安装单元；本项目技能是散装目录。
7. **IDE 集成**：Claude/Codex 都有扩展；本项目纯终端。
8. **云端/远程执行**：Codex Web 云沙箱、Claude Code 云；本项目仅本地。
9. **搜索 grounding**：Gemini 内置 Google Search；本项目无实时信息检索工具。

### 🟡 已追平/超前的项（可作宣传点）
- **多模型路由**：三方都绑定单厂商，本项目支持任意 OpenAI 兼容/Ollama 本地，**唯一离线可用**。
- **企业安全**：RBAC + 审计哈希链 + 多租户 + 配额熔断，三家终端 CLI 均无此深度（Claude 的 admin settings 是组织级，但不开源）。
- **自我迭代闭环**：经验库强化学习回流 + 自愈 + eval 跑分，开源工具中少见。
- **i18n**：中英双语界面，三家皆英文。

---

## 三、提升路线（按投入产出排序）

### P2 快速见效（下轮可做）
| # | 项 | 对齐谁 | 落地要点 |
|---|----|--------|----------|
| 1 | **hooks 事件系统** | Claude Code | `PreToolUse`（工具调用前可拒绝）/ `PostToolUse`（调用后跑命令，如 lint）/ `PostEdit`（文件编辑后）/ `SessionStart`；配置驱动（`hooks: [{event, command}]`），在 ToolRegistry.execute 前后触发，零上下文成本 |
| 2 | **子代理摘要返回** | Claude Code | `runSubTask` 结果改为"摘要 + 元数据"回主上下文（截断大输出），真正隔离中间结果 |
| 3 | **路径级规则** | Claude / Gemini JIT | AGENTS.md 支持 `paths` frontmatter：只读仓库级指令，操作相关文件时才注入对应规则（省 token） |

### P3 核心增强（后续）
| # | 项 | 对齐谁 | 落地要点 |
|---|----|--------|----------|
| 4 | **插件打包** | Claude plugins | `plugin.json` 打包 skills + hooks + MCP 配置，`fhcode plugin install` 分发 |
| 5 | **TUI 升级** | Gemini | sticky header（成本/迭代/状态常驻）、鼠标支持、无闪烁渲染（readline 重写） |
| 6 | **搜索工具** | Gemini grounding | 新增 `web_search` / `web_fetch` 工具（受沙箱网络规则约束），接入实时信息 |
| 7 | **子代理嵌套** | Claude | 子代理可再派生子代理（有深度上限），复杂任务树形分解 |
| 8 | **IDE 扩展** | Claude/Codex | VS Code 扩展（选区上下文 + diff 审查）或 LSP 桥 |

### P4 生态延展
| # | 项 | 对齐谁 |
|---|----|--------|
| 9 | 云端执行 | Codex Web |
| 10 | Agent teams（多实例互发消息） | Claude Code |

---

## 四、一句话结论

> **工程骨架层面，本项目已具备三家 80% 的核心机制**（技能/子代理/MCP/沙箱/项目上下文），当前最大真实差距是：
> ① **hooks 确定性控制**（Claude 独有，工程上最有价值）② **子代理上下文隔离** ③ **上下文精度管理**（JIT/路径级规则）。
> 而这三点恰好都是"纯工程题"，**完全可以在本仓库内自研补齐**。模型智力差距则由"多模型路由 + 离线可用 + 企业安全"这三个三家都没有的差异化卖点对冲——开源平替的定位是成立的。

---

*调研基于 2026-08 Claude Code / Gemini CLI / Codex 官方文档与仓库检索，能力表述以官方为准。*

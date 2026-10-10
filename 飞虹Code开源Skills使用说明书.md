# 飞虹 Code 开源 Skills 使用说明书

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
> 版本：2026-10-08 ｜ 适用：`fhcode`（飞虹 Code）v8.x
> 交付物位置：`H:\Muse Code复刻\.fhcode\skills\`

---

## 一、本说明书是什么

本说明书配套**已经安装**到飞虹 Code 的 6 个开源 Agent-Skills。它们原本是 Claude Code / Cursor 生态的社区技能，现已被逐一定制为飞虹 Code 的 `SKILL.md` 格式（frontmatter + 触发/执行/输出），放入 `.fhcode/skills/` 目录，开箱即用。

| # | Skill 目录名 | 名称 | 上游仓库 |
|---|---|---|---|
| 1 | `rea` | REA 逆向工程助手 | morluto/rea |
| 2 | `engineering-skills` | 工程实战技能包 | mattpocock/skills |
| 3 | `diagram-design` | 专业图表设计 | cathrynlavery/diagram-design |
| 4 | `agent-skills` | 全生命周期开发技能包 | addyosmani/agent-skills |
| 5 | `i-have-adhd` | 简洁输出模式 | ayghri/i-have-adhd |
| 6 | `claude-mem` | 持久记忆 | thedotmack/claude-mem |

> 说明：`rea`、`i-have-adhd` 基于官方 README 真实内容适配；`engineering-skills`、`diagram-design`、`agent-skills`、`claude-mem` 因目标网络策略无法抓取原始仓库文件，基于官方公开资料与公认实现适配，功能口径一致。

---

## 二、安装位置与机制

- 飞虹 Code 的 Skills 统一放在：`H:\Muse Code复刻\.fhcode\skills\<目录名>\SKILL.md`
- 每个 Skill 是一个文件夹 + 一个 `SKILL.md`，采用 YAML frontmatter（`name` / `description`）+ 正文（触发 / 执行步骤 / 输出格式 / 边界）。
- 结构示例（已存在）：
  ```
  .fhcode\skills\
  ├── rea\SKILL.md
  ├── engineering-skills\SKILL.md
  ├── diagram-design\SKILL.md
  ├── agent-skills\SKILL.md
  ├── i-have-adhd\SKILL.md
  └── claude-mem\SKILL.md
  ```

---

## 三、各 Skill 使用说明

### 3.1 REA 逆向工程助手（`rea`）
- **用途**：逆向分析原生二进制、JS/Electron 应用（含 ASAR）、.NET 程序集、APK、固件、网站；不依赖源码解释功能原理并输出带证据的结论。
- **使用方式**：直接告诉飞虹 Code"帮我逆向分析 X / 弄懂这个功能怎么实现的"。
- **一次性初始化**：
  ```bash
  npx rea-agents setup          # 注册 MCP + 工作流
  npx -y rea-agents@latest doctor
  ```
- **依赖**：静态 JS/Electron 分析无需引擎；原生二进制需已装 Hopper / Ghidra 12.1.x / IDA Pro。

### 3.2 工程实战技能包（`engineering-skills`）
- **用途**：真实工程流程的 5 个子技能 —— 需求拷问 / TDD / 代码评审 / 架构优化 / 任务拆解。
- **使用方式**：
  - "把这个需求先拷问清楚" → 需求拷问
  - "先写测试再实现" / "修复这个 bug" → TDD
  - "帮我 review 这段改动" → 代码评审
  - "架构怎么优化" → 架构优化
  - "这个大功能怎么拆" → 任务拆解

### 3.3 专业图表设计（`diagram-design`）
- **用途**：生成架构图、UML、ER 图、用户旅程图、流程图，输出 HTML/SVG，含品牌配色与 WCAG AA 对比度校验。
- **使用方式**："帮我画一个 XX 系统的架构图 / 用户旅程图"，可直接得到能放进文档/博客的图。
- **载体**：HTML / SVG（首选），可同步导出 Mermaid / Excalidraw。

### 3.4 全生命周期开发技能包（`agent-skills`）
- **用途**：覆盖需求 → 方案 → 编码 → 测试 → 安全审计 → 代码评审 → 发布上线的完整 SDLC，内置代码审查员、测试工程师、安全审计三种角色。
- **使用方式**："按生产级标准把这个功能从需求做到上线"，或单独要求安全审计 / 代码评审。
- **安全审计视角**：OWASP Top 10（注入 / XSS / 敏感信息 / 权限 / 依赖风险）。

### 3.5 简洁输出模式（`i-have-adhd`）
- **用途**：输出风格控制 —— 行动优先、步骤编号、去掉所有"希望有帮助"式废话。
- **使用方式**：要求"精简直给、别废话、直接告诉我做什么"；或通过 `fhcode` 指令 `/i-have-adhd` 开启。
- **关闭**：说"stop adhd mode"。

### 3.6 持久记忆（`claude-mem`）
- **用途**：跨会话保存项目上下文，自动压缩、语义检索，新会话自动注入历史记忆。
- **使用方式**："我们之前不是讨论过 X 吗"、希望换会话后仍记住决策与踩坑。
- **一次性初始化**：
  ```bash
  npx claude-mem install
  ```
- **存储**：SQLite + Chroma 向量检索；Web 面板管理。**敏感信息（密钥/token/隐私）不写入记忆库。**

---

## 四、新增 / 卸载 / 自定义 Skill

### 4.1 手动新增
```bash
mkdir -p .fhcode/skills/<名字>
# 创建 SKILL.md，含 frontmatter(name/description) + 触发/执行/输出
```

### 4.2 从社区仓库安装（可选，按官方 `skills` CLI）
```bash
npx skills add <owner/repo>            # 通用安装
# 单个 skill 指定安装，如 REA：
npx skills add morluto/rea --skill reverse-engineer-anything
```
> 安装后建议按飞虹 Code 格式核对一遍 `SKILL.md` 的 frontmatter 与正文结构。

### 4.3 卸载
直接删除对应目录即可：
```bash
Remove-Item -Recurse -Force .fhcode/skills/<名字>
```

### 4.4 自定义
- 改 `SKILL.md` 正文即改行为；`description` 用于触发识别，建议写清楚"何时用"。
- 修改后重启会话生效。

---

## 五、常见问题

| 问题 | 处理 |
|---|---|
| 安装后 Skill 没生效 | 确认目录在 `.fhcode\skills\` 下、文件名为 `SKILL.md`、frontmatter 完整，重启会话 |
| REA 无法分析原生程序 | 先 `rea doctor --provider ghidra --json` 确认引擎健康；引擎多选冲突时用 `--provider` 指定 |
| claude-mem 不注入记忆 | 确认 `npx claude-mem install` 成功且重启会话；Web 面板检查记忆库 |
| 想装其他社区 Skill | 用 `npx skills add <owner/repo>` 或手动复制，再按 4.2 说明校对格式 |
| 想批量管理 | 直接维护 `.fhcode/skills\` 目录，结构与 Cursor/Claude 的 skills 目录兼容 |

---

## 六、维护建议
- 定期核对上游仓库更新（尤其 REA、claude-mem 这类依赖版本的工具型 Skill）。
- 保持每个 Skill 只做一件事，`description` 描述"触发场景"而非"实现细节"，便于飞虹 Code 自动命中。
- 涉及权限、外部部署、写共享系统的动作，仍按飞虹 Code 审批策略执行（`FH_REQUIRE_APPROVAL`）。

# AGENT-GUIDE.md — 面向 AI Agent 的使用指南

> **本文档专为 AI Agent 设计**，提供快速上手所需的环境、配置、工具契约与最佳实践。
>
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 版本：0.4.0 | 2026-08-16

---

## 一、项目简介

**飞虹 Code（fhcode）** 是一款运行在终端的 AI 编程智能体，支持：

- **自然语言 → 代码闭环**：描述需求，自动规划、编写、验证
- **多模型路由**：DeepSeek / 通义 / Ollama（本地）/ OpenAI 兼容
- **企业级安全**：RBAC、审计链、多租户、配额熔断
- **全自动软件工程**：`swe` 命令可自主完成仓库级开发任务

**GitHub**：`github.com/wch887292/feihong-code`（待上线）

---

## 二、环境要求

```bash
# 必需
Node.js >= 18（推荐 20 或 22）
npm >= 9

# 可选但推荐
git（--parallel 模式需要 worktree）
tsx（开发模式）
```

**验证环境**：
```bash
node --version  # 应 >= 18.0.0
npm --version   # 应 >= 9.0.0
```

---

## 三、快速安装

### 方式一：从源码构建（推荐）
```bash
git clone https://github.com/wch887292/feihong-code.git
cd feihong-code
npm install
npm run build
```

### 方式二：全局安装
```bash
npm install -g feihong-code
fhcode --version  # 验证安装
```

---

## 四、模型配置（关键）

### 4.1 环境变量优先级
1. `FH_PROVIDERS`（JSON 数组，最高优先级）
2. `fhcode.config.json`（项目配置文件）
3. 单环境变量 `FH_MODEL_*`（快速接入）

### 4.2 Ollama 本地模型（推荐测试）
```bash
export FH_MODEL_NAME=qwen3:8b
export FH_MODEL_TYPE=ollama
export FH_MODEL_BASE_URL=http://localhost:11434
export FH_MODEL_TAGS=code-gen,reasoning,local
```

### 4.3 DeepSeek（推荐生产）
```bash
export FH_PROVIDERS='[{"name":"deepseek","type":"openai-compatible","baseUrl":"https://api.deepseek.com/v1","apiKey":"sk-...","tags":["code-gen","reasoning"],"priority":1}]'
```

### 4.4 离线 Mock（测试）
```bash
export FH_OFFLINE=true
# 或使用空 providers
export FH_PROVIDERS='[]'
```

### 4.5 沙箱三模式（P0-2，对齐 Codex）
```bash
export FH_SANDBOX_MODE=read-only            # 只读勘察（禁写禁执行）
export FH_SANDBOX_MODE=workspace-write      # 工作区可写（默认，shell 受白名单+审批）
export FH_SANDBOX_MODE=danger-full-access   # 全权限（危险命令黑名单仍生效）

# 网络域名规则（作用于 run_shell 命令中的 http(s) 目标）
export FH_NETWORK_DENY=evil.example.com     # 命中即拦截（任意模式生效）
# export FH_NETWORK_ALLOW=api.example.com    # 配置后未命中即拦截
```

### 4.6 MCP 外部工具（P0-3）
```bash
export FH_MCP_SERVERS='[{"name":"github","command":"npx","args":["-y","github-mcp-server"]}]'
# 远程工具以 <serverName>_<tool> 前缀注册（如 github_list_issues），沙箱/守卫同样生效
```

### 4.7 仓库级指令（P0-4）
在仓库根或任意目录放置 `AGENTS.md`（或 CLAUDE.md / .atomcode.md），
任务启动时自动发现并注入 system prompt（限 8KB），无需任何配置。

### 4.8 hooks 确定性控制（P2-1）
```bash
# FH_HOOKS：JSON 数组。PreToolUse 非零退出会拦截工具调用；PostToolUse/PostEdit 只记录
export FH_HOOKS='[
  {"event":"PreToolUse","command":"node scripts/guard.js","tools":["run_shell"]},
  {"event":"PostEdit","command":"npx eslint --fix {path}","paths":["src/"]}
]'
# 占位符: {cwd} {tool} {path} {runId} {ok}
```

### 4.9 AGENTS.md 路径级规则（P2-3）
带 `paths` frontmatter 的规则只在操作相关文件时按需注入（JIT，省 token）：
```markdown
---
paths: ["src/**", "tests/**"]
---
src 与 tests 目录规则：改动必须附带单元测试。
```
无 `paths` 的正文作为全局指令常驻注入。

### 4.10 插件分发（P3-3）
```bash
# 安装插件（本地目录或 git URL；清单 plugin.json 打包 skills + hooks + MCP）
fhcode plugin install ./my-plugin
fhcode plugin install git@github.com:user/my-plugin.git
fhcode plugin list                     # 列出已安装插件
```
插件目录结构：`plugin.json`（必含 name/version）+ 可选 `skills/<name>/SKILL.md`、`hooks`、`mcp` 配置。安装后自动生效（技能入索引、hooks/MCP 叠加）。

### 4.11 实时信息检索（P3-2）
内置 `web_search`（默认 DuckDuckGo，`FH_SEARCH_ENDPOINT` 可换端点）与 `web_fetch` 工具，
目标域名受沙箱网络规则约束（FH_NETWORK_ALLOW/DENY）。

### 4.12 云执行任务队列（P4-1）
```bash
# 启动 Web 控制台（含 /api/tasks 任务队列，服务端静默执行）
fhcode serve --port 8080

# 提交任务（Bearer 鉴权）
curl -X POST http://localhost:8080/api/tasks \
  -H "Authorization: Bearer $FH_WEB_TOKEN" -H "Content-Type: application/json" \
  -d '{"goal":"写一个 hello.ts"}'
# 查询: GET /api/tasks 列表 · GET /api/tasks/:id 单任务
```
并发上限默认 2，可用 `FH_TASK_CONCURRENCY` 调整。

### 4.13 Agent teams 多 agent 协作（P4-2）
```bash
# 目标自动拆解为任务清单，多 agent 并发认领执行，消息总线汇报
fhcode team "实现登录模块 并且 添加用户管理 并且 写集成测试"
```
内置消息总线（TeamBus）与共享任务清单（TaskBoard，原子认领防重复），逐任务结果摘要回传。

### 4.14 调度入口与消息渠道（P5-2 / P5-6）
```bash
# 任务状态 webhook（CI/外部系统编排）: FH_TASK_WEBHOOK_URL 或 POST /api/webhook {"url":"..."}
# 消息渠道推送（任务状态变化通知）
export FH_CHANNEL_TELEGRAM_BOT_TOKEN=bot:xxx
export FH_CHANNEL_TELEGRAM_CHAT_ID=12345
export FH_CHANNEL_WECOM_KEY=key1,key2        # 企业微信群机器人（可多个）
```

### 4.15 Docker 沙箱（P5-4）
```bash
export FH_SANDBOX_MODE=container             # shell 在容器内执行（docker run 挂载工作区）
export FH_SANDBOX_IMAGE=node:22-alpine        # 容器镜像（默认）
```

### 4.16 语义索引与 VSCode 扩展（P5-5 / P5-3）
- 符号索引：`symbol-index.ts` 自动提取函数/类/接口符号并缓存（FH_HOME/symbol-index.json），供 /grill 与 swe 聚焦
- VSCode 扩展：`vscode-extension/` 目录，`fhcode.run` / `fhcode.diff` 命令，配置 `fhcode.binaryPath` / `fhcode.offline`

### 4.17 Skills 市场（agentskills.io 对接）
```bash
# 搜索市场技能（默认 agentskills.io；--repo 或 FH_SKILL_MARKET 换源）
fhcode skill-market search "code review"

# 安装到 ~/.feihong-code/skills/（安装后任务中自动发现，渐进式披露）
fhcode skill-market install code-review

# 列出本地已安装技能
fhcode skill-market list
```
市场源协议：站点暴露 `/.well-known/agent-skills/index.json`（agentskills.io discovery 规范），
支持 SKILL.md 直下与 tar.gz 归档（sha256 digest 校验防篡改，路径穿越防护）。

---

## 五、典型工作流

### 5.1 单任务执行
```bash
# 基础用法
fhcode "实现一个 HTTP 服务器，监听 3000 端口"

# 带约束
fhcode --max-iterations 10 --yes "修复 src/auth.ts 中的 token 验证 bug"

# 流式输出（P0-1：任务过程实时可见）
fhcode --stream "重构 src/calc.ts 的 add 函数"
```

### 5.2 并行子任务
```bash
# 自动拆分目标，worktree 隔离执行
fhcode --parallel "实现登录模块 并且 添加用户管理 并且 写集成测试"
```

### 5.3 全自动软件工程
```bash
# 读取整个仓库 → 规划 → 实现 → 验证 → 报告
fhcode swe "修复 src/calc.ts 的 add 函数 bug，让 tests/calc.test.ts 通过" \
  --repo /path/to/project \
  --max-tasks 3 \
  --max-iterations 5
```

### 5.4 只读技能
```bash
# 生成实现计划
fhcode /plan "实现登录并且添加支付"

# 红队审查（安全审计）
fhcode /grill src/

# 目标跟踪
fhcode /goal
```

### 5.5 技能标准（P1-2，SKILL.md）
内置 /plan /grill /goal 已迁入打包技能 `skills/<name>/SKILL.md`（open agent skills 兼容）：
- 模型侧：技能索引（name+description）常驻 system prompt，正文由 `load_skill` 工具按需加载（渐进式披露）
- 自定义技能：在仓库 `.agents/skills/<name>/SKILL.md` 或用户级 `~/.feihong-code/skills/<name>/SKILL.md` 放一个带 frontmatter 的 SKILL.md 即自动发现
```markdown
---
name: my-skill
description: 何时触发该技能
---
技能指令正文
```

### 5.6 跑分基准（P1-3）
```bash
npm run build && npm run eval        # 本地 mock 跑分（完成率/工具效率/自愈率）
npm run build && npm run eval -- --json   # 结构化输出（横向对比用）
```

### 5.7 子代理模型分工（P1-1）
`swe` / `--parallel` 的子任务自动带 `['code-gen','cheap']` 标签路由：
低成本 provider（FH_PROVIDERS 中带 `"cheap"` 标签）优先承担子任务，主任务仍走 code-gen。
未配置 cheap 标签时自动回退全部 provider，无感。

---

## 六、工具调用契约

### 6.1 工具清单
| 类别 | 工具 | 说明 |
|------|------|------|
| 文件 | `write_file` | 写入/覆盖文件 |
| 文件 | `edit_file` | 插入/删除/替换文本 |
| 文件 | `read_file` | 读取文件内容 |
| 文件 | `list_files` | 列出目录内容 |
| 搜索 | `grep` | 正则搜索 |
| Shell | `run_shell` | 执行命令 |
| 验证 | `build_check` | 检查编译 |
| 验证 | `run_tests` | 运行测试 |

### 6.2 工具参数格式
所有工具调用遵循 JSON Schema：
```json
{
  "tool_calls": [
    {
      "type": "function",
      "function": {
        "name": "write_file",
        "arguments": "{\"path\":\"src/main.ts\",\"content\":\"export const x = 1;\"}"
      }
    }
  ]
}
```

### 6.3 工具返回格式
```json
{
  "tool_call_id": "call_abc123",
  "output": "已写入 src/main.ts（25 字节）",
  "error": null
}
```

---

## 七、错误处理

### 7.1 常见错误码
| 错误码 | 含义 | 处理建议 |
|--------|------|----------|
| `FH_4001` | 配额超限 | 等待重置或申请配额 |
| `FH_4003` | 权限拒绝 | 检查 RBAC 策略 |
| `FH_5001` | 模型调用失败 | 检查 provider 配置 |
| `FH_5002` | 上下文压缩失败 | 使用 /plan 重新规划 |
| `FH_6001` | 文件路径越权 | 检查沙箱规则 |

### 7.2 调试技巧
```bash
# 查看详细日志
export FH_LOG_LEVEL=debug
fhcode "你的任务"

# 查看会话历史
fhcode sessions

# 恢复上次会话
fhcode resume <session-id>
```

---

## 八、企业部署

### 8.1 必需环境变量
```bash
export FH_ENTERPRISE=true
export FH_TENANT=my-org
export FH_USER=agent-sa
export FH_ROLE=developer
export FH_WEB_TOKEN=<web-console-token>
```

### 8.2 Web 控制台
```bash
# 启动服务
fhcode serve --port 8080

# 访问
# http://localhost:8080
```

---

## 九、验证套件

```bash
# 全量验证
npm run verify

# 单项验证
npm run verify:m4  # 企业能力
npm test           # 单元测试
node scripts/verify-m9.mjs  # SWE 能力
```

---

## 十、联系与反馈

- **GitHub Issues**：提交 bug 或功能请求
- **文档**：详见 `docs/` 目录
- **署名**：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

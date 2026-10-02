# 飞虹 Code 外部 MCP 工具源（Git / 数据库 / Figma / 浏览器 / 主机能力补全）

晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

本目录提供若干**独立 stdio MCP 服务器**，挂到飞虹 Code 配置（`~/.feihong-code/fhcode.config.json` 的 `mcp.servers`）后，飞虹 Code（智能体）即可调用其工具，成为它的"手"。

> 协议：MCP stdio（JSON-RPC 2.0, NDJSON），与飞虹 Code 的 `McpClient` 对齐（`protocolVersion: 2024-11-05`）。工具名在飞虹 Code 侧以 `<serverName>_*` 前缀注册。

---

## 1. Git 仓库服务器 `git-mcp.js`（源名 `git`）

让飞虹 Code 直接**审分支、看改动、看历史**，从而在"改代码 → 自测 → 提交"链路里自主理解仓库状态、按需提交。

**安全设计**：默认全部只读（status/log/diff/show/branch/remote/stash）；写操作（add/commit/create_branch/checkout）必须显式传 `confirm:true`，且 `commit` 不自动 push，避免误推/误删。

工具（`git_*`）：
| 工具 | 作用 |
|---|---|
| `git_status` | 工作区状态（porcelain，含暂存/未暂存/未跟踪） |
| `git_current_branch` | 当前分支名 |
| `git_branch_list` | 列本地/远程分支（标注当前 `*`） |
| `git_log` | 提交历史（oneline，count 可配） |
| `git_diff` | 查看改动（staged / 单文件可选） |
| `git_show` | 某次提交的完整 patch |
| `git_remote_list` | 远程仓库列表 |
| `git_stash_list` | stash 栈 |
| `git_add` ⚠️写 | 暂存文件（需 `confirm:true`） |
| `git_commit` ⚠️写 | 当前分支提交（需 `confirm:true`，不自动 push） |
| `git_create_branch` ⚠️写 | 基于 HEAD 建并切换分支（需 `confirm:true`） |
| `git_checkout` ⚠️写 | 切换分支/文件（需 `confirm:true`） |

---

## 2. 数据库服务器 `db-mcp.js`（源名 `db`）

让飞虹 Code 直接**查库、列表明细、看表结构**，理解业务数据、核对结果、辅助生成 SQL/报表。

**引擎**：
- **SQLite（默认，零依赖，Node 内置 `node:sqlite`）**：环境变量 `DB_PATH` 指向 `.db` 文件。
- **MySQL / PostgreSQL（可选）**：`DB_ENGINE=mysql|postgres` + `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`；驱动 `mysql2` / `pg` 需另行安装到 Node 工作区。

**安全设计（重要）**：默认只读（仅允许 `SELECT/WITH/PRAGMA/EXPLAIN/SHOW`）；任何写语句（`INSERT/UPDATE/DELETE/DROP/ALTER`）必须显式传 `allowWrite:true`，且服务器二次校验语句类型，未授权一律拒绝；不在日志/返回中泄露密码。

工具（`db_*`）：
| 工具 | 作用 |
|---|---|
| `db_engine_info` | 当前引擎与连接状态（不含密码） |
| `db_list_tables` | 列出所有表/视图 |
| `db_describe` | 查看某表字段结构 |
| `db_query` | 执行 SQL（`allowWrite:true` 才放行写语句） |

> 本目录附带 `_demo.db`（users / orders 两张示例表），`fhcode.config.json` 中 `db` 源默认指向它，可立即试用 `db_query`。生产环境请把 `DB_PATH` 改为你的真实库文件，或切到 MySQL/Postgres。

---

## 3. Figma 设计稿服务器 `figma-mcp.js`（源名 `figma`）

让飞虹 Code 读取 Figma 设计稿结构、导出节点为图片、读取评审评论，辅助"设计 → 代码"落地。

**鉴权**：环境变量 `FIGMA_TOKEN`（Figma Personal Access Token，见 https://www.figma.com/developers/api#access-tokens）。未设置时调用会返回明确指引，不影响飞虹 Code 启动。

> 说明：Typora 等"纯 GUI 本地编辑器"没有可编程接口，无法直接桥接为 MCP；本地文档自动化可用 `desktopplus` 的 `host_file_*` 操作 `.md` 文件替代。

工具（`figma_*`）：
| 工具 | 作用 |
|---|---|
| `figma_get_file` | 读取文件结构（文档树/页面/画板/组件） |
| `figma_get_nodes` | 读取指定节点详细结构 |
| `figma_get_image` | 导出节点为图片（PNG/JPG/SVG/PDF），返回 URL |
| `figma_get_comments` | 读取评审评论（作者/时间/内容） |

---

## 4. 浏览器服务器 `browser-mcp.js`（源名 `browser`）

用本机 **Microsoft Edge（Chromium 内核）** 驱动网页自动化，让飞虹 Code 能"打开网页 / 截图取证 / 取 HTML 文本 / 点击填充 / 执行 JS / 读控制台"，从而**验证它改出来的前端效果**。依赖 `puppeteer-core`（本机需已装 Edge，或设 `EDGE_PATH`）。

工具（`browser_*`）：`browser_launch / navigate / screenshot / get_html / get_text / click / fill / evaluate / console / close`（共 10 个）。

---

## 5. 主机能力补全服务器 `desktopplus-mcp.js`（源名 `desktopplus`）

补齐 `desktop-touch-mcp`（GUI 级）所缺的**编程式**主机能力：干净跑 shell、读写剪贴板、操作任意主机文件（不依赖 VS Code 是否打开）。剪贴板依赖 Windows；文件写操作对 `C:/Windows` 设硬性护栏。

工具（`desktopplus_*`）：`host_shell / host_file_read / host_file_write / host_file_list / clipboard_read / clipboard_write`（共 6 个）。

---

## 接入方式

在 `~/.feihong-code/fhcode.config.json` 的 `mcp.servers` 加入对应条目（当前仓库配置已含全部源）。示例：

```json
{
  "name": "git",
  "command": "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe",
  "args": ["H:/Muse Code复刻/mcp-servers/git-mcp.js"],
  "initTimeoutMs": 15000, "callTimeoutMs": 120000
},
{
  "name": "db",
  "command": "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe",
  "args": ["H:/Muse Code复刻/mcp-servers/db-mcp.js"],
  "env": { "DB_ENGINE": "sqlite", "DB_PATH": "H:/Muse Code复刻/mcp-servers/_demo.db" },
  "initTimeoutMs": 15000, "callTimeoutMs": 120000
},
{
  "name": "figma",
  "command": "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe",
  "args": ["H:/Muse Code复刻/mcp-servers/figma-mcp.js"],
  "env": { "FIGMA_TOKEN": "" },
  "initTimeoutMs": 15000, "callTimeoutMs": 60000
}
```

启动飞虹 Code 即自动挂载 `git_*` / `db_*` / `figma_*` 等全部工具。

## 验证

已用最小 MCP 客户端走 `initialize → tools/list → tools/call` 端到端验证：git（12 工具，含写操作护栏）、db（SQLite 实跑，含只读护栏）、figma（无 token 优雅报错，协议通）全部 PASS。

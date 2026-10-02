# 飞虹 Code VS Code 扩展

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 版本 8.5.0 ｜ 与主项目 feihong-code 版本号保持一致（check:version 闸门强制）

在 VS Code / Qoder 等 VS Code 兼容 IDE 中直接使用飞虹 Code：侧边栏 AI 对话、选中代码解释/重构、结果一键插入编辑器。

## 架构：VS Code 作为飞虹 Code 的 MCP 工具源（核心定位）

本扩展不仅让"人在 VS Code 里用飞虹 Code"，更关键的是把 **VS Code 本身变成飞虹 Code 的一个工具扩展**——飞虹 Code（智能体）通过 MCP 直接调用 VS Code 的能力去创作 / 修改 / 优化代码。

```
飞虹 Code（智能体 / MCP 客户端）
   │  spawn stdio MCP 服务器（mcp-bridge.js）
   ▼
mcp-bridge.js  ──(TCP 127.0.0.1:9599, NDJSON)──►  VS Code 扩展内 mcp-server.js
                                                          │  vscode.* API
                                                          ▼
                                              读/写/改文件 · 列文件 · 搜索 · 跑命令 · 诊断 · 执行命令
```

为什么拆两层：飞虹 Code 的 MCP 客户端是 **stdio-only**（spawn 子进程 + JSON-RPC）；而 `vscode.*` API 只能在扩展宿主内调用。因此由"扩展内 socket 服务"持有真实能力，"stdio 桥"只做协议转换与转发（断线自动重连）。

**开放给飞虹 Code 的 `vscode_*` 工具：**

| 工具 | 作用 |
|---|---|
| `vscode_read_file` | 读工作区文件全文 |
| `vscode_write_file` | 新建/覆盖写文件（自动建父目录） |
| `vscode_edit_file` | 精确字符串替换（SEARCH/REPLACE，可 replace_all） |
| `vscode_list_files` | 按 glob 列文件 |
| `vscode_get_active_editor` | 取当前正在编辑的文件路径+内容 |
| `vscode_open_file` | 在编辑器打开并激活文件 |
| `vscode_search_in_files` | 按关键字搜索文件内容，返回命中行 |
| `vscode_run_terminal` | 在工作区跑 shell 命令并捕获输出（如 `npm test`/`npm run build`） |
| `vscode_get_diagnostics` | 取 TS/ESLint 等诊断（报错/警告） |
| `vscode_execute_command` | 执行任意 VS Code 命令（格式化/重构/任务等） |

**如何启用（已默认配置好）：** 飞虹 Code 的 `~/.feihong-code/fhcode.config.json` 的 `mcp.servers` 已加入：
```json
{ "name": "vscode", "command": "C:/Program Files/nodejs/node.exe",
  "args": ["H:/Muse Code复刻/vscode-extension/mcp-bridge.js"],
  "initTimeoutMs": 20000, "callTimeoutMs": 120000 }
```
前提：**微软 VS Code 需处于打开状态且已加载本扩展**（左侧出现「飞虹 Code」图标，扩展在宿主内启动 9599 socket）。飞虹 Code 启动时自动 spawn 桥并挂载 `vscode_*` 工具；VS Code 晚开也能在桥重连后生效（下次会话）。

## 功能

- 💬 **侧边栏 AI 对话**：与 Web 控制台同源的任务链路（建任务 → 轮询 → 多轮续接）
- 📝 **右键命令**：选中代码 → 「飞虹 Code: 解释选中代码」/「重构选中代码」
- 🧩 **代码一键插入**：回复中的代码块悬停显示「插入」按钮，直接替换选区或新开文件
- 🤖 **驱动模式（AI 直接改文件）**：开启后飞虹 Code 作为 VS Code 内置编码代理，读当前文件、生成改动并**真实写回工作区**（改已有文件 / 新建文件），无需手动复制
- ⏹️ **任务控制**：状态栏实时显示执行进度（步骤数），支持中途「停止」；「清空(新任务)」重新开任务
- 🔐 **F2 签名协议**：写请求自动携带 HMAC-SHA256 签名（x-fh-ts / x-fh-nonce / x-fh-sig），密钥 = 会话令牌，与服务端防重放闸门对齐

## 驱动模式（核心能力）

飞虹 Code 不只是"聊天"，而是直接**调用 VS Code 能力创作 / 修改 / 优化代码**：

1. 面板顶部点 **🤖 驱动:关** 切到 **🤖 驱动:开**（或按 `Ctrl+Alt+A`）；
2. 在输入框下指令，例如："给当前文件加输入校验""把这个函数抽成独立模块""新建一个 utils/format.ts"；
3. 扩展自动把**当前活动文件的完整内容**作为上下文发给飞虹 Code；
4. 飞虹 Code 用结构化块返回改动：
   - 改已有文件：\`\`\`fh-edit 块（path + SEARCH/REPLACE 差异）
   - 新建文件：\`\`\`fh-newfile 块（path + 完整内容）
5. 扩展解析后**真实写入磁盘**并打开首个改动文件，面板汇总"已应用 N 处改动"。

> 未打开工作区时退化为临时文档打开；SEARCH 片段须能唯一匹配，匹配不到的改动会被跳过并提示。
> 右键「重构选中代码」会**强制走驱动模式**自动改文件。

## 安装

1. 启动飞虹 Code 后端：项目根目录运行 `一键启动Web控制台.bat`（或 `node start-web.js --port=8082`）
2. IDE → 扩展 → `···` → 从 VSIX 安装 → 选择 `feihong-code-8.5.0.vsix`
   （或命令行：`code --install-extension feihong-code-8.5.0.vsix`）
3. 点击左侧活动栏「飞虹 Code」图标，在设置中填好手机号后即可对话

## 配置

IDE 设置中搜索 `feihong-code`：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `feihong-code.serverUrl` | `http://127.0.0.1:8082` | 后端服务地址（云端可填 `https://api.klai.top/fhrelay` 等） |
| `feihong-code.phone` | 空 | 登录手机号（6-20 位数字，本地服务免验证码；首次发消息时也会弹窗询问） |
| `feihong-code.token` | 空 | 访问令牌（高级：配置后跳过手机号登录） |

## 对话链路（技术说明）

```
POST /api/auth/login {phone}                    → 换取会话令牌（免签）
POST /api/tasks {goal}                          → 创建任务（需 F2 签名）
GET  /api/tasks/:id                             → 轮询状态 queued/running/done/failed（免签读）
POST /api/tasks/:id/messages {message}          → 多轮续接（需 F2 签名，任务运行中返回 409）
POST /api/tasks/:id/stop                        → 中止任务（需 F2 签名）
```

签名规则：`sig = HMAC-SHA256(token, "${ts}|${nonce}|${bodyRaw}")`，头 `x-fh-ts`（毫秒时间戳）/ `x-fh-nonce`（随机 hex）/ `x-fh-sig`；时间窗 ±5 分钟，nonce 防重放。

## 排障

- **连接失败**：确认后端已启动、`serverUrl` 端口与实际一致（curl `http://127.0.0.1:8082/api/health`）
- **401 缺少签名**：扩展版本过旧，重新安装本 vsix
- **409 运行中**：上一任务未结束，等待完成或点「停止」
- **任务不存在**：服务端重启会清空任务队列，点「清空(新任务)」重新发起

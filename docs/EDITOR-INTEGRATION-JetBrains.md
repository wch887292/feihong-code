# JetBrains 接入指南（飞虹 Code ↔ IntelliJ 系 IDE）

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 版本 8.11.0 · 2026-10-19

本文档说明飞虹 Code 如何在 JetBrains 系 IDE（IntelliJ IDEA / PyCharm / GoLand / WebStorm 等）中使用，以及原生插件的演进路线。

## 背景与取舍

飞虹 Code 是 TypeScript/Node.js 单体仓库（CLI + Web 服务 + VS Code 扩展）。JetBrains 原生插件需以 Kotlin/Java + IntelliJ Platform SDK 开发并独立构建/发版，与当前单体工程隔离；因此在 v8.11 阶段采用"**协议对接优先**"策略，三条路径均可直接使用，原生插件列入路线图（见文末）。

| 路径 | 适用场景 | 需要安装 | 交互深度 |
|---|---|---|---|
| **A. JetBrains MCP 客户端**（推荐） | IDE 内直接调用飞虹 Code 的 MCP 工具 | 无（JetBrains 2024.2+ 内置 MCP） | 高：工具调用（读文件/写文件/跑命令/对话） |
| **B. ACP / AI Assistant 对接** | 让 JetBrains AI Assistant 代理访问飞虹 Code | 无（2025.1+ 支持自定义 ACP 服务器） | 中：对话与代码生成 |
| **C. HTTP 控制台** | 浏览器/IDE 内嵌 WebView 使用 Web 控制台 | 无 | 全：Web 控制台全部功能 |

## A. JetBrains MCP 客户端接入（推荐）

JetBrains 2024.2+ 内置 MCP（Model Context Protocol）支持，可直接把飞虹 Code 注册为 MCP 服务器。

飞虹 Code 自带两个 MCP 服务：

1. **主 MCP 服务（stdin/stdout）**：`node src/tunnel/mcp-server.ts`（`MCP_SERVER_VERSION = 8.11.0-tunnel`），暴露对话、任务、代码生成等工具。
2. **VS Code 桥（127.0.0.1:9599）**：仅当 VS Code 已打开且加载扩展时可用，向 MCP 客户端暴露 `vscode_*` 工具。

### 配置步骤（Settings → Tools → MCP → Add）

- 类型：`STDIO`
- 名称：`feihong-code`
- 命令：
  - Windows：`C:\Program Files\nodejs\node.exe`
- 参数：`H:\feihong-code\src\tunnel\mcp-server.ts`
- 工作目录：`H:\feihong-code`

启动后 IDE 侧出现 `feihong-code` 工具组，即可在 AI Assistant 中调用飞虹 Code 能力。

> 前提：飞虹 Code 后端已启动（`一键启动Web控制台.bat`）；首次调用需在 Web 控制台完成手机号登录，MCP 服务复用其凭据与账号隔离。

### 自定义 MCP 服务器（2025.1+，可选）

JetBrains 2025.1 支持自定义 MCP 服务器，可把飞虹 Code 封装为 remote MCP（HTTP + SSE），由 `src/tunnel/mcp-server.ts --sse` 提供（若启用），便于多 IDE 共享。

## B. ACP（Agent Client Protocol）对接

JetBrains 2025.1+ 的 AI Assistant 支持自定义 ACP 服务器。飞虹 Code 的 Anthropic Messages 协议 Provider（`anthropic-messages.provider.ts`，v8.10.1+）与 OpenAI 兼容 Provider 均已就绪，可作为 ACP 后端：

- **协议端点**：飞虹 Code 内置 OpenAI 兼容 / Anthropic Messages 网关（Web 服务 `/v1/chat/completions` 等）。
- **配置**：在 AI Assistant 中把 API 地址指向飞虹 Code 网关（如 `http://127.0.0.1:8080`），模型选择飞虹 Code 已配置的 provider 模型。
- **凭据**：走 v8.11 账号体系（手机号+密码）或令牌，不向 IDE 暴露真实第三方 Key（凭据环境作用域内引用）。

> 注意：ACP 面向"AI Assistant 直连后端"场景；如需 IDE 工具调用（读写文件等），优先路径 A（MCP）。

## C. HTTP 控制台（零安装兜底）

- 启动后端后浏览器打开 `http://127.0.0.1:8080` 即 Web 控制台（对话 / 模型管理 / 任务 / 轨迹 / 沙箱）。
- JetBrains 内置浏览器（Tools → Web Browser）或系统浏览器均可使用，功能与 Web 完全一致。

## 验证清单

1. `curl http://127.0.0.1:8080/api/health` → `{ok:true,...}`（后端在线）
2. MCP 面板出现 `feihong-code` 且状态为连接中/已连接
3. 向 IDE AI Assistant 发送"读一下 H:\feihong-code\README.md 并总结" → 工具调用成功返回

## 路线图：原生 JetBrains 插件（P1）

| 阶段 | 内容 |
|---|---|
| v8.12（计划） | 以 `IntelliJ Platform Plugin` 骨架建立 `jetbrains-plugin/` 独立模块；基于 ACP/MCP 封装最小对话框（项目视图 + 对话窗 + 右键"飞虹 Code"菜单） |
| v8.13+ | 工具调用落地（打开文件/应用改动/运行命令）、账号登录对话框、驱动模式（AI 直接改文件） |
| 依赖 | 需要 JetBrains IDE 运行实例做插件调试与发版（本机已装 IDEA 则可直接开展） |

> 决策记录：原生插件与 VS Code 扩展共用协议层（REST/MCP/ACP），不共享 UI 代码（JetBrains 为 Kotlin/Swing，VS Code 为 TypeScript/WebView）。

# 飞虹 Code VS Code 扩展（薄壳）

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

把 **飞虹 Code（对标 Muse Code / fhcode）** 接入 VS Code：编辑器内**行内补全** +
侧边栏**对话式 Agent**。逻辑全部下沉到本地 `fhcode serve`，本扩展只做 UI 与协议桥接（薄壳原则）。

## 为什么是薄壳

- 不重复实现 Agent、补全引擎、上下文压缩——这些都在 `fhcode` 核心里。
- 扩展只负责：把光标前后缀发给 `/api/completion`、把对话发给 `/api/tasks` 并轮询结果。
- 因此你能直接在 VS Code 里用上"**企业机房里私有运行的 Cursor**"，数据不出域。

## 前置条件

1. 安装并可用 `fhcode`（本仓库 `npm i -g .` 或桌面版）。
2. 启动本地服务（二选一）：
   - 终端：`fhcode serve`（默认 `http://localhost:8080`）
   - 桌面版 Electron：自动起在 `http://localhost:8081`

## 安装（免构建）

方式 A —— 已解压扩展（开发最快）：
1. 复制整个 `vscode-extension/` 文件夹到 VS Code 的扩展目录：
   - Windows：`%USERPROFILE%\.vscode\extensions\feihong-code-vscode`
   - macOS/Linux：`~/.vscode/extensions/feihong-code-vscode`
2. 重启 VS Code。

方式 B —— 打包后安装：
```bash
cd vscode-extension
npm install -g @vscode/vsce   # 仅需一次
vsce package --no-dependencies
code --install-extension feihong-code-vscode-1.0.0.vsix
```

## 配置

设置项（`设置 → 飞虹 Code`）：
| 项 | 默认 | 说明 |
|---|---|---|
| `fhcode.serverUrl` | `http://localhost:8080` | 服务地址（桌面版填 8081） |
| `fhcode.token` | 空 | 若服务用固定 `FH_WEB_TOKEN` 启动，填这里；否则自动登录 |
| `fhcode.phone` | `vscode-local` | 自动登录用的本地标识（无短信） |
| `fhcode.modelId` | 空 | 任务默认模型 |
| `fhcode.enableInlineCompletion` | `true` | 行内补全开关 |

## 使用

- 打开任意代码文件，正常输入即可触发行内补全（右侧灰色提示，Tab 接受）。
- 点击左侧活动栏的"飞虹 Code"图标打开对话面板，输入任务，Agent 在本地执行并回传结果。
- 选中代码 → 命令面板 `飞虹 Code: 把选中代码作为任务发给 Agent`。

## 已实现 / 路线图

- ✅ 行内补全（对接 `/api/completion`，含 O2 客户端轻量后处理）
- ✅ 对话面板（对接 `/api/tasks` + 轮询 `/api/tasks/:id`）
- ✅ 选中即发、连接状态栏
- 🔜 补全接受反馈回流（接 `/api/completion/accept` 做连续推荐）
- 🔜 任务改动可视化（`/api/changes` 一键接受/拒绝 hunk）
- 🔜 与编辑器诊断联动（把 lint/报错作为上下文发给 Agent）

## 协议

MIT — 晋江市飞虹智科技企业管理有限公司

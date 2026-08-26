# 飞虹 Code VSCode 插件

AI 编程智能体 VSCode 扩展，提供实时代码补全、AI 聊天助手、多文件变更审批等能力。

## 功能特性

### 🤖 AI 聊天助手
- 侧边栏对话界面，支持 Markdown 渲染和代码块
- 选中代码后右键：解释、重构、生成测试
- 一键添加当前文件到对话上下文
- 代码块直接插入到编辑器光标位置

### ⚡ 实时代码补全
- **内联补全（ghost text）**：灰色提示文本，Tab 接受
- **补全弹窗**：Ctrl+Space 触发，↑↓ 选择，Enter 接受
- **快速路径**：闭合括号/引号、自动补分号、常见片段（<10ms）
- **多级缓存**：精确匹配 + 前缀匹配，减少重复请求
- 支持所有编程语言

### 📝 变更审批
- TreeView 展示 AI 生成的所有变更
- 逐文件接受/拒绝
- 冲突高亮显示
- 一键提交所有已接受变更

### ⌨️ 快捷键
| 命令 | Windows/Linux | macOS |
|---|---|---|
| 打开 AI 聊天 | `Ctrl+Shift+F` | `Cmd+Shift+F` |
| 开关内联补全 | `Ctrl+Alt+C` | `Cmd+Alt+C` |
| 触发补全 | `Ctrl+Space` | `Ctrl+Space` |
| 接受内联补全 | `Tab` | `Tab` |

## 配置项

| 配置 | 默认值 | 说明 |
|---|---|---|
| `feihong-code.backendUrl` | `http://localhost:3717` | 飞虹 Code 后端服务地址 |
| `feihong-code.enableInlineCompletions` | `true` | 启用内联代码补全 |
| `feihong-code.completionMode` | `quick` | 补全模式：quick/full |
| `feihong-code.completionDebounceMs` | `300` | 补全请求防抖延迟 |
| `feihong-code.apiKey` | `""` | API 密钥（如后端启用鉴权） |

## 安装使用

### 1. 启动后端服务
```bash
# 在飞虹 Code 项目根目录
npm install
npm run build
npm start
# 默认监听 http://localhost:3717
```

### 2. 安装插件
```bash
cd vscode-extension
npm install
npm run compile
# 在 VSCode 中按 F5 启动扩展开发宿主
# 或使用 vsce 打包：npm run package
```

### 3. 配置后端地址
- 命令面板（Ctrl+Shift+P）→ "飞虹 Code: 设置后端服务地址"
- 或在设置中修改 `feihong-code.backendUrl`

## 开发

```bash
cd vscode-extension
npm install
npm run watch  # 监听编译
# 在 VSCode 中按 F5 调试
```

## 架构

```
vscode-extension/
├── src/
│   ├── extension.ts      # 入口：激活、命令注册、Provider 注册
│   ├── api.ts            # 后端 API 客户端（补全/聊天/变更）
│   ├── completion.ts     # 补全 Provider（内联 + 弹窗）
│   ├── chat-view.ts      # AI 聊天侧边栏（Webview）
│   └── changes-view.ts   # 变更审批侧边栏（TreeView）
├── media/
│   └── icon.svg          # 插件图标
├── package.json          # 扩展清单
└── tsconfig.json         # TypeScript 配置
```

## License

MIT © 晋江市飞虹智科技企业管理有限公司

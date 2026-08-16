# fhcode VSCode 扩展（最小可用壳）

飞虹 Code 的 VSCode 入口扩展。**不含 Agent 逻辑**，仅作为编辑器侧薄壳：
调起 `fhcode` CLI 执行任务、查看会话 diff。

## 安装

1. 安装 fhcode CLI：`npm i -g feihong-code`（或本地 `npm run build` 后 `npm link`）
2. 在本目录执行打包：`npx @vscode/vsce package`，或直接 F5 调试加载

## 使用

| 命令 | 说明 |
|------|------|
| `fhcode: 运行任务` | 输入目标 → 调起 `fhcode "<目标>"`，输出流式写入 Output Channel |
| `fhcode: 查看工作区 diff` | 调起 `fhcode diff` 展示变更 |

## 配置

| 键 | 默认 | 说明 |
|----|------|------|
| `fhcode.binaryPath` | `fhcode` | CLI 可执行文件路径 |
| `fhcode.offline` | `false` | 以离线 mock 模式运行（无模型环境验证用） |

> 扩展仅透传命令；沙箱/审批/企业策略均由 CLI 侧执行，行为与终端一致。

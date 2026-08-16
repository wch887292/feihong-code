# fhcode VSCode 扩展

飞虹 Code 的 VSCode 入口扩展。**不含 Agent 逻辑**，仅作为编辑器侧薄壳：
调起 `fhcode` CLI 执行任务、就地查看工作区 diff。

## 安装

1. 安装 fhcode CLI：`npm i -g feihong-code`（或本地 `npm run build` 后 `npm link`）
2. 在本目录执行打包：`npx @vscode/vsce package`，或直接 F5 调试加载

## 使用

| 命令 | 说明 |
|------|------|
| `fhcode: 运行任务（附带选区上下文）` | 输入目标执行；**自动检测选中代码**，可选把选区作为 `<selection>` 上下文注入目标 |
| `fhcode: 内联评审当前文件` | 调起 `fhcode review <file> --json`，发现以**编辑器内联诊断**展示（critical/high=红、medium=黄、low=蓝），悬停看详情、快速修复看建议 |
| `fhcode: 就地查看工作区 diff` | 列出已跟踪变更文件，用 VSCode **原生 diff 编辑器**展示 HEAD ↔ 工作区 |
| `fhcode: 查看最近任务输出` | 聚焦任务 Output Channel |

## 配置

| 键 | 默认 | 说明 |
|----|------|------|
| `fhcode.binaryPath` | `fhcode` | CLI 可执行文件路径 |
| `fhcode.offline` | `false` | 以离线 mock 模式运行（无模型环境验证用） |
| `fhcode.reviewOnSave` | `true` | 保存文件后自动运行内联评审 |

> 扩展仅透传命令；沙箱/审批/企业策略均由 CLI 侧执行，行为与终端一致。
> diff 面板通过 `git show HEAD:<path>` 提供左侧内容，需 git 仓库（与 `fhcode diff` 一致）。

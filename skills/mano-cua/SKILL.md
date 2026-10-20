---
name: mano-cua
description: 飞虹 Code 的"眼睛"——屏幕视觉与 GUI 自动化能力。当任务需要看到屏幕内容、操作桌面应用或浏览器页面（没有 API/CLI 可用的目标）时使用。基于明略科技 Mano-P GUI-VLA 模型（云端模式）。
---

# mano-cua：fhcode 的眼睛（屏幕视觉 / GUI 自动化）

fhcode 是终端智能体，本身没有屏幕视觉。本技能接入明略科技开源的 mano-cua（Mano-P GUI-VLA 模型客户端），赋予 fhcode **看屏幕 + 操作 GUI** 的能力。

## 何时使用本技能

- 用户要求操作桌面应用：如"打开微信告诉某人某事""在记事本里记录 XX"
- 需要视觉验证浏览器/桌面页面的实际渲染效果（fhcode 只能抓 HTTP，看不了真实渲染界面时）
- 目标应用没有任何 API/CLI，只能通过图形界面操作
- 需要描述当前屏幕上有什么内容（截图理解）

**不适用**：有 API/CLI/代码手段完成的任务优先用代码完成；后台常驻监控（本技能不支持）；副显示器（仅主显示器）。

## 调用方式

可执行文件：`C:\Users\Administrator\Tools\mano-cua\mano-cua.exe`（如实际部署路径不同，以 `C:\Users\Administrator\Tools\mano-cua\` 下 dir 结果为准）

```cmd
"C:\Users\Administrator\Tools\mano-cua\mano-cua.exe" run "任务描述"
"C:\Users\Administrator\Tools\mano-cua\mano-cua.exe" run "任务描述" --url "https://example.com" --minimize --max-steps 15
"C:\Users\Administrator\Tools\mano-cua\mano-cua.exe" run "任务描述" --app "记事本"
"C:\Users\Administrator\Tools\mano-cua\mano-cua.exe" stop
"C:\Users\Administrator\Tools\mano-cua\mano-cua.exe" --help
```

- `--app` 与 `--url` 二选一，用于先聚焦目标应用/网页再开始任务，能显著提高成功率
- `--max-steps` 限制步数（默认建议 10~20，防止跑飞）
- `--minimize` 最小化右上角状态面板
- **任务描述要具体**：模糊指令（"查查 AI 新闻"）要改写成明确可执行的步骤（"在百度搜索人工智能新闻并打开第一条结果"）
- 停止当前任务用 `stop`；同一设备同时只能跑一个任务，开新任务前先 stop

## 推理模式（重要）

- **Windows 仅支持云端模式**：截图 + 任务描述经 HTTPS 发送到 `mano.mininglamp.com` 推理，返回操作指令后本地执行。`--local`（本地 MLX 推理）仅限 macOS Apple Silicon，Windows 上禁止使用。
- 云端模式涉及云端 shell 工具辅助（v1.1.0+），可用 `config --set disable-bash true` 关闭。

## 安全与隐私红线（必须遵守）

1. **云端模式会把主显示器截图发送到外部服务器**——启动任务前必须提醒用户收起屏幕上的敏感信息（密码、聊天记录、财务数据、客户资料）。
2. 涉及**购买、发送消息、删除数据、输入凭证**等敏感/不可逆操作，必须先向用户确认任务描述本身，确认后才下发。
3. 不向 mano-cua 下达访问密码管理器、凭证存储、剪贴板敏感内容的任务。
4. 任务执行期间用户键鼠会被接管——下发前必须告知用户不要碰键鼠，任务可随时 `stop` 或点屏幕右上角面板停止。
5. 每次调用后如实向用户报告执行结果（成功/失败/停在确认环节），不夸大、不隐瞒失败。
6. 本技能不绕过系统权限弹窗、不接触存储密码/token/cookie。

## 退出码判读（重要，2026-10-08 冒烟实测）

- **mano-cua run 任务正常完成后也会 exit 1**（关闭 UI 后输出 `can't open file for write!` 属良性清理噪音）——**判定成功与否只看输出末尾的 `Status:` 行**：`SUCCESS` / `MAX_STEP_REACHED`（步数上限，属正常终止，可加大 --max-steps 或拆分任务重试）/ `STOPPED` 等均为任务已真实执行；不要因 exit 1 而误判失败重试。
- 报错 `Another task is already running on this device` = 上一个会话未清，先执行 `stop` 再重试（stop 成功输出 `Session stopped: <id>`）。
- **任务描述优先用英文**：GBK 控制台传中文参数可能引发客户端异常；中文需求先翻译成具体英文指令再下发。
- 模型推理输出为英文，向用户汇报时翻译成中文。

## 故障排查

- exe 无法运行：用 `dir "C:\Users\Administrator\Tools\mano-cua"` 确认实际文件名与路径
- 命令行输出乱码：命令前加 `chcp 65001`
- 任务卡住：先 `stop` 再重新下发更具体的任务描述
- 网络失败：云端模式需要能访问 `mano.mininglamp.com`

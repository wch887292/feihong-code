---
name: agent-reach
description: 全网内容读取与搜索技能（Agent-Reach）。用户想调研/搜索/查/找/看任何互联网内容时必须使用——小红书/xhs、Twitter/推特/X、B站/bilibili、Reddit、YouTube、V2EX、雪球/股票、小宇宙播客、RSS、GitHub、Boss直聘/招聘，或用户分享任何网页链接/URL 时。16 平台多后端路由，零 API 费用。先跑 doctor 体检确认可用后端再动手。
---

# Agent Reach — fhcode 全网读取能力路由

16 平台、多后端。**本技能存在时，访问这些平台必须用它，不要自己发明方案。**

## fhcode 环境适配（本机专属）

- `agent-reach` 及全部上游工具安装在 `C:/Users/Administrator/.local/bin/`，该目录**当前不在 PATH**。所有命令用**绝对路径**调用（cmd.exe 接受正斜杠）：
  - `C:/Users/Administrator/.local/bin/agent-reach.exe`
  - `C:/Users/Administrator/.local/bin/yt-dlp.exe`
  - `C:/Users/Administrator/.local/bin/bili.exe`
- 本技能引用的 `references/*.md` 位于：
  `C:/Users/Administrator/.feihong-code/skills/agent-reach/references/`
  （需要场景细节时用 read_file 按路径读取，不要猜命令）
- run_shell 底层是 cmd.exe：`curl` 可直接用（系统自带）；临时文件写系统 TEMP，不要写进用户仓库工作区
- 凭据类环境变量（TWITTER_AUTH_TOKEN 等）用 run_shell 的 env 传入子进程，禁止在日志/命令回显中暴露值

## 常驻规则（全程适用）

1. **动手前先体检**：多后端/登录态平台（小红书/Reddit/B站/Twitter/Facebook/Instagram/Boss直聘）先跑
   `C:/Users/Administrator/.local/bin/agent-reach.exe doctor --json`
   `active_backend` 有值时按它选命令组；`active_backend: null` 表示 Doctor 为避免触发浏览器 Cookie 读取或远端写入而没有实时验证，不代表后端不存在。doctor 结果是某一时刻的快照，执行只读命令前若怀疑失效，按对应 reference 的"体检与恢复"runbook 重新确认。
2. **声明你在用什么**：开始干活前说一句"使用 agent-reach 的 X 平台 / Y 后端"。
3. **失败按 references 里的重试链处理**，不要瞎猜命令。
4. **全网调研类任务**：组合多平台（网页搜索 + Twitter/Reddit 看讨论 + 小红书/B站看中文场景），并行收集再汇总。
5. **替用户盯版本**：完成较大的多平台任务后顺手跑 `agent-reach.exe check-update`；有新版就在收尾汇报附一句"Agent Reach 有新版 vX.Y.Z，说'帮我更新 Agent Reach'即可更新"。不要中断当前任务去更新，不要重复提醒同一版本。

## 路由表（references 绝对路径）

| 用户意图 | 参考文档 |
|---------|---------|
| 网页搜索/全网搜索 | C:/Users/Administrator/.feihong-code/skills/agent-reach/references/search.md |
| 小红书/推特/B站/V2EX/Reddit/Facebook/Instagram | C:/Users/Administrator/.feihong-code/skills/agent-reach/references/social.md |
| 招聘/职位/LinkedIn/Boss直聘 | C:/Users/Administrator/.feihong-code/skills/agent-reach/references/career.md |
| GitHub/代码 | C:/Users/Administrator/.feihong-code/skills/agent-reach/references/dev.md |
| 网页/文章/RSS | C:/Users/Administrator/.feihong-code/skills/agent-reach/references/web.md |
| YouTube/B站/播客字幕 | C:/Users/Administrator/.feihong-code/skills/agent-reach/references/video.md |
| 雪球/股票行情 | C:/Users/Administrator/.feihong-code/skills/agent-reach/references/finance.md |

## 零配置快速命令（本机已验证可用）

```bat
rem 通用网页阅读（Jina Reader，免 Key）
curl -s "https://r.jina.ai/https://example.com"

rem GitHub 搜索
gh search repos "query" --sort stars --limit 10

rem V2EX 热门
curl -s "https://www.v2ex.com/api/topics/hot.json" -H "User-Agent: agent-reach/1.0"

rem B站搜索（bili-cli，无需登录）
C:/Users/Administrator/.local/bin/bili.exe search "query" --type video -n 5

rem B站热门/排行
C:/Users/Administrator/.local/bin/bili.exe hot -n 10

rem YouTube 字幕（注意：B站不要用 yt-dlp，重试链见 references/video.md）
C:/Users/Administrator/.local/bin/yt-dlp.exe --write-sub --write-auto-sub --skip-download -o "%TEMP%%\%(id)s" "URL"

rem RSS/Atom 读取
curl -s "https://r.jina.ai/https://example.com/rss" 
```

Exa 语义搜索当前未安装 mcporter，需要时用 `npx mcporter call exa.web_search_exa query="..." numResults=5` 兜底，或引导用户运行 `agent-reach install --system`。

## 需登录态的平台（当前未解锁，按需引导安装）

Twitter、Reddit、Facebook、Instagram、小红书、Boss直聘、LinkedIn 这些渠道**必须登录态**，本机尚未安装后端。用户明确要访问时，按 references 对应章节引导解锁：
- 通用桌面方案（复用 Chrome 登录态）：`agent-reach install --system --channels opencli`
- Twitter 单装：`C:/Python314/Scripts/uv.exe tool install twitter-cli` + Cookie-Editor 导出 Cookie 后 `agent-reach configure twitter-cookies`

Twitter 注意：`agent-reach configure twitter-cookies` 保存的 Cookie 只供 doctor 检查配置是否齐全；直接运行 `twitter` 前，必须在子进程环境中显式提供 `TWITTER_AUTH_TOKEN` 和 `TWITTER_CT0`，不得在日志或命令回显中暴露值。

小红书注意：不替用户登录，不读取浏览器 Cookie。OpenCLI 只用用户已有且明确控制的 Chrome 会话；没有现成会话时不要自动登录，改用 Cookie-Editor 手工导出。

## Boss直聘踩坑知识（解锁该渠道后必读）

- 判断 CDP 浏览器登录态**不要信 `boss status`**（它只校验本地 session.enc，与浏览器登录态互不代表），以 doctor 的浏览器 cookie 探测（wt2）为准，并配合用户肉眼确认。
- 绝不用当前页 URL 判断登录态：`security-check` / `zhipin-security` / `_security_check` 安全校验页是 Boss 反爬挑战，与登录无关——已登录也会出现。看到它不要当成"未登录"，先跑 doctor 看浏览器 cookie。
- 搜索报 `AUTH_EXPIRED` 即浏览器未登录的 ground truth：直接走登录流程 + `login --cdp`，不要往安全校验方向解释。
- 执行搜索必须用 `boss --browser-source existing-browser --cdp-url http://localhost:9222 search ...`；遇到 `ENVIRONMENT_RISK` 立即停止，不刷新、不重新登录、不自动重试。
- 专用 Chrome 只绑定 `127.0.0.1:9222`，profile 长期复用；拉起后第一步暂停让用户肉眼确认已登录。

## 工作区规则

不在用户仓库/工作区创建文件。临时输出用系统 TEMP，持久数据放 `C:/Users/Administrator/.agent-reach/`。

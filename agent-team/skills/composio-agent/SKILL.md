---
name: composio-agent
description: 通过 Composio SDK + 大模型 AI Agent 连接并操作 1500+ 外部应用（Gmail/Google 邮箱、Google Sheets 表格、HubSpot/Salesforce/Zoho CRM、Slack、Google 日历、LinkedIn、Notion、GitHub 等），用自然语言自动完成「搜索工具 → OAuth 连接 → 执行操作」闭环。触发场景：用户提到 composio、让 AI 自动发邮件/读邮件/回邮件、把线索写入表格或 CRM、预约日历会议、连接/操作第三方 SaaS 应用、销售获客自动化（自动发跟进邮件、客户资料入库、多应用联动）、搭建能调用外部工具的 AI Agent 等任务；需要用已接入的 Qwen 大模型驱动 Composio 工具时使用。
---

# Composio Agent（外部应用自动化 AI 员工）

让大模型像人一样操作各类外部应用：一句中文指令，Agent 自动搜索合适工具、检查连接、调用执行并汇报。底层为 Composio（1500+ 应用）+ OpenAI 兼容大模型（当前已接入 AMD 平台 Qwen3.8-Flash-Next）。

## 项目位置与环境

- 代码目录：`C:\Users\Administrator\Doubao\chats\2026-09-14\new-chat-1\composio-sdk`
- 运行环境：Node.js ≥ 22.22.3（已装 v22.23.2），依赖 `@composio/core`（已安装，无需联网重装）
- 配置文件 `.env`（已配好，已在 .gitignore，禁止外发/提交 git）：
  - `COMPOSIO_API_KEY`：Composio **Project API Key**，必须是 `ak_` 开头（`ck_` 开头是 MCP 专用 consumer key，SDK 用不了）
  - `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`：大模型三件套（当前为 AMD Qwen，已验证可用）
  - `COMPOSIO_USER_ID`：用户标识，多用户隔离用，当前 `sales_user_001`
- `.env` 必须用**无 BOM 的 UTF-8** 保存（PowerShell `Set-Content -Encoding UTF8` 会加 BOM 导致解析失败，用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`）。

## 两种使用方式

### 方式一：AI Agent 自然语言驱动（首选）
```powershell
cd C:\Users\Administrator\Doubao\chats\2026-09-14\new-chat-1\composio-sdk
node agent.mjs "给 zhang@xx.com 发一封专业的产品介绍跟进邮件"
node agent.mjs "列出我 Gmail 最近 5 封未读邮件并用中文总结"
node agent.mjs "把客户 张三 13800000000 存入 Google 表格"
```
Agent 最多自动循环 10 轮：LLM 看 6 个元工具 → 搜索具体工具 slug → 取参数 schema → 执行 → 中文汇报。全程基于真实返回，不编造。

### 方式二：手动三步（固定流程/排障用）
```powershell
node search.mjs "send an email via gmail"   # 1.搜工具，拿 slug
node connect.mjs GMAIL sales_user_001        # 2.首次用某应用，生成 OAuth 授权链接
node execute.mjs GMAIL_SEND_EMAIL '{\"recipient_email\":\"a@b.com\",\"subject\":\"hi\",\"body\":\"正文\"}'
node send.mjs <收件人> <主题> <正文>          # 发邮件专用封装
```

## 6 个元工具（Agent 内部自动用，无需手调）
`COMPOSIO_SEARCH_TOOLS`（按用途搜工具）、`COMPOSIO_GET_TOOL_SCHEMAS`（取参数）、`COMPOSIO_MANAGE_CONNECTIONS`（生成 OAuth 授权链接）、`COMPOSIO_MULTI_EXECUTE_TOOL`（并行执行）、`COMPOSIO_REMOTE_BASH_TOOL`、`COMPOSIO_REMOTE_WORKBENCH`。

## 连接新应用的标准流程
1. `node connect.mjs <应用大写名，如 GOOGLESHEETS / SLACK / HUBSPOT> <userId>`
2. 输出 `redirectUrl`（https://connect.composio.dev/link/...，约 10 分钟有效），用 `Start-Process <url>` 在默认浏览器打开
3. **OAuth 登录授权必须用户本人完成**（涉及其私人账号，不代操作、不索要密码）；遇"Google 未验证"提示点 高级→继续
4. 授权后用一个只读工具验证，如 Gmail 用 `node execute.mjs GMAIL_GET_PROFILE "{}"`，返回邮箱即 Active

## 当前已连接应用
- **Gmail：wch887292@gmail.com**（已授权，可发信/读信/草稿，已实测自发自收成功、中文无乱码）

## 销售获客常用工具 slug（详见 references/sales-toolkits.md）
- 邮件：GMAIL_SEND_EMAIL / GMAIL_CREATE_EMAIL_DRAFT / GMAIL_SEND_DRAFT / GMAIL_FETCH_EMAILS / GMAIL_REPLY_TO_THREAD
- 表格：GOOGLESHEETS_*（线索入库）；CRM：HUBSPOT_CREATE_CONTACT、SALESFORCE_CREATE_LEAD、ZOHO_CREATE_ZOHO_RECORD
- 日历：GOOGLECALENDAR_*（约访）；沟通：SLACK_*、DISCORD_*

## 安全边界（必须遵守）
- 密钥、OAuth 令牌属敏感凭据，不回显、不写进交付物、不提交 git。
- **发邮件/写 CRM/删改数据是不可逆外部动作**：给真实客户发送前必须先向用户确认收件人、主题、正文；默认优先"先建草稿（CREATE_DRAFT）给用户确认"，不盲目重试发送（避免重复投递）。
- 不替用户登录第三方账号、不保存第三方密码；授权一律走官方 OAuth 链接由用户本人完成。
- 免费额度：Composio 约 10 万次工具调用/月；Qwen 按 token 计费（成本极低）。

## 故障排查（详见 references/troubleshooting.md）
- 401 Invalid API key：检查是不是误用 `ck_` 开头 key；Project Key 在 dashboard 的 Projects→选项目→Settings→Project Settings→API Keys，`ak_` 开头。
- `Headers.append invalid header value`：.env 被多变量污染或带 BOM，按上文无 BOM 方式重写。
- 工具报未连接/no connection：先 `connect.mjs` 完成该应用 OAuth。
- LLM 不发起工具调用：确认模型支持 function calling；agent.mjs 已自动剥离 reasoning 等非标准回传字段。

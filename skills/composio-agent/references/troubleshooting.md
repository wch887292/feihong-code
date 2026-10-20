# Composio Agent 故障排查手册

## 认证类
### 401 Invalid API key（ck_ 开头）
- 原因：`ck_` 是 Sessions & API Key 页的 **consumer key**（x-consumer-api-key，仅 MCP 客户端用），SDK 不认。
- 解决：取 **Project API Key**（`ak_` 开头）。路径：dashboard → 左上角 Projects「Select Project」选项目 → Settings → Project Settings → API Keys → Create，复制 `ak_` 开头整串。
- 注意肉眼易混字符：0/O、1/l/I、6/G、Z/2，优先点页面「Copy」按钮而非手敲。

### 401 No Composio API key provided / Headers.append invalid header value
- 原因：`.env` 带 UTF-8 BOM，或简单 split('=') 把多行变量拼进了 key。
- 解决：用无 BOM UTF-8 重写；解析用逐行 `indexOf('=')`，脚本已内置，勿改回 `split('=')[1]`。
```powershell
$txt = "COMPOSIO_API_KEY=ak_xxx`nLLM_API_KEY=rc_xxx`nLLM_BASE_URL=...`nLLM_MODEL=..."
[System.IO.File]::WriteAllText("$PWD\.env", $txt, (New-Object System.Text.UTF8Encoding($false)))
```

## 连接类
### no active connection / 工具报未授权
- 先 `node connect.mjs <APP> <userId>` 拿 redirectUrl，浏览器完成 OAuth；再用只读工具验证（GMAIL→GMAIL_GET_PROFILE）。
- 授权链接约 10 分钟过期，过期重新生成即可。
- userId 必须与执行时一致（默认 sales_user_001），连接按 userId 隔离。

## 大模型类
### LLM 不发 tool_calls / 多轮后 400
- 确认模型支持 function calling（Qwen3.8-Flash-Next 已验证支持）。
- 厂商扩展字段（reasoning 等）回传会报错，agent.mjs 已只保留 role/content/tool_calls。
- 切换模型只改 .env 三件套（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL），OpenAI 兼容即可。
- AMD Qwen 配置：BASE=https://developer.amd.com.cn/radeon/api/v1，MODEL=Qwen3.8-Flash-Next。

## 执行类
### search 报 queries.0.use_case Required
- 正确签名是 `session.search({ query: "..." })`（对象包 query），不是传字符串，也不是 `{queries:[...]}`。
### execute 签名
- `session.execute(toolSlug, argumentsObject)`；元工具也用它执行。
### 中文命令行参数乱码（Windows PowerShell 5.1）
- 避免经 argv 传中文正文，改为在 .mjs 文件内以 UTF-8 写死内容，或用 agent.mjs 自然语言驱动。
### 发信重复/不可撤回
- GMAIL_SEND_EMAIL 立即发送且不可逆，重试会重复投递；优先 CREATE_DRAFT → 确认 → SEND_DRAFT，保存返回 messageId/threadId。

## 验证命令
```powershell
node verify.mjs      # 连通性
node list-tools.mjs  # 6 个元工具
```

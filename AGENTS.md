# 飞虹 Code 开发规范（AGENTS.md）

本文件指导 fhcode 项目的开发与运维，所有 AI 代理在本项目工作时必须遵循。

## 一、项目基本信息

- **项目路径**：`H:\feihong-code`（主仓库，旧路径 `H:\Muse Code复刻` 已废弃）
- **版本**：8.12.0
- **技术栈**：Node.js 22+ / TypeScript / Express / SQLite / Electron / Capacitor
- **构建**：`npm run build`（tsc + copy-web）
- **主服务**：`node dist/cli/index.js serve --port 8082`
- **Web 控制台**：`http://localhost:8082`，Bearer Token 见启动日志（持久化，重启不变）
- **配置文件**：`.env`（模型/密钥）+ `fhcode.config.json`（MCP 服务器）

## 二、配置硬规则

### .env 格式（最高优先级）
- **所有 JSON 数组值必须单行**，禁止跨行、禁止用单引号包裹。
  - 错误：`FH_PROVIDERS='[\n  {...},\n  {...}\n]'`（dotenv 截断为 `'[`，导致 loadConfig 崩溃）
  - 正确：`FH_PROVIDERS=[{"id":"agnes",...},{"id":"openrouter",...}]`
- 修改 `.env` 后必须重启服务生效。
- `.env` 含密钥，禁止外发、禁止提交到公开仓库。

### fhcode.config.json
- MCP 服务器的 `command` 用 `node`，`args` 用**绝对路径**（`H:/feihong-code/mcp-servers/xxx-mcp.js`），`cwd` 设为 `H:/feihong-code`。
- 平台密钥通过各服务器的 `env` 字段传入，**必须用 `${FHC_XXX}` 环境变量引用，禁止写明文密钥**（密钥值在 `.env` 配置）。凭证类 env 值（API Key / Secret / Token）写 `${FHC_DOUBAO_API_KEY}` 这类引用，非凭证类（URL / 模型名 / corp ID）可直接写字面量。
- 修改后重启服务，用 `GET /api/mcp/tools` 验证全部在线。
- 新增/改动配置后跑 `npm run secret-scan`，确认无硬编码密钥（门禁：命中即阻断）。

## 三、启动与验证规范

1. 启动前确认端口未被占用：`Get-NetTCPConnection -LocalPort 8082`
2. 后台启动：`Start-Process node -ArgumentList "dist/cli/index.js","serve","--port","8082" -WorkingDirectory "H:\feihong-code" -RedirectStandardOutput logs\xxx.log -RedirectStandardError logs\xxx.err.log -WindowStyle Hidden`
3. 启动后等待 6-8 秒，验证：
   - `GET http://localhost:8082/api/health` → ok=true
   - `GET http://localhost:8082/api/mcp/tools`（带 Bearer Token）→ 10 服务器全部 ok=true
4. 若 MCP 返回 500，第一检查 `.env` 的 FH_PROVIDERS 格式（单行 JSON），第二检查 `fhcode.config.json` 路径。

## 四、Windows 环境注意

- **PowerShell 5.1 不支持三元运算符 `?`**，脚本中用 `if/else`。
- **PowerShell 5.1 无 BOM 的中文 .ps1 会乱码**，含中文的脚本用 Node 执行或加 BOM。
- `python` 命令可能指向错误解释器，用全路径 `C:\Python314\python.exe`。
- 路径用正斜杠 `/` 或双反斜杠 `\\`，Node 模块路径用 `H:/feihong-code/...`。

## 五、技能与 MCP 开发

- 新增技能放 `H:\feihong-code\.agents\skills\<skill-name>\SKILL.md`，必须有标准 frontmatter（name/description）。
- 新增 MCP 服务器放 `H:\feihong-code\mcp-servers\<name>-mcp.js`，复用 `./lib/mcp-framework.js` 的 `createMcpServer`。
- 技能总数 = 项目级（.agents/skills）+ 用户级（~/.feihong-code/skills），启动时自动发现。
- MCP 服务器必须在 `fhcode.config.json` 注册后才会被 agent 调用。

## 六、交付前验证清单

- [ ] `npm run build` 无错误
- [ ] 服务启动后 health 接口正常
- [ ] 10 个 MCP 服务器全部在线（/api/mcp/tools）
- [ ] 模型 providers 正确加载（loadConfig 不抛异常）
- [ ] 关键功能端到端验证（聊天、技能调用、MCP 工具调用）
- [ ] 日志无未处理异常

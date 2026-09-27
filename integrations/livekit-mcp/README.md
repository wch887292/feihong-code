# LiveKit MCP Server（fhcode 桥接层）

晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

## 定位

把底层 fhcode 编程引擎（REST API，`127.0.0.1:18080`）封装为 MCP 工具，
供 LiveKit 语音 Agent 经 MCP streamable HTTP（`127.0.0.1:8083/mcp`）调用。
架构单向：Agent → 本服务 → fhcode 沙箱执行。

> 本目录为**定版归档**（v1.2，2026-09-24 部署于服务器
> `/www/dk_project/livekit/mcp/fhcode_mcp_server.py`）。服务器上另有
> v1.0_backup / v1.1 / bak.v11 历史版本，以本文件为准；修改请先改这里再下发。

## 工具清单（10 个）

`fhcode_health` / `fhcode_list_models` / `fhcode_run` /
`fhcode_write_code` / `fhcode_fix_bug` 等语义化编程与任务管理工具（详见源码 `@mcp.tool()`）。

## 安全机制

- 调用 fhcode 携带 `FH_WEB_TOKEN` + HMAC 签名头（`FH_SIGN_SECRET`）
- 危险命令拦截 / 路径穿越校验 / goal 限长 / 审计日志（`FH_AUDIT_LOG`）
- **无任何硬编码密钥**，全部经环境变量注入（`FH_BASE_URL` / `FH_WEB_TOKEN` /
  `FH_SIGN_SECRET` / `FH_MCP_HOST` / `FH_MCP_PORT`）

## 运行

```bash
# 服务器上已由 ensure-oom-protect.sh 守护拉起（venv: /www/dk_project/livekit/mcp/venv）
python fhcode_mcp_server.py   # 监听 127.0.0.1:8083/mcp
```

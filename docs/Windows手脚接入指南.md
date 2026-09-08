# Windows 手脚接入指南（feihong-desktop）

> 版本：v8.0.0+（C 层内化）｜ 更新：2026-09-08 ｜ 晋江市飞虹智科技企业管理有限公司
>
> 本文档说明如何把 **desktop-touch-mcp**（Windows 桌面自动化引擎）嫁接为飞虹 Code 的「手脚」，
> 以及三层嫁接（A 配置接入 / B 策略约束 / C 内化封装）的配置与运维口径。

---

## 1. 架构总览

```
desktop-touch-mcp（32 工具 · Rust UIA 引擎 · 自带感知守卫）
   │  A 配置接入（mcpServers 注册）
   ▼
飞虹 MCP 客户端（src/tools/mcp/mcp-client.ts，纯 Node 零依赖）
   │  工具自动注册为 desktop_*（白名单 11 个核心工具）
   ▼
飞虹 ToolRegistry（zod 校验 → 沙箱 → hook → M4 守卫 → 审计）
   │  B 策略约束（policy.ts 角色矩阵 + sandbox.ts 沙箱规则）
   ▼
feihong-desktop 内化层（src/tools/desktop/）
   │  C 内化封装：停手线 + 标准动作序列 + 取证
   ▼
feihong_desktop_see / feihong_desktop_act / feihong_desktop_verify
   │  模型可见的强类型工具（看 → 动 → 验 闭环）
   ▼
Windows 原生 app（ERP / Excel / 桌面软件 / 记事本…）
```

- **A 层**解决「能不能用」（改配置，零代码）
- **B 层**解决「谁能用、要不要审批」（策略 + 沙箱）
- **C 层**解决「用得安全、用得留痕」（停手线 + 取证）

---

## 2. 安装与配置（A 层）

### 2.1 安装 desktop-touch-mcp 运行时（离线/在线）

```powershell
# 在线（npm registry 可用时）
npm install -g @harusame64/desktop-touch-mcp

# 离线（GitHub 不可达时，用镜像下载 ZIP 并校验）
# 参考：%USERPROFILE%\.desktop-touch-mcp\releases\v1.16.0\（已校验 SHA256）
```

关键环境变量：

| 变量 | 说明 |
| --- | --- |
| `DESKTOP_TOUCH_MCP_OFFLINE_FALLBACK=1` | 离线启动开关（不联网检查更新） |
| `DESKTOP_TOUCH_MCP_FETCH_TIMEOUT_MS=8000` | 启动拉取超时 |

### 2.2 飞虹配置（fhcode.config.json）

```json
{
  "mcp": {
    "servers": [
      {
        "name": "desktop",
        "command": "node",
        "args": ["C:/Users/<用户>/.desktop-touch-mcp/releases/v1.16.0/dist/index.js"],
        "env": { "DESKTOP_TOUCH_MCP_OFFLINE_FALLBACK": "1" },
        "initTimeoutMs": 20000,
        "callTimeoutMs": 120000,
        "tools": [
          "desktop_state", "screenshot", "server_status", "desktop_discover",
          "workspace_launch", "focus_window", "click_element", "keyboard",
          "terminal", "excel", "wait_until"
        ]
      }
    ]
  }
}
```

> **注意**：`tools` 是**原始工具名**（不带 `desktop_` 前缀），filter 在注册前生效。
> 白名单只暴露 11 个核心工具，防止 32 个工具全部进入模型上下文导致注意力稀释。
> 修改配置后需重启飞虹会话；原配置请先备份（`fhcode.config.json.bak-<日期>`）。

---

## 3. 策略与沙箱（B 层）

### 3.1 角色矩阵（src/enterprise/policy.ts）

| 角色 | desktop 只读 | desktop 写 | 说明 |
| --- | --- | --- | --- |
| viewer | 否 | 否 | 无 desktop 权限 |
| developer | 否 | 否 | 编码角色，不开放桌面操控 |
| operator | 放行 | **需审批** | 业务操作员：`feihong_desktop_act` 及 `desktop_*` 写工具一律审批 |
| admin | 放行 | **需审批** | 管理员同样审批——不可逆动作留给人 |

写工具清单（`DESKTOP_APPROVAL_TOOLS`，共 20 个）：`keyboard / mouse_click / mouse_drag / scroll / click_element / focus_window / workspace_launch / run_macro / terminal / clipboard / window_dock / excel / key_locker / screenshot_gc / browser_click / browser_open / browser_navigate / browser_eval / browser_fill / desktop_act`，另加 `feihong_desktop_act`。

> **已修复缺陷**：`allowTools: ['*']` 时 `approvalTools` 曾不生效（approval 判定顺序错误），
> 现改为 **approval 优先**——审批清单中的工具任何角色（含 admin）都需审批。

### 3.2 沙箱规则（src/tools/sandbox.ts）

- **read-only 模式**：拦截全部 desktop 写工具（`DESKTOP_WRITE_TOOLS` 20 个 + `feihong_desktop_act`）——只读勘察会话中 agent「只能看，不能动」
- **workspace-write / danger-full-access**：桌面写操作放行到策略层（审批决定）

---

## 4. 停手线（C 层 · src/tools/desktop/desktop-guard.ts）

硬编码安全边界，**任何角色（含 admin）不可绕过**，不依赖 MCP 服务器：

| 规则 | 说明 |
| --- | --- |
| 动作白名单 | 仅允许 `type / click / mouse_click / drag / scroll / terminal_send / launch` |
| 目标窗口必填 | 写操作（除 launch）必须显式指定 `windowTitle`，防误操作到无关窗口 |
| 危险窗口黑名单 | 任务管理器 / 注册表编辑器 / UAC / Windows 安全中心 / 系统配置 / 设备管理器 / 磁盘管理 / 本地组策略…（子串匹配，不区分大小写） |
| 用户扩展黑名单 | 环境变量 `FEIHONG_DESKTOP_BLOCK_WINDOWS`（逗号分隔）追加，例如保护微信/企业微信 |

---

## 5. 取证目录（C 层）

- 位置：`<FH_HOME>/forensics/<runId>/`（默认 `%USERPROFILE%\.feihong-code\forensics\`，可用 `FH_FORENSICS_DIR` 覆盖）
- 结构：
  ```
  forensics/<runId>/
  ├── manifest.jsonl   # 每次动作一行 JSON：ts/event/action/tool/args 摘要/结果/截图回读
  └── shots/           # 截图目录（desktop-touch 磁盘缓存保留原图，可复核）
  ```
- **语义**：每次写操作（无论成败）强制截图取证——「操作留痕、可复盘、可甩锅」，是给企业客户交付的证据链。

---

## 6. feihong 工具参考

| 工具 | 读写 | 说明 | 关键参数 |
| --- | --- | --- | --- |
| `feihong_desktop_see` | 只读 | 桌面勘察：焦点/可见窗口/光标 | `filter?` 按标题/进程过滤 |
| `feihong_desktop_act` | 写（需审批） | 标准动作序列：停手线 → focus → 动作 → 取证 | `action` + `windowTitle` + 动作参数 |
| `feihong_desktop_verify` | 只读 | 截图+状态回读断言 | `expectText?` / `expectWindow?` |

### 动作参数（feihong_desktop_act）

| action | MCP 工具 | 关键参数 |
| --- | --- | --- |
| `type` | keyboard | `text`（自动 `@active` 瞄准前台） |
| `click` | click_element | `element`（UIA 名称，可先 discover） |
| `mouse_click` | mouse_click | `x` `y` |
| `drag` | mouse_drag | `x` `y` `endX` `endY` |
| `scroll` | scroll | `deltaX` `deltaY` |
| `terminal_send` | terminal | `text` |
| `launch` | workspace_launch | `command` `waitMs`（默认 5000） |

---

## 7. 实战经验与已知边界（重要）

1. **标题中英文差异**：Windows 11 中文系统记事本窗口标题可能是 `Notepad`（英文）或 `记事本`。
   `focus_window` 按子串匹配，**建议先 `feihong_desktop_see` 拿到精确标题再操作**。
2. **type 必须走 `@active`**：feihong 层已 focus 目标窗口后，`keyboard` 用 `windowTitle:'@active'`
   瞄准前台，可规避标题匹配歧义；若直接传标题，可能触发 desktop-touch 感知守卫
   `AutoGuardBlocked`（提示先 `desktop_discover` 验证）。
3. **感知守卫错误码**：`AutoGuardBlocked / GuardFailed / DestinationRequired / ElementDisabled /
   InvokePatternNotSupported / WindowNotFound / FocusFailed` 会以「正常返回」携带错误文本，
   feihong 层已做语义判定（视为失败并附带 suggest 提示）。
4. **keyboard 限制**：`win+r / win+x / win+s / win+l` 被服务器硬编码拦截；非 ASCII 文本
   （CJK/emoji）走自动剪贴板，IME 组合中不会落地。
5. **Excel 工具**（VBA COM）：只读动作建议直接调用 `desktop_excel`；写动作走审批。
6. **焦点即信任**：`@active` 瞄准的是**当前前台窗口**——动作前务必 `see` 确认焦点，
   防止输入进入用户正在使用的窗口（演示/生产都适用）。

---

## 8. 运维清单

- [ ] 配置修改前备份 `fhcode.config.json`
- [ ] 变更后重启飞虹会话，确认日志出现 `MCP server attached · desktop · 11 tools`
- [ ] 修改策略后跑 `npm run typecheck` + `npm test`
- [ ] 定期检查取证目录容量（截图累积），按需清理
- [ ] 客户机部署时：每台机需单独安装运行时 + 单独授权（TCC/辅助功能等价物），并配置各自白名单

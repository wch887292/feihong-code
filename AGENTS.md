# 飞虹 Code 开发规范（AGENTS.md）

本文件由主控注入，任务是让 fhcode 在开发时遵循以下强制规范，避免在真实 Windows 环境暴露常见缺陷。

## 一、Windows 系统命令解析规范（最高优先级）

解析任何系统命令输出前，**必须先实际执行一次抓取真实 stdout**，再按其真实格式写解析代码。禁止凭经验假设格式。

- `netsh wlan show networks mode=bssid`：SSID 行是 `SSID 1 : RED15`（**冒号 + 编号**），字段用 `:` 分隔，不是 `=`。
- `netsh wlan show interfaces`：首行是 `There is 1 interface on the system:`（**单数 is**），字段冒号分隔；SSID / Signal / Band / Channel / Receive rate / Transmit rate 都在此。
- `ping`：输出可能是英文（`Packets: Sent = 2, Received = 2` / `time=27ms`）或中文（`已发送 = 4` / `最短 = 27ms`）。解析必须**同时兼容中英文**。
- `Get-NetAdapter`：WiFi 网卡的 `PhysicalMediaType` 是 `Native 802.11`，用 `-like '*802.11*'` 匹配，不能用 `-eq '802.11'`。
- 同类数据必须去重：同一 SSID 多个 BSS（channel/band 不同）应合并为一个网络，取最强信号，不要产生重复条目。

## 二、Windows 原生 API（WlanApi.dll）规范

调用原生 API 前，先用 `ctypes.windll.WlanApi` 逐个 `getattr` 探测函数是否存在，捕获 `AttributeError`，**禁止臆造函数名**。

- 正确导出函数（2026-10 实测）：`WlanOpenHandle` / `WlanEnumInterfaces` / `WlanGetNetworkBssList` / `WlanConnect` / `WlanQueryInterface` / `WlanScan` / `WlanFreeMemory`。
- **不存在**：`WlanClientGetInterface`、`WlanGetNetworkBssIdList`（曾因此导致原生路径整体静默失效）。
- ctypes `Structure` 字段名**不能含点号**（如 `u.physicalType` 非法，会导致定义失败）。
- 权限不足时读取 BSS 受限，自动降级到 `netsh`，保证任何环境下界面都能列出网络，不静默失败。

## 三、交付前强制验证规范

每个任务交付前，**必须在目标 Windows 真实环境跑一次端到端验证脚本**（如 `verify.py`），逐项确认：
1. 扫描是否真正返回了网络（非 0 个）
2. 接口信息是否真正解析到（SSID / 频段 / 信道 / 速率）
3. ping 是否真正有往返数据（非全 0/全丢包）
4. 电源管理/硬件检测是否真正取到适配器名
5. 每个 `空 / 0 / None / 100%丢包` 都是 bug 线索，抓真实输出修正解析后重跑，直到全绿。
验证结果写入 README 供追溯。

## 四、模型与执行
- 若主模型被限流（429），自动轮换到可用 provider；本地 Ollama 模型（fhcode-agent / qwen3）不受限流，作为可靠兜底。
- 后台无交互审批通道时，需设置 `FH_REQUIRE_APPROVAL=false` 与合适的 `FH_SANDBOX_MODE`，否则 run_shell / edit_file 全被拒导致任务空转。

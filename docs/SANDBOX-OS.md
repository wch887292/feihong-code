# OS 级沙箱（跨平台）说明

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 版本 8.11.0 · 2026-10-19

本文档说明飞虹 Code 的 OS 级沙箱执行层（`src/runtime/os-sandbox.ts`）：能力矩阵、后端选择、Windows 现状与 P1 路线。

## 沙箱四层定位（互为纵深防御）

| 层 | 模块 | 作用 | 边界强度 |
|---|---|---|---|
| 工具级策略 | `src/tools/sandbox.ts` | 该不该做：read-only / danger / deny 优先 | 策略（逻辑） |
| 目录级隔离 | `src/runtime/sandbox.ts` | 防误操作：工作区副本 + diff/merge | 目录（逻辑） |
| 容器级隔离 | `src/tools/docker-sandbox.ts` | Docker 容器内执行（`FH_SANDBOX_IMAGE`） | 容器（较强） |
| **OS 级隔离** | `src/runtime/os-sandbox.ts`（v8.11 新增） | 进程/命名空间级隔离（bwrap / unshare / sandbox-exec） | **OS 内核原语（强）** |

OS 级沙箱解决「容器/目录之外的进程逃逸面」：命令虽在独立目录/容器中，仍共享宿主内核与进程空间；OS 沙箱用内核机制把进程放进独立命名空间与权限域。

## 平台能力矩阵

| 平台 | 后端 | 真隔离？ | 安装/前置 |
|---|---|---|---|
| Linux | **bubblewrap（bwrap）** | ✅ 是（user/mount/net/pid 命名空间全隔离，`--die-with-parent`） | `apt install bubblewrap`；未装时自动回退 unshare |
| Linux | unshare（回退） | ✅ 是（user+mount+pid 命名空间；需 userns 或 root） | 内核支持即可 |
| macOS | **sandbox-exec**（seatbelt） | ✅ 是（文件/网络权限 profile） | 系统自带 |
| Windows | **受限执行（降级）** | ⚠️ 否（临时目录 + 环境清理 + 危险命令拦截 + 进程树强杀） | 无 |
| Windows | Job Object / AppContainer / 低完整性令牌 | 计划中（P1） | 需 C++ helper 或原生 addon |

## 用法

```bash
# 查看本机 OS 沙箱后端能力
fhcode sandbox status

# OS 级沙箱执行（Linux 走 bwrap/unshare，macOS 走 seatbelt，Windows 受限降级）
fhcode sandbox run <目录> -- <命令> --os

# 传统目录级副本隔离（不变）
fhcode sandbox run <目录> -- <命令> [--sync]
```

`--os` 与目录级沙箱的差异：OS 沙箱**不复制工作区**，直接在原目录上以 OS 隔离进程执行——适合「需要真隔离但文件量巨大/需原位 IO」的场景；目录级沙箱则侧重「执行后 diff/merge 防污染」。二者可与 Docker 容器（`FH_SANDBOX_MODE=container`）按需选用。

## 安全行为（所有平台统一）

1. **危险命令拦截**（进入执行前）：`rm -rf /`（根下）、`mkfs`、`dd 写块设备`、fork 炸弹——直接拒绝，不进 OS 原语。
2. **环境注入面清理**：`NODE_OPTIONS` / `LD_PRELOAD` / `LD_LIBRARY_PATH` / `DEBUG` / `NODE_DEBUG` 在子进程环境中删除，防父进程/宿主注入。
3. **网络默认关闭**：bwrap 默认 `--unshare-net`；sandbox-exec 默认 `deny network*`；需要时以 `FH_SANDBOX_NETWORK=true` 或显式参数开启。
4. **超时强杀**：默认 120s；Linux/macOS `SIGKILL`，Windows `taskkill /T /F` 杀整棵进程树。
5. **纵深组合**：OS 沙箱之上仍叠加工具级策略（allow/deny）与网络域名黑白名单。

## Windows 现状与 P1 路线（诚实声明）

Windows 上 OS 沙箱暂为**受限执行降级态**，不冒充真隔离：

- 已具备：危险命令拦截、环境清理、临时工作区、进程树强杀（`taskkill /T /F`）、超时控制——显著降低常见误操作与注入风险。
- 尚未具备：Job Object（进程树硬隔离/资源上限）、AppContainer（独立安全标识符与 ACL）、低完整性令牌（Low IL 降权）。
- **P1 路线**：以原生 addon（N-API）或独立 helper（C++，约 300 行）封装 Win32 原语——`CreateJobObject` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + `SetInformationJobObject`（内存/CPU/句柄上限）+ `CreateRestrictedToken`（低完整性）；经 `napi-rs` 打包随 CLI 分发。验收标准：`fhcode sandbox status` 在 Windows 显示 `job-object` 后端，且沙箱进程树在超时/崩溃后无残留。
- 在此之前，Windows 高敏感执行建议显式走 Docker 容器沙箱（`FH_SANDBOX_MODE=container`）。

## 验证

- 单测：`tests/unit/os-sandbox.test.ts`（危险命令拦截 / 环境清理 / 平台探测 / Windows 受限执行真实链路 / 超时强杀）。
- 冒烟：`fhcode sandbox status`；Linux 上 `fhcode sandbox run . -- echo OS_OK --os` 应输出 `OS_OK` 且后端为 `bwrap`。

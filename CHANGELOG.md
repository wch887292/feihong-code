# 更新日志 (CHANGELOG)

本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 约定，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] — 2026-08-10（稳定版 / Stable）

> M4 企业级能力合入，fhcode 进入可稳定部署状态。

### 新增（Added）
- **企业级权限（RBAC）**：四角色矩阵（viewer / developer / operator / admin）+ deny 优先判定顺序；内置 23 条危险命令黑名单、11 类敏感路径黑名单；策略覆盖仅能加严（黑名单取并集）。
- **防篡改审计**：sha256 哈希链（按月切分 `audit-YYYY-MM.jsonl`），写入即链式校验；`audit verify` 可定位断点；日志脱敏（apiKey/secret/token/Bearer/sk- 等）。
- **多租户隔离**：物理目录隔离 `<FH_HOME>/tenants/<tenantId>/{sessions,audit,goals}`，租户 ID 正则校验 `^[A-Za-z0-9._-]{1,64}$` 防穿越；默认租户兼容旧版 `<FH_HOME>/sessions`。
- **成本治理**：单任务 `maxCostUsd` 熔断 + 租户日预算 `FH_TENANT_BUDGET_USD` fail-fast；`whoami` 展示用量。
- **企业命令**：`whoami` / `policy` / `audit [--limit N]` / `audit verify` / `tenants`。
- **CI 三流水线**：`build`（Node 18/20/22 矩阵 + 离线闭环）/ `enterprise`（41 项全离线断言 + 租户隔离）/ `security`（发布包白名单 + 明文密钥扫描 + npm audit），零 Secrets 全离线。
- **Web 管理控制台（BETA）**：`fhcode serve [--port 8080]`，Bearer Token 鉴权（fail-closed），只读观测 API（tenants/whoami/policy/audit/audit verify/sessions/quota）+ 原生静态仪表盘。
- 文档体系：README、用户手册、配置参考、架构与API、部署指南、常见问题、企业部署与合规、产品开发文档。

### 变更（Changed）
- `guard` 作为唯一权威闸门：策略判定 → 人工审批 → 审计留痕在工具执行前一次性完成；工具层不再二次弹审批（注入后 `security` 置空去重）。
- 向后兼容：未注入 guard 或 `FH_ENTERPRISE=false` 时行为同社区版（M3），无感降级。

### 安全（Security）
- 密钥仅存 gitignored `.env`，不回显完整 key；日志脱敏。
- 发布包白名单（`files` + `.npmignore`）双重保障：`.env` / `src` / `.workbuddy` 不随 `npm publish` 泄露。

---

## [0.0.x] — 里程碑演进（已提交）

- **M0+M1**：CLI 骨架 + 单代理闭环（需求解析 → 规划 → 工具调用 → 反思）。
- **M2**：多子代理并行编排（`/plan` `/grill` `/goal` 技能）。
- **B 方案**：接入真实模型（`.env` 加载器 + 联调验证）。
- **M3**：恢复与审计（`sessions`/`resume`/`diff`/`rollback` + 交互式审批流）。
- **M4**：见上 [0.1.0]。

### 进行中（In Progress）
- **M5 Web 管理控制台**：S1 服务骨架 + `serve` 命令已完成并验证（见 [0.1.0] BETA）；S2 观测 API / S3 前端仪表盘 / S4 安全加固 / S5 文档与 verify-m5 待推进。

---

## 署名

晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

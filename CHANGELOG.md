# 更新日志 (CHANGELOG)

本文件遵循 [Keep a Changelog](https://keepachangelog.com/) 约定，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] — 2026-08-15（宇宙能量级复盘优化 · GitHub + npm 上线准备）

> 全面复盘查漏补缺后的收口版本：修复版本链路不一致、修复命令无输出、扩充核心模块单元测试到 42 例、补齐 GitHub 社区健康文件与 npm 发布白名单，为 GitHub 升级与 npm 首发做完整准备。

### 修复（Fixed）
- **版本号全链路一致性**：`package.json` 0.2.3 与 `src/cli/version.ts`、`src/shared/config.ts` 的 `0.2.1` 不一致，统一升级到 `0.3.0`（运行时 / 包 / 配置三方一致）。
- **`model-stats` / `experiences` 命令无输出**：`runModelStats` / `runExperiences` 未导入 `index.ts` 调用，现已补全，命令正常输出（空状态给出友好提示，执行任务后自动累积数据）。

### 优化（Changed）
- **GitHub 仓库指向**：`package.json` 的 `repository` / `bugs` 由 GitCode 镜像切回 GitHub 主仓（`wch887292/feihong-code`），README 同步修正迁移说明与社区板块（二维码改为官网链接，避免失效资源）。
- **GitHub 仓库元数据升级**：通过 API 更新仓库描述为 `v0.3.0` 并突出 npm 可装 / MIT 开源；Topics 补充至 19 个合规标签。

### 新增（Added）
- **单元测试扩充**：新增 `tests/unit/experience.test.ts`（9 例，覆盖经验提取/持久化/加载/排序/注入）、`tests/unit/orchestrator.test.ts`（6 例，覆盖 ReAct 循环/工具执行/成本熔断/迭代上限/检查点恢复/经验提取），单元测试总量 42 例。
- **GitHub 社区健康文件**：新增 `.github/FUNDING.yml`（Sponsor 按钮）、`.github/dependabot.yml`（每周依赖与安全自动化更新）。
- **本地部署调试指南**：`DEPLOYMENT-GUIDE.md`（安装 / 配置模板 / 调试命令 / 故障排查）。
- **npm 上线预检清单**：`NPM-RELEASE.md`（发布前自动校验、包字段核对、发布流程、回滚预案）。

### 校验（Verified）
- TypeScript 零错误（tsc --noEmit）；`npm test` 42/42；`verify:m4` 41/41；`verify:m6` 29/29；`verify:m7` 12/12；`verify:m8` 27/27；`verify:m9` 25/25；`verify:m9-real` 11/11；全部 100% 通过。
- `npm run build` 成功，`npm pack --dry-run` 白名单校验通过（无 `.env`/`src`/`policy.json`/`node_modules` 泄露），运行时显示 `fhcode v0.3.0`，署名信息完整。

## [0.2.3] — 2026-08-12（npm 可见度优化）

> 扩充 `package.json` 关键词 / 描述、README 增加 npm 徽章、对比表与一键安装 CTA，`feihong-cli` 别名包同源发布（bin 同为 `fhcode`）。

## [0.2.1] — 2026-08-11（M9.1 真实模型接入与实测调优）

> 让 `swe` 与常规命令可一键接入真实模型，并以 mock HTTP 服务实测"真实 provider 全链路"。

### 新增（Added）
- **三级供应商解析**：`loadConfig` 现依次支持 `FH_PROVIDERS`（JSON 数组）、`fhcode.config.json`（`models.providers`）、单环境变量快速接入（`FH_MODEL_NAME`/`FH_MODEL_TYPE`/`FH_MODEL_BASE_URL`/`FH_MODEL_API_KEY`/`FH_MODEL_TAGS`）。
- **`swe` 新增 `--max-iterations`**：控制每个子任务的模型推理轮数（真实模型建议 4~8，控成本/耗时）。
- **真实模型执行纪律强化**：`swe-planner` 增加"必须通过工具落地、必须真跑验证、禁谎报、只改相关文件"等约束；`swe-agent` 自愈注入改为携带验证命令的**真实输出**，更具可操作性。
- **真实接入就绪检查**：`fhcode swe` 在真实模式未配置任何供应商时给出明确的三种接入指引，避免盲目失败。
- **接入实测脚本** `scripts/verify-m9-real.mjs`：以本地 mock HTTP 服务（兼容 OpenAI / Ollama 协议）驱动 `swe` 走完整的"真实 HTTP provider → 编排器工具循环 → 验证器"链路，11 项断言全通过，无需任何外部模型。

### 校验（Verified）
- TypeScript 零错误；M4 企业能力验证 41/41 通过；M9 验证 25/25 通过；M9 真实接入实测 11/11 通过。

## [0.2.0] — 2026-08-11（M9 全自动软件工程 Agent）

> 新增全自动软件工程 Agent（M9），对标业界"读取仓库→拆解→改码→跑测试→验证"长链路自主开发范式。

### 新增（Added）
- **仓库读取器（repo-reader）**：扫描整个（大型）代码仓库，含文件数/体积限流、`.gitignore` 解析、语言分布、关键文件识别、测试/构建命令探测、目录树与上下文串。
- **任务拆解规划器（swe-planner）**：将目标拆解为有序、可独立验证的子任务（勘察→实现/修复/重构→测试→构建验证），每个子任务携带目标文件、验收标准与验证命令。
- **验证器（swe-verifier）**：根据仓库快照自动执行构建与测试，解析 exit code 与输出，判定每步/整体通过/失败，产出错误摘要供自愈注入。
- **全自动 Agent 主编排（swe-agent）**：读取仓库→规划→逐任务（委托 Orchestrator 实现 + 构建/测试验证 + 失败自愈重试）→ 产出结构化 `SweReport`；支持 `plan-only` / `verify-only` / `max-tasks` / `max-retries` 模式。
- **CLI 命令**：`fhcode swe "<目标>" [--repo PATH] [--plan-only] [--verify-only] [--max-tasks N] [--max-retries N]`。
- **验证脚本**：`scripts/verify-m9.mjs`（25 项离线断言，覆盖四阶段 + 自愈路径）。

### 校验（Verified）
- TypeScript 零错误；M4 企业能力验证 41/41 通过；M9 验证 25/25 通过。

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

# 贡献指南（CONTRIBUTING）

感谢关注 **飞虹 Code（对标 Muse Code，自研内核）**。本文件约定开发协作规范，请提交前阅读。

## 一、项目署名（强制）

所有开发产出（源码注释头部、README、LICENSE、文档、页脚、about）必须标注：

- 公司：**晋江市飞虹智科技企业管理有限公司**
- 中心：**飞扬企源研发中心**
- 负责人：**吴赐虹**

源码文件头部统一使用：

```ts
/**
 * 飞虹 Code (对标 Muse Code / 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 */
```

## 二、架构约定（feature-first 分层）

```
src/
  cli/        入口、参数解析、REPL、运行时装配
  shared/     配置、错误、日志、共享类型、SQLite 统一存储（基础设施）
  agent/      Orchestrator / Planner / Prompts
  tools/      工具实现（file / shell / search / verify / docker-sandbox）+ registry
  models/     模型路由 + providers（openai-compatible / ollama / mock）
  runtime/    事件日志、会话状态（单一可信源）
  skills/     高级技能（/plan /grill /goal）
  memory/     持久记忆 + Honcho 语义记忆（v8.0）
  web/        Express Web 控制台 + API 路由
```

**v8.0 新增模块**：

| 模块 | 路径 | 说明 |
|------|------|------|
| SQLite 统一存储 | `src/shared/sqlite-store.ts` | 10 张表，AES-256-GCM 加密，版本化迁移，基于 node:sqlite 零依赖 |
| Docker 沙盒执行 | `src/tools/docker-sandbox.ts` | 容器隔离、禁网、只读挂载、资源限制、危险命令拦截、超时强杀 |
| Honcho 语义记忆 | `src/memory/honcho-store.ts` | 用户建模、事实记忆、跨会话检索、记忆注入提示词 |

铁律：

1. **边界必须校验**：所有外部输入（CLI 参数、模型响应、工具入参）用 zod 校验。
2. **集中配置**：配置只在 `shared/config.ts` 读取，启动即校验（fail-fast），懒加载不影响 `--version`。
3. **类型化错误**：抛出 `AppError` 子类（`ConfigError`/`ModelError`/`ToolError`/`ApprovalRequiredError`/`SecurityError`），禁止裸 `throw`。
4. **结构化日志**：通过 `shared/logger` 输出 JSON 日志，密钥自动脱敏；每次运行带 `runId`。
5. **单一可信源**：Agent 行为以 `runtime/event-log` 的 append-only JSONL 为准，支持审计与恢复。

## 三、安全底线

- 文件工具限制在项目根沙箱内（防 `../` 穿越）。
- shell 工具走白名单 + 危险命令拦截 + 审批（`ApprovalRequiredError`）。
- 日志/响应中任何密钥字段自动转 `[REDACTED]`。
- 禁止在代码、日志、提交信息中泄露真实凭证。

## 四、提交规范

- 提交信息用中文，句式「动词 + 内容」，如：`feat: 新增 ollama provider`、`fix: 修复 zod v4 record 校验`。
- 不提交 `node_modules/`、`dist/`、`.env`、日志与本地 demo 产物（见 `.gitignore`）。
- 大改动先建分支，描述清楚动机与验证方式。

## 四点五、版本号管理（单一权威源）

- **权威源只有一处：`package.json` 的 `version` 字段**。其余落点（`src/cli/version.ts`、`android/app/build.gradle` 的 `versionName`、`CHANGELOG.md` 最新段、`README.md` JSON-LD `softwareVersion`）均为**派生值，禁止手改**。
- **升版一律用脚本**：`npm run bump -- 7.7.0`（自动同步全部派生落点 + versionCode 自增），随后在 `CHANGELOG.md` 顶部补写新版本段。
- **CI 强制校验**：`npm run check:version` 已接入 `npm run verify` 与 CI build job，任何不一致会阻塞合并。
- **两套编号解耦**：M0→M9.1 为能力里程碑（已冻结），7.x 为产品化成熟度版本号，说明见 README §十二。

## 五、测试规范

提交 PR 前必须通过以下测试：

```bash
# 1. 编译检查
npm run build                    # tsc 编译到 dist/，零错误

# 2. 冒烟测试（v8.0 三项新功能）
node tests/smoke-v8.js          # 25 项：SQLite 11 + Docker 6 + Honcho 8

# 3. 集成测试（API 全量）
node tests/integration/api.test.js   # 34 项 API 用例

# 4. 仅运行指定模块（调试用）
node tests/smoke-v8.js --only=sqlite
node tests/smoke-v8.js --only=docker
node tests/smoke-v8.js --only=honcho
```

**测试要求**：
- 新功能必须包含测试用例
- Bug 修复必须包含回归测试（复现该 Bug 的测试）
- 测试不依赖外部网络（Docker 沙盒测试除外，需本机 Docker）
- 测试中不包含真实 API Key，使用 Mock 或环境变量

## 六、本地开发

```bash
npm install
npm run build      # tsc 编译到 dist/
npm run dev        # tsx 直接跑源码
node dist/cli/index.js --version
node dist/cli/index.js "<需求>"   # 未配 FH_PROVIDERS 自动离线 Mock 闭环
```

---

## 相关社区文档

| 文档 | 说明 |
|------|------|
| [`GOVERNANCE.md`](GOVERNANCE.md) | 社区治理结构、角色职责、决策机制、版本发布流程 |
| [`COMMUNITY.md`](COMMUNITY.md) | 社区参与指南、贡献方式、支持渠道、活动信息 |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | 社区行为准则 |
| [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/) | Issue 模板（Bug 报告 / 功能请求） |
| [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) | PR 模板 |
| [`docs/使用说明书-v8.0.0.md`](docs/使用说明书-v8.0.0.md) | 详细使用说明书 |

---

© 2026 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

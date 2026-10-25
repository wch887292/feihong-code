# 横向测评：Today CN vs fhcode（飞虹 Code）

> 吴赐虹 · 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 红客 OpenClaw 专家团
> 测评日期：2026-10-23　　依据：fullstack-dev skill 七条铁律 + 架构横向对比

## 一、两项目定位（先说清本质差异）

| 维度 | Today CN | fhcode v8.12.0 |
|---|---|---|
| 厂商 | Today AI（新加坡 TODAY AI PTE. LTD.） | 吴赐虹 / 飞虹智（自研开源） |
| 性质 | **闭源** Electron 桌面客户端（UNLICENSED） | **开源** Apache-2.0 终端 AI 编程智能体 |
| 定位 | 生产力/专注/会议提醒/屏幕捕获 桌面效率工具 | AI 编程 Agent（SWE Agent / 多 Agent 编排） |
| 交付形态 | 单一 Windows 桌面 exe（asar 封装） | CLI + Web 控制台 + Electron + 手机云桥接 + npm 包 |
| 源码可见 | ❌ 仅 asar 可解包，核心逻辑混淆 | ✅ 全量 220+ TS 文件可审计 |
| 私有化 | ❌ 强绑 SaaS 云（today.ai / releases.todayai.cn） | ✅ 支持完全离线/本地 Ollama |
| 可审计/可运营 | ❌ 遥测外发（PostHog + Sentry） | ✅ 无强制遥测，本地落盘加密 |

**结论**：两者**产品赛道不同**——Today CN 是 C 端桌面效率工具，fhcode 是开发者 AI 编程工具。
横向对比的真正价值在于**工程模式借鉴**，而非功能对位。

## 二、工程架构横向对比（对照 fullstack-dev 七铁律）

| 铁律 | Today CN | fhcode | 点评 |
|---|---|---|---|
| 1. 按 FEATURE 分层 | ✅（apps/web + packages/today-widget-runtime monorepo） | ✅（agent/cli/tools/web/runtime/security 等 20+ feature 目录） | 双方都达标 |
| 2. Controller 不写业务逻辑 | ✅ | ✅（路由层薄，逻辑下沉到 agent/harness） | 达标 |
| 3. Service 不碰 HTTP 类型 | ✅ | ✅（ModelRouter/ToolRegistry 注入式） | 达标 |
| 4. 配置集中 + fail-fast | ✅（env 校验） | ✅（shared/config.ts：集中 + ConfigError + 三级 provider 优先级） | fhcode 更细 |
| 5. 所有错误 typed + 一致格式 | ✅（AppError 层级） | ✅ 工具层 AppError；**Web 层原先无全局处理器** → **本次已补** | fhcode 补齐 |
| 6. 所有输入边界校验 | ✅（zod 全栈） | ✅ 工具层 zod 严格；**Web/HTTP 层原先手写 typeof 散落** → **本次已补 zod 中间件** | fhcode 补齐 |
| 7. 结构化 JSON 日志 + 请求 ID | ✅ | ✅ runId + 脱敏；**请求 ID 透传原先缺失** → **本次已补** | fhcode 补齐 |

## 三、Today CN 独有亮点（可借鉴 → fhcode 优化方向）

| 亮点 | 证据 | 借鉴价值 | 建议 |
|---|---|---|---|
| **工件完整性溯源** | 每个 `.todaydemo` 带 `provenance.json`（sourceCommit）+ `checksums.json`（sha256 全量校验 12 个文件） | ⭐⭐⭐ 高 | P1：fhcode 的 session/artifact 加内容指纹（sha256 manifest），审计可追溯、防篡改 |
| **启动恢复** | 主进程 `DesktopStartupRecovery`（协议恢复 + 启动即恢复） | ⭐⭐ 中 | P1：fhcode 崩溃后 session 续跑（已有 session 持久化，缺崩溃恢复入口） |
| **多环境 runtime 指纹** | `web-runtimes/manifest.json`（buildId + schemaVersion + deepLinkScheme） | ⭐⭐ 中 | P2：fhcode 加 runtime 指纹/环境一致性校验 |
| **极简依赖面** | 仅 zod+undici+lodash-es+eventemitter3+set-cookie-parser+electron-updater | ⭐ 低 | P2：产品形态差异，fhcode 的 monaco/playwright/electron 属功能需要，不必削 |

## 四、fhcode 独有优势（对照 Today CN 明显领先项）

| 优势 | 说明 |
|---|---|
| 多模型 key 池 + 状态码分级轮换 | 401/403/429 切 key，400/404 跳 provider，5xx 退避重试（model-router.ts） |
| 企业级 RBAC 审计 + 三级规则引擎 | enterprise/audit + security/rules-engine，红线恒 deny |
| 三层安全 | 传输 TLS + 应用层请求签名/防重放/暴力破解 + 数据 AES-256-GCM 落盘加密 |
| 离线/私有化 | 本地 Ollama 全链路可跑，无云强依赖 |
| 可审计 + 可运营 | 源码全开放，无外发遥测 |

## 五、本次落地的 P0 优化（已验证通过）

**缺口定位**：fhcode 工具层 zod 校验扎实，但 **Web/Express 层（19 文件 + 9 路由）的 HTTP 入参全靠手写 `typeof`，且无全局 typed 错误处理器、无请求 ID 透传**——正是 fullstack-dev 铁律 5/6/7 在 Web 边的短板。

**改动清单**：
1. 新增 `src/web/http-guards.ts`：
   - `requestIdMiddleware`（铁律7：X-Request-Id 生成/沿用，截断 128，随结构化日志传播）
   - `validateBody(schema)`（铁律6：zod 校验 req.body，失败 → 422 + 字段级 `fields`，合法则归一写回）
   - `assertValid(schema, input)`（handler 内部主动校验，抛 `ValidationError`）
   - `notFoundHandler`（/api 未知路径统一 404）
   - `globalErrorHandler`（铁律5：AppError 结构化返回；未知错误 500 且不外泄堆栈/路径；headersSent 短路）
2. `src/shared/errors.ts` 增补 `ValidationError`（422 + 字段级，纳入既有 AppError 层级）
3. `src/web/server.ts` 接线：`requestIdMiddleware` 置于最前；`notFoundHandler` + `globalErrorHandler` 置于所有路由之后
4. 新增 `tests/unit/http-guards.test.ts`（8 用例）

**验证矩阵**：

| 检查 | 结果 |
|---|---|
| `tsc --noEmit`（strict + noUnusedLocals） | ✅ 0 错 |
| `tsc` build → `dist/web/http-guards.js` | ✅ 生成 |
| 新增 8 单测（validateBody 422/归一、assertValid 抛错、globalErrorHandler 4 分支、notFound 404、requestId 透传） | ✅ 8/8 pass |
| 现有 `tests/unit` 回归 | 待全量跑（改动为加法式，不影响既有路由行为） |

**兼容性**：纯加法，未改任何既有路由语义；`validateBody` 按需挂到具体路由即可，不影响未使用它的端点。

## 六、下一步建议（按优先级）

- **P1（高）**：会话/工件内容指纹（sha256 manifest + provenance），对标 Today CN 完整性溯源，强化审计防篡改
- **P1（高）**：崩溃恢复入口（session 续跑），对标 DesktopStartupRecovery
- **P2（中）**：把 `validateBody(zod schema)` 逐路由推广到 9 个路由域，彻底替代手写 typeof
- **P2（中）**：runtime 环境指纹/一致性校验
- **P2（低）**：补全量 `tests/unit` + `tests/integration` 回归基线，作为 CI 闸口

---

## 七、P1 / P2 落地记录（2026-10-23 20:05 追加）

### P1-A 会话/工件内容指纹（对标 Today CN checksums.json + provenance.json + manifestSha256）
- 新增 `src/runtime/provenance.ts`：
  - `canonicalStringify`（object key 递归排序，跨进程稳定指纹）
  - `buildCheckpointManifest(cp)`：为会话 `touchedFiles` 生成 sha256 内容指纹清单，provenance 携带 version/署名/runId/时间/`gitRevision`（对标 sourceCommit）/session 状态
  - `manifestSha256` 自校验（清单自身指纹，防清单被改）
  - `verifyCheckpointManifest`：内容篡改检测 + 自校验破坏检测（对标 Today CN 完整性溯源）
  - 产物 `<runId>.manifest.json`（与会话检查点同目录，加法式，不影响既有 `listCheckpoints`）
- CLI：`fhcode recover`（崩溃恢复扫描）、`fhcode manifest [verify]`（指纹校验）
- Web：`GET /api/recover`、`GET /api/manifest`（Bearer 鉴权后，敏感数据受控）
- 单测 `tests/unit/provenance-recovery.test.ts`（4/4）

### P1-B 崩溃恢复入口（对标 Today CN DesktopStartupRecovery）
- 新增 `src/runtime/recovery.ts`：`findRecoverable(checkpoints)` 纯函数——筛 `crashed/running` 中断会话，判「可续跑」（需有消息历史），支持 `verifyOne` 完整性预检拦截（接 P1-A 指纹，篡改会话不放行）
- 复用既有 `runResume` 真正续跑；`recover` 只负责「扫描 + 判定 + 列清单」（对标 DesktopStartupRecovery 的恢复发现语义）
- CLI `recover` + Web `/api/recover` 已接

### P2 validateBody(zod) 逐路由推广
- 新增 `src/web/schemas.ts`：task / task-message / webhook / memory-short / memory-append / honcho-remember 共 6 个 schema
  - `.passthrough()` 保留未声明字段（向后兼容，不破坏既有 handler 读 `permissions`/`attachments`）
  - zod v4：用 `.min(1)` 兜必填（缺字段/空串均 422），不用 v3 `{required_error}` 选项对象
- `server.ts` 6 个高危 POST 端点挂 `validateBody(schema)`（schema 422 + handler 既有检查双保险）
- `express.d.ts` shim 路由方法扩展为可变 handler（支持链式 `validateBody` 挂载）
- 单测 `tests/unit/web-schemas.test.ts`（7/7）

### 验证矩阵（20:05）
| 检查 | 结果 |
|---|---|
| `tsc --noEmit`（P0/P1/P2 自身） | ✅ 0 新增错 |
| `tsc` build → 5 个新产物 dist | ✅ 生成 |
| 新增单测（P1 4 + P2 7） | ✅ 11/11 |
| **全量 unit 回归** | ✅ **550/550，0 fail** |

> ⚠️ 遗留：`src/integrations/inbound/`（wecom-adapter / session-mapper，git 未跟踪 WIP）存在 6 个**预先存在**的 typecheck 错误（非本次 P0/P1/P2 引入，P0 阶段 typecheck 为 0 错）。本次未越界修改，需决定：纳入修复 / 暂隔离 / 剔除。


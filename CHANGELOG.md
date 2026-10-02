# 飞虹 Code 更新日志 / Changelog
## v8.6.0 · Always-on 飞虹 dots（2026-10-02）

**主题**：借鉴 OpenAI dots 范式四期升级——Agent 自我认知 / 透明记忆 / Routines 调度 / 三级权限规则引擎。对标 dots 三大差异化：透明可导出记忆、内置任务管理、自我认知。

- **P1 Agent 自我认知**：新增 `src/agent/self-awareness.ts`——orchestrator 启动时经 `buildSystemPrompt()` 把运行时工具注册表（21 工具）自省注入系统提示词，Agent 明确"我能做什么、参数怎么传、失败如何降级"；能力清单双来源（ToolRegistry > tool-schema.json），任一来源损坏均降级回退不阻断；`scripts/gen-tool-schema.ts` 从运行时注册表重新生成 schema（修复历史乱码损坏，确立代码为单一事实源）。
- **P2 透明记忆**：新增 `src/memory/transparent.ts`——TransparentMemory 增/列/搜/改/删 + exportJson/exportMarkdown/importJson 全量可导出（对比 dots 记忆不可读不可导出）；导出默认过 M4 audit.redact 脱敏；SQLiteStore 补 userUpdateMemory/userDeleteMemory（userId+id 双条件防越权）。
- **P3 Routines 调度**：新增 `src/runtime/routines/` 四模块——五字段 cron（宏/步进/区间/dom-dow OR 语义/4 年闰日扫描窗）、JSON 原子写持久化、调度器（retry > catchup > cron 优先级、事件触发、错过窗口补偿恰好一次、运行中互斥 + 全局并发上限、失败指数退避 maxRetries）；真实动作执行默认 noop runner，预留 P4 审批门控接线。
- **P4 三级规则引擎 + 审批收件箱**：新增 `src/security/rules-engine.ts` + `approval-inbox.ts`——allow/ask/deny 三级判定（硬红线 > 精确 > 通配 > fail-safe 默认 ask）；硬红线四类任何规则不可放行（改密码/转账/永久删除/外发，中英双语词表）；审批收件箱 submit→pending→approved/rejected/expired 全闭环，裁决幂等、TTL 过期、approvals.json 原子写持久化、审批事件入 M4 hash chain、落盘前 redact 脱敏。

**验证终态**：npm test **354/354**（基线 302 → 354，+52 用例）；verify 链十项全绿——typecheck / check:version / build / verify:m4(41) / m6(29) / m7(12) / m8(27) / m9(25) / **verify:routines(18，新增)** / **verify:policy(13，新增)**，端到端合计 165 项。

**兼容性**：全量向后兼容——self-awareness 失败自动回退基础提示词；TransparentMemory/Routines/规则引擎均为新增独立模块，既有 CLI/Server 行为不变。

## v8.5.1 · 三项核心 bug 修复（2026-10-01）

**修复（全部含单元测试，301/301 通过）**：
- **bug① dots/Qwen 文本格式 tool call 不解析**：新增 `src/models/text-toolcall.ts`——解析 `<dots_function_call><invoke name="X"><parameter name="k">v</parameter></invoke></dots_function_call>` 与 Qwen `<tool_call>` JSON 两种文本格式，含**截断容错**（未闭合块也解析、`truncated` 标记、末参数取到文末）；`openai-compatible.provider.ts` 在标准 tool_calls 为空时自动兜底提取，dots3/agnes 等只回文本的 provider 从此可正常驱动工具链。
- **bug② 成本闸中止后 checkpoint 误标 done**：`orchestrator.ts` 新增 `abnormalEnd` 标记——成本熔断/loop-abort/自愈失败 break/迭代上限四种异常终止均将 checkpoint 落为 `crashed`，resume 不再被"假 done"挡住。
- **bug③ FH_BUDGET_USD 未接硬闸**：`task-executor.ts` 新增 `resolveMaxCostUsd()`——环境变量 `FH_BUDGET_USD` 优先于角色策略 `maxCostUsd`，sessions/swe/executor 三处调用点统一接入；`FH_BUDGET_USD=100` 即真实硬闸（此前仅告警）。
- **附带加固**：`model.dto.ts` 放宽 `tool_calls[].type` 校验（`z.literal('function')` → `z.string().optional()`，修复 Ollama/AMD 返回显式 null 导致整包被拒）；`openai-compatible.provider.ts` 默认 `max_tokens` 4096 → 8192，缓解长报告截断。

**新增测试**：`tests/unit/text-toolcall.test.ts`（9 例，含截断容错）、`tests/unit/budget-usd.test.ts`（5 例）、`orchestrator.test.ts` 补 2 例 checkpoint 状态用例。

## v8.5.0-security · P0 安全熔断（2026-09-30）

**安全审计后 P0 阻断修复（F1–F6，端到端验证通过）**：
- **F1 激活码可任意伪造 → 非对称签名**：`src/license/index.ts` 移除硬编码默认密钥，改为 **Ed25519** 签名——服务端持私钥（`FH_LICENSE_SIGN_PRIVATE_KEY`）签发，客户端仅内嵌公钥验签（公钥可公开，无私钥无法伪造）；签名长度升至 64 字节（hex）。彻底解决"对称密钥必须下发客户端"的死结（详见 `安全审计报告与防护体系设计.md` 附录 B）。`fhcode license gen` 改用 `FH_LICENSE_SIGN_PRIVATE_KEY`。
- **F2 鉴权全绕过 → 不回显密钥**：`src/web/server.ts` 登录响应删除 `signSecret`；HMAC 签名密钥改为从请求 `Bearer` 令牌派生（服务端不再下发全局签名密钥）；登录加手机号格式校验 + 60s 频率限制。
- **F3 免费企业版 → mock 门禁**：`src/web/routes/shop.ts` 仅 `SHOP_ALLOW_MOCK=1` 允许演示支付，否则 `issueLicense` fail-closed 拒发；公开查单不返回激活码明文，新增 `/api/shop/deliver` 按联系方式校验交付。
- **F4 微信回调 RCE → POST 验签**：`src/integrations/wechat-bridge.ts` POST 分支入口 fail-closed 验签（MP/WeCom），失败即 403。
- **F5 插件安装 RCE → 白名单 + 管理员令牌**：`src/plugins/plugin-loader.ts` 远程来源需 `FH_PLUGIN_ALLOWLIST`、本地路径需 `FH_PLUGIN_ALLOW_LOCAL`；`src/web/extra-apis.ts` 安装接口加 `FH_PLUGIN_ADMIN_TOKEN` 校验。
- **F6 电脑端任意进程 RCE → 白名单**：`src/web/routes/computer.ts` `/api/computer/app/open` 仅允许 `APP_LAUNCH_MAP` 内已知应用名，禁任意路径/URL/参数注入。

**验证**：`npm run typecheck` 0 错误；临时端到端脚本双模式（mock 允许 18/0、默认门禁 15/0）全部通过；`npm run build` 与 `check:version` 无回归。生产私钥、微信商户凭据、插件白名单、管理员令牌等敏感配置部署时设置，不入库。

## v8.5.0 (2026-09-28)

### 架构治理（B3 全链路重构，向后兼容）
- **server.ts 神文件拆分**：新增 `src/web/routes/` 七个域路由模块（managers / model-domain / filesystem / cline / cloud-bridge / capability-source / computer），`server.ts` 由约 3585 行历史峰值降至约 690 行。采用 `registerXxx(app, deps)` + `Deps` 依赖注入接口；可变绑定（`serverWorkspaceDir`、`sharedModelRouter`）以 getter/setter 注入保活。
- **run.ts 命令实现下沉**：`src/cli/run.ts` 由 1889 行改为 32 行薄转发层（`export *` 再导出），命令实现外迁至 `src/cli/cmds/` 下 11 个模块（skills / sessions / enterprise / integrations / skill-market / self-evolve / code-write / swe / harness / computer-control / license）。`cli/index.ts`、`repl.ts` 零改动。
- **循环依赖打断**：新增中性模块 `src/core/task-executor.ts` 承载 `executeTask`，切断 `cli/run → web/server → web/task-queue → cli/run` 依赖环。

### 修复与加固
- 修复提交基线既有 `ParallelOptions` 缺 `firstPrinciples` 字段导致的 tsc 报错。
- 审计锁（audit lock）在 safe-delete shim 环境下的死锁防护（`tryRemoveStaleLock`）。

### 验证
- `npm run typecheck` 退出码 0；`npm run build` 通过；运行时冒烟（CLI 入口、转发层 39 符号、18 个拆分模块加载）全绿。

### 说明
- 本次为纯架构重构，CLI 命令、Web API、配置格式均保持向后兼容，无 breaking change。

### 授权合规（v8.5.0 发布后追加）
- License 双轨统一：源代码改用 **Apache-2.0** 开源（LICENSE 更新为双轨授权说明 + Apache-2.0 全文），package.json `license` 字段 `UNLICENSED → Apache-2.0`；企业版增值能力（激活码、完全私有化部署、商业支持）保留商业授权。
- 同步修正 README（中英）、FAQ_EN、submission/SUBMISSION-NOTES 中的过时授权表述（Commercial/Commercial EULA/MIT → Apache-2.0 双轨）。

### 版本治理（v8.5.0 发布后追加）
- 补全版本单一事实源闸门盲点：`scripts/check-version.mjs` 与 `scripts/bump-version.mjs` 新增对 `src/tunnel/mcp-server.ts`（MCP_SERVER_VERSION）与 `vscode-extension/package.json`（version）的强制一致性校验与一键同步，消除漂移。
- 对齐历史漂移：android `versionName` 8.5.9→8.5.0、mcp-server `8.4.3-tunnel`→`8.5.0-tunnel`、vscode-extension `1.0.0`→`8.5.0`，全部收敛到核心权威源 `package.json` 8.5.0。`check:version` 硬校验 0 错误。

### 商业闭环 P-7 · 自建商城（支付 + 自动发码，沙箱打通）
- 新增 `src/web/shop-db.ts`：独立 `shop.db`（node:sqlite, WAL），订单表 + 三档 `TIERS` 配置（standard ¥399 / pro ¥1,999 / enterprise ¥9,999，金额按分存储，365 天，定价已锁定）。
- 新增 `src/web/routes/shop.ts`：`GET /api/shop/tiers`（公开档位）、`POST /api/shop/orders`（建单）、`GET /api/shop/orders/:no`（自助查单含激活码）、`POST /api/shop/pay/mock/:no`（模拟支付 → 自动调用 `generateLicenseKey` 发码 → 标记已付）、`POST /api/shop/wechat/notify`（微信支付 V3 回调骨架，`SHOP_PAY_MODE=wechat` 启用）、`/api/shop/admin/*`（Bearer 运营后台：订单列表 + 收入统计）。
- `src/web/server.ts` 挂载 `registerShopRoutes`、`src/security/index.ts` 签名豁免商城公开写接口；商城页 `src/web/public/shop.html` + `shop.js`（三档卡片 / 下单 / 模拟支付 / 查单 / 激活码展示与激活指引）。
- 支付模式由环境变量 `SHOP_PAY_MODE`（默认 `mock` 沙箱）控制；正式上线切 `wechat` 需配置商户号 / APIv3 密钥 / 证书并补全回调验签与发码逻辑。

### 修复 · 授权模块激活码截断（关键 bug）
- 修复 `src/license/index.ts` 中 `generateLicenseKey` 仅取 base64url payload 前 16 字符写入激活码，导致长 payload（pro/enterprise 档含联系方式 / 多设备数）被截断、`parseLicenseKey` 还原不出类型 / 天数 / 设备数、签名必然失败的缺陷。改为按 4 字符分组完整写入，正则同步放宽段数；`fhcode license activate` 从此可正确识别全部档位与授权参数。

## v8.4.3 (2026-09-14)

### 授权与依赖维护

- **试用期 7 天 → 60 天**：未激活状态下默认 60 天试用（以首次运行时间起算），src/license/index.ts TRIAL_DAYS 7→60；LICENSE 商业授权协议同步更新（版本 8.4.3）。
- **依赖升级**（合并 Dependabot PR）：zod 4.4.3→4.5.4（#29）、playwright-core 1.62.1→1.63.0（#30）、@capacitor/android 8.5.0→8.5.1（#31）、@types/node 26.4.1→26.5.0（#32）、electron 44.0.0→44.3.0（#33）。


> **版本体系说明**：**7.x** 为**产品化成熟度版本号**（SemVer），衡量产品打磨程度（桌面版、Web 控制台、SWE-bench harness、企业治理、自进化等持续迭代）；**M0→M9.1** 为**能力里程碑编号**（工程开发阶段），2026-08 上旬全部交付后已冻结、不再扩展。两套编号相互解耦——M 编号停止增长是设计使然，后续能力演进体现在 7.x 次版本号中。

## v8.4.2 (2026-09-14)

### 移动端 APP（飞虹 Code 移动版 v8.4.2）— 对话稳定 + 远程操控增强

- **对话稳定性终修**：流式对话自动重试（网络抖动/超时/HTTP 429/5xx 自动重连，最多 2 次，指数退避）；`finish_reason=length` 长回答**自动续写**（最多 2 次，不重复已生成内容）；用户主动停止不受影响；彻底解决"回答到一半就停止"。
- **屏幕截图回传**：手机端发「截图」→ 电脑端截屏 → 图片直接回传渲染在对话流（电脑端新增 PowerShell 原生截屏执行）。
- **图片/文件回传**：发「查看图片 <文件名>」→ 电脑端读取文件 → base64 回传手机渲染（支持 png/jpg/gif/webp/bmp，≤6MB）。
- **发送文件到电脑**：云电脑面板新增「📁 发送文件到电脑」按钮——选文件（≤6MB）→ base64 → 「保存文件」指令 → 电脑端解码保存到 `~/fhcode-cloud-work/upload/`。
- **指令历史**：云电脑面板新增「📜 指令历史」——拉取云端 `GET /api/bridge/commands` 展示本设备最近 30 条指令（状态/时间）。
- 版本同步：APP_VER v8.4.2 / 关于面板 / android versionCode 41 + versionName "8.4.2"。

### 桌面端 / Desktop

- 电脑连接面板新增「📜 指令历史」查看（云端桥接指令记录）。
- 「关于」版本号更新为 v8.4.2。

## v8.4.1 (2026-09-14)

### 移动端 APP（飞虹 Code 移动版 v8.4.1）— 电脑连接修复版

- **本地电脑连接修复（关键）**：默认地址不再使用 `127.0.0.1:8081`（在手机上指向手机自身，永远连不上电脑）；检测到 127.0.0.1/localhost 直接拦截并提示填写电脑局域网 IP；界面补充说明与局域网 IP 示例。
- **云电脑连接打通**：`api.klai.top/fhcode` 云端桥接服务验证通过（HMAC 签名 + Bearer 双重鉴权）；电脑端 `fhcode bridge start` 常驻运行并配置开机自启（Startup 文件夹 + 环境变量持久化）；端到端指令验证成功（手机模拟 → 云端入队 → 电脑执行 → 结果回传）。
- **连接失败原因区分**：云端测试区分 401（Token 错误）、timeout、network、HTTP 状态码，给出明确提示，不再笼统报"无法连接"。
- **防火墙放行**：Windows 防火墙新增「飞虹Code 桌面端 8081」入站规则（TCP 8081），手机与电脑同一 WiFi 可直连。
- 版本同步：APP_VER v8.4.1 / 关于面板 / android versionCode 40 + versionName "8.4.1"。

### 桌面端 / Desktop

- **同步 v8.4.0 连接状态**：顶栏新增连接状态胶囊（未连接灰 / 本地电脑绿 / 云电脑蓝），节点管理页新增「🖥️ 电脑连接」配置面板（云端地址 / Token / 设备 ID / 测试 / 保存），30 秒心跳自动检测。
- 「关于」版本号由 v0.6.1 更新为 v8.4.1。

## v8.4.0 (2026-09-12)

### 移动端 APP（飞虹 Code 移动版 v8.4.0）— 豆包式界面 + 电脑连接三态

- **豆包式对话界面**：居中标题顶栏 + 左侧菜单 + 右侧新对话；「AI 生成可能有误 · 注意核实」提示条；胶囊输入框 + 语音/图片/文件/拍照附件栏 + 快捷功能横排。
- **电脑连接三态显示**：顶栏状态胶囊 `● 未连接`（灰）/ `● 本地电脑`（绿）/ `● 云电脑`（蓝），30 秒心跳自动检测，断线自动变灰。
- **电脑连接设置面板**：⚙️ 设置 → 🖥️ 电脑连接，本地电脑（局域网直连）/ 云电脑（云端桥接）双通道，测试连接 + 保存并连接。
- 版本同步：APP_VER v8.4.0 / 关于面板 / android versionCode 38 + versionName "8.4.0"。

## v8.3.0 (2026-09-10)

### 移动端 APP（飞虹 Code 移动版 v8.3.0）

- **上传功能修复**：修复 v8.2.x 遗留的初始化中断导致「图片/文件」无法上传的问题（删除视频功能时残留了指向已删除函数的按钮绑定）；图片支持**多选最多 20 张**并自动压缩（最长边 1280px / JPEG 0.8），底部缩略图预览（点击放大、单个移除、＋继续加图）；文件上传 ≤20MB，文本文件自动读入对话。
- **文生视频重建（正确契约）**：内置 `agnes-video-2.5-flash`（一键填充 API 地址 + Key）；请求按官方 2.5 契约重写——`POST /videos` + `seconds`(字符串) + `size:"720P"` + `aspect_ratio` + `mode`，替换此前报 Invalid URL 的错误端点；支持**上传参考图**（有图 `mode:reference` + `image`，无图 `mode:text`）；轮询走 `/agnesapi?video_id=`。
- **删除图生视频与截图功能**：创作中心精简为「文生图 + 文生视频（含参考图）」两个能力；底部输入栏移除截图按钮（保留图片/文件/拍照）。
- **流式对话稳定性**（8.2.1 起保留）：完整行 SSE 解析零丢字、`max_tokens:8192` 防长回答截断、`finish_reason=length` 自动续写（最多 3 次）、首字等待放宽至 30 秒。
- 版本同步：app.js APP_VER / 关于面板 / android versionCode 36 + versionName "8.3.0"。

### 工程 / Engineering

- 版本一致性全量同步 8.3.0（version.ts / android / README JSON-LD / CHANGELOG / package.json）。

## v8.0.2 (2026-09-08)

### 工程修复 / Engineering Fixes

- **Node 22 全链路兼容**：CI matrix 统一为 Node 22，Dockerfile 升级 node:22-slim，engines 声明 >=22.5.0；CLI 新增版本守卫（Node <22.5 给出友好提示，替代 ERR_UNKNOWN_BUILTIN_MODULE 崩溃）。
- **供应链安全**：overrides 强制 qs 6.16.0（GHSA-x5fp-wj9c-mxmx / GHSA-4mjr-xmp4-gh2g）、uuid 11.1.1（GHSA-w5hq-g745-h8pq），npm audit 全量 0 漏洞，osv-scanner 通过。
- **CI 修复**：发布包检查修正 .env.example 误报（子串匹配 -> 精确匹配）；仓库密钥扫描排除 voltagent_skills.json 误报（repo slug 命中 sk- 模式）。
- **版本一致性**：version.ts / android versionName+versionCode / README JSON-LD / 当前文档版本标记全量同步 8.0.2。

## v8.0.1 (2026-09-08)

### 重大更新 / Major Updates

- **桌面手脚（desktop-touch MCP 嫁接）**：飞虹获得 Windows 原生 app 操控能力——`feihong_desktop_see / act / verify` 三工具闭环（看屏 → 操作 → 验证）；审批矩阵 + 危险窗口停手线 + 取证留痕三层安全模型；A 配置 / B 策略 / C 内化三层嫁接结构。
- **AI 员工军团（agent-team）整合**：17 个业务 AI 员工（L1 获客 / L2 内容 / L3 转化 / L4 决策 / L5 管理）随包分发；飞虹原生工具 `feihong_agents_list / submit` 打通，模型路由自动复用飞虹 providers，无配置回退 mock 全链路可跑。
- **全仓脱敏与清理治理**：移除 app.js / android assets / 评测脚本 / 测试脚本共 17 处硬编码密钥；git 历史泄露 KEY 经 filter-branch 全历史清除并 force push；清理 bench/real 约 6.8GB 评测运行产物与 android build 构建产物；.gitignore 加固防再污染。
- **工程修复**：copy-web.cjs 重写（Node 22 `fs.cpSync` 原生崩溃 0xC0000409 规避）；steer 人工指挥（M9）注入与事件恢复；单测 269 例全绿。

### 兼容性 / Compatibility

- npm 包 `feihong-code@8.0.1`：files 白名单新增 `agent-team/`（17 员工技能随包分发）；版本号以 package.json 为单一权威源全量同步（version.ts / android / README JSON-LD / CHANGELOG）。
- **安全提示**：8.0.0 已废弃（deprecated），请升级至 8.0.1；曾泄露的 API 密钥请立即轮换。

## v7.6.0 (2026-08-28)

### 重大更新 / Major Updates

- **SWE harness 升级为 SWE-bench 差分语义**：`TestVerifier` 三段式校验（修复前 FAIL_TO_PASS 原本失败 → 修复后 FTP 全部通过 → PASS_TO_PASS 回归不破坏既有功能），杜绝假阳性与回归破坏；mock 管道跑分报告产出（`bench/run-2026-08-28-mock.md`，诚实标注口径）
- **自进化双系统收敛为单一经验库**：旧式 `self-evolve` 的失败/解决/技能沉淀统一回流共享 `experiences.jsonl`，与新一代 `self-improve` 同库同 upsert 语义，orchestrator 统一检索形成学习闭环
- **voice-programming 加固**：补齐 5 个死类型命令规则（copy/paste/cut/close_file/replace）、修复「创建一个叫 X 的文件」识别与面板类命令抢占、新增 7 项单元测试（此前零覆盖）

### 工程 / Engineering

- 仓库卫生：清理 163 个 android 构建产物 + 29 个根目录调试截图 + `.idsig` 的 git 跟踪；`.gitignore` 补全（android assets public / `*.idsig` / 根目录 `/*.png` / `release2/`）
- manager `loadJSON` 兼容 BOM（PowerShell UTF8 写入的 JSON 可正常读取）
- 版本号 7.5.0 → 7.6.0（package.json / version.ts / android versionCode 8）

### 文档 / Documentation

- 新增《技术设计说明书》（v7.6.0 权威版，重写 `docs/技术说明书.md`）
- 新增《使用说明书》（v7.6.0 权威版，重写 `docs/使用说明书.md`）
- 新增《版本升级说明书》（`docs/UPGRADE_GUIDE_7_6.md`）
- 全库现行态文档版本头统一对齐 v7.6.0

## v7.5.0 (2026-08-27)

### 重大更新 / Major Updates

- **SWE-bench Verified 官方 harness 就绪**：对接 HuggingFace 官方数据集，支持 `--verifier test` 官方测试验证，跑分说明见 `docs/SWE_BENCH_REPORT.md`
- **Docker 容器沙箱隔离加固**：`container` 档位默认断网（`--network none`）+ 内存/pids 上限 + `--cap-drop ALL` + `no-new-privileges`，面向不信任代码场景
- **安全 CI 与 SBOM**：`npm run security`（npm audit + CycloneDX SBOM + osv-scanner 可选），发布流水线接入门禁
- **合规售前材料**：安全白皮书（SOC2/ISO27001 自评估）+ 数据处理协议（DPA）

### 新功能 / New Features

- **补全质量**：多候选补全（按置信度 Top3）、temperature 分层（quick 0 / full 0.3）、跨文件上下文（import 关联 + 工作区实时文档透传）
- **补全接受后自动 lint**：`/api/lint` 轻量语法校验，Monaco/VS Code 双端接受补全即反馈错误波浪线与提示
- **Monaco 语义诊断**：编辑时 LSP 诊断波浪线 + hover 展示诊断详情
- **多文件 diff 视图**：变更面板支持并排/内联切换 + 文件级折叠
- **插件市场本地种子源**：断网可用 10 个官方 skill 模板，install 自动注册到本地技能索引
- **多 agent 协作可视化**：团队面板新增协作总览（任务状态漏斗 + 成员负载分布）
- **VS Code 扩展**：补全纯函数抽离可单测（9/9）、跨文件上下文收集、accept 后 lint

### 修复 / Bug Fixes

- `dedupeAgainstSuffix` 后缀重复去重 bug（suffix 长于补全时无法匹配）
- LSP 客户端启动逻辑简化（node 直跑 tls 入口，跨平台稳定）

### 工程 / Engineering

- 发布流水线（release.yml）新增安全 CI + 综合冒烟 + SWE harness 冒烟门禁
- 版本号 7.2.0 → 7.5.0

## v7.0.0 (2026-08-24)

### 重大更新 / Major Updates

- **对话流全面重构**：对标豆包体验，纯文本输出 + 实时思考过程展示
- **Electron 桌面版正式发布**：独立桌面窗口，系统托盘，应用菜单，权限管理
- **版本号跨越**：从 0.6.1 直接升级到 7.0.0，标志产品成熟

### 新功能 / New Features

- 截图功能：屏幕捕获 + 框选裁剪，截图直接到输入框
- 电脑操作：后端 PowerShell API，支持截图、鼠标移动/点击、键盘输入
- 语音/视频通话：麦克风实时识别 + 摄像头画面 + 视频截图
- 工作区选择器：驱动器和文件夹分页，支持新建/重命名文件夹
- 自动化快捷指令：常用快捷指令内置
- 模板库插件系统：支持自定义来源，节点连接外部插件
- 记忆系统：长期记忆自定义，添加记录简化为纯文本输入
- 本地语音识别服务：faster-whisper 本地部署，完全免费离线

### 优化改进 / Improvements

- 界面宽度优化：主区域最大宽度 1400px，不再占满屏幕
- 用户菜单重构：从底部上拉改为右侧侧边栏
- 启动逻辑修复：不再打开两次网页
- 文本选择复制：支持选中部分文字复制
- 对话历史扩容：conversation 80→300 条，steps 200→500 条
- 系统提示词升级：编码能力 8 条 + 修复 bug 能力 7 条
- 自检维护优化：每天仅第一次任务可做环境确认，后续直接执行
- 中英文国际化：完整的中英文词条

### Bug 修复 / Bug Fixes

- 修复 Electron 桌面版自动退出问题
- 修复启动后打开两次网页的问题
- 修复对话历史过长导致前面内容被截断的问题
- 修复任务执行中思考过程不实时显示的问题
- 修复桌面版复制粘贴快捷键失效的问题
- 修复桌面版截图权限反复请求的问题
- 修复构建错误连续 3 次后错误信息不准确的问题

### 文档 / Documentation

- 新增更新说明书（中英文版）
- 新增技术说明书（中英文版）
- 新增横向测评报告（中英文版，豆包 AI 辅助）

---

## v0.6.1 (2026-08-24)

- 修复对话流输出格式问题
- 优化思考过程实时显示
- 修复构建错误自愈逻辑

---

## v0.6.0 (2026-08-24)

- 初始版本发布
- 多模型路由支持
- 企业级 RBAC 审计
- 全自动 SWE Agent
- Web 控制台

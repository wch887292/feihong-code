# fhcode P0-A / P0-B / P1 能力提升落地报告
> 飞虹 Code（对标 Muse Code · 自研内核）
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 生成时间：2026-10-25　代码基线：v8.12.0

## 一、背景与根因
- 参照三仓库（`ruvnet/ruflo` · `anthropics/claude-plugins-official` · `heygen-com/hyperframes`）拆解后，确认 fhcode 已内置 context-budget / context-compactor / layered-memory / verifier / quality-gate，真正缺口是**下发前判别性上下文抽取**与**任务收尾强制验证矩阵**（全库 grep 0 命中）。
- **大会话吐空根因**：`swe-agent.ts` 的 `buildFocusedGoal` 原本把 `plan.modelPrompt`（内嵌全仓 `contextString`，上限 2500 字，含全仓扫描）整段前置进**每个子任务**首轮 prompt。大 goal + 模型（xfyun-spark 等）空输出时，反复压缩（31→21、55→21）仍超预算，触发框架级空转熔断（streak=9）终止，0 落盘。

## 二、改动文件清单
| 文件 | 类型 | 内容 |
|---|---|---|
| `src/agent/context-brief.ts` | 新增 | 纯函数 `buildContextBrief(goal, snapshot)`：抽 files/symbols/cmds/redlines + 紧凑 briefText + estTokens（复用 estimateTokens），无副作用 |
| `src/agent/swe-agent.ts` | 修改 | `buildFocusedGoal` 改用 brief 前置，替代整段全仓 modelPrompt；`finalize` 生成 `verificationMatrix`；`emitMatrix` 落盘 `verification-matrix.md`；`SweReport` 加 `verificationMatrix` / `verificationMatrixPath` 字段 |
| `src/harness/reporter.ts` | 修改 | 新增 `VerificationMatrixReporter`（复用 `VerifyResult.steps[]`，纯渲染，仅类型导入避免循环依赖） |
| `tests/unit/context-brief.test.ts` | 新增 | 4 用例：token≤20% / 含目标文件与符号 / 纯函数 / 红线抽取 |
| `tests/unit/verification-matrix.test.ts` | 新增 | 4 用例：成功 / 失败❌+摘要 / 无步骤 skipped / 全通过总体✅ |

## 三、验证结果（亲跑，非轻信 status）
- `npx tsc --noEmit` → **exit 0**
- `node --test tests/unit/context-brief.test.ts tests/unit/verification-matrix.test.ts tests/unit/context-compactor.test.ts` → **10 pass / 0 fail**（context-brief 4 + verification-matrix 4 + compactor 回归 2）

## 四、对「效率」的实际收益
- 每个子任务首轮 prompt 由「全仓 contextString（≤2500 字）+ 全量 modelPrompt」降为「判别性 brief（≤15 文件 + ≤20 符号 + 命令 + 红线）」，显著降低大会话 token 膨胀与空转概率（实测 brief estTokens ≤ 全仓 20%）。
- 任务收尾强制产出一张可核对验证矩阵（用例/命令/状态/退出码/耗时 + 统计行），落地到 `verification-matrix.md`，对齐「验证跑通再汇报、结论有据可查」红线，杜绝 `status=done` 一句话。

## 五、交付验证矩阵（本项自检）
| 检查项 | 方法 | 状态 |
|---|---|---|
| context-brief 纯函数、无外部依赖 | 无 fs/网络调用，单测 pure 一致性 | ✅ |
| 接线 swe-agent（brief 前置） | 读 swe-agent.ts 确认 import + buildFocusedGoal 调用 | ✅ |
| 验证矩阵接线 finalize + 落盘 | emitMatrix 写 <cwd>/verification-matrix.md | ✅ |
| 无类型回归 | tsc --noEmit exit 0 | ✅ |
| 无测试回归 | 10/10 pass（含 compactor 回归） | ✅ |

## 六、遗留 / 下一步
- P1（瘦身纪律）：把 `prompts.ts` SYSTEM_PROMPT 与 `src/skills` 下「先 read 旧组件对齐风格」类流程指令改 knowledge 型，大 goal 默认走 brief。
- P2（拆插件）：参照 claude-plugins-official 立 fhcode 插件清单标准 + marketplace/renames 迁移。
- 建议跑一次 `npm run smoke` 或既有冒烟，记录改造前后首轮 token 对比到 docs/context-slim.md。

## 七、P1 上下文瘦身纪律（本轮追加）
- **膨胀源定位**：全仓 `contextString` 不止 `buildFocusedGoal` 一处，`swe-planner.ts:182 buildModelPrompt` 里 `snapshot.contextString.slice(0, 2500)` 是**第二条吐空链路**（`plan.modelPrompt` 由 solo-agent 等消费）。
- **改动**：`swe-planner.ts` 引入 `buildContextBrief`，把 `buildModelPrompt` 中的「## 仓库上下文摘要 + contextString.slice(0,2500)」替换为判别性 `briefText`。与 P0-A 同源，两条链全堵上。
- **影响面**：`solo-agent.ts:419` 只取 `modelPrompt.slice(0,200)` 当计划摘要，不受瘦身影响；`buildContextBrief` 是纯函数，无副作用。
- **探清结论（避免误判为"漏做"）**：P1 的实质（大 goal 默认走 brief、不再前置全仓 contextString）**已完成**（P0-A 改 `buildFocusedGoal` + P1 改 `buildModelPrompt`，两条链全堵）。`prompts.ts` 的 SYSTEM_PROMPT 探清后**已是原则/人格型（knowledge 型）**——全是编码/修复/输出风格原则，没有"先 read 旧码对齐风格"的重流程堆叠，砍它反而丢人格增风险，故**不改**；`src/skills/` 无重流程指令残留（grep 仅命中 curator 生成提示语，非指令堆叠）。
- **收益量化**：`scripts/measure-context-slim.ts` 用 fhcode 自身 2000 文件大仓实测 → `docs/context-slim.md`（P1 替换的「仓库上下文段」647→480 tokens，省 26%；brief 仅占全量 contextString 31%；含"怎么读这个数"防夸大注脚）。
- **验证**：`npx tsc --noEmit` **exit 0**；全量单测见第八节（**564/564 全绿**）。

## 八、全量回归（最终：全绿）
- 全量 `node --test tests/unit/*.test.ts`：**564 pass / 0 fail**（564 例，全绿）。
- 此前一度出现的 `agent-session: P3 steer`（test:127 断言 `result.ok`）失败**已修复并定性**：
  - **根因**：测试 mock 第 2 轮返回裸文本「任务完成」（只 read_file、0 文件改动但有工具），命中 2026-10-25 加固 `orchestrator.ts:565-570`（纯文本收尾 + 0 改动 + 有工具 → `abnormalEnd=true`）→ `ok: !abnormalEnd && ...`（line 817）= false，测试第一句 `assert.ok(result.ok)` 即挂，steer 注入断言没跑到。
  - **定性**：这是**测试没跟上 orchestrator 2026-10-25 加固行为**，非 source bug（`git stash` 验证：HEAD 下同样 4/1 失败）。
  - **修法（不撤 source 加固）**：改 `tests/unit/agent-session.test.ts` 的 mock，收尾改回 orchestrator 完成协议的 `FINAL: 任务完成` 前缀（`extractFinalAnswer`/`resolveNoToolCall` 都认 FINAL: 为显式完成，合法收尾），撤加固则重开"半空报成功"漏洞。
  - **结果**：agent-session 5/5，全量 564/564 全绿。

## 九、本次全部改动（git 核验）
| 文件 | 类型 | 内容 |
|---|---|---|
| `src/agent/context-brief.ts` | 新增 | 纯函数 `buildContextBrief`（P0-A 核心） |
| `src/agent/swe-agent.ts` | 改 | `buildFocusedGoal` 用 brief 前置（P0-A）；`finalize`+`emitMatrix` 落盘验证矩阵（P0-B）；`SweReport` 加两字段 |
| `src/agent/swe-planner.ts` | 改 | `buildModelPrompt` 用 brief 替换全仓 contextString（P1） |
| `src/harness/reporter.ts` | 改 | 新增 `VerificationMatrixReporter`（P0-B） |
| `tests/unit/agent-session.test.ts` | 改 | mock 收尾改 `FINAL:` 前缀，跟上 2026-10-25 加固（修 pre-existing 失败） |
| `tests/unit/context-brief.test.ts` | 新增 | 4 用例（P0-A） |
| `tests/unit/verification-matrix.test.ts` | 新增 | 4 用例（P0-B） |
| `scripts/measure-context-slim.ts` | 新增 | 离线收益量化（P1） |
| `docs/context-slim.md` / `docs/fhcode-p0a-p0b-report.md` | 新增 | 量化报告 / 本交付报告 |

## 十、P2 分发层地基（本轮追加）
- **探清结论**：fhcode 插件本体（`src/plugins/plugin-loader.ts`，212 行）早已「对齐 Claude Code plugins」（`plugin.json` + skills/hooks/mcp/providers/tools + 白名单安装 `FH_PLUGIN_ALLOWLIST`）。真正缺的是 `anthropics/claude-plugins-official` 的**分发层语义**：`name` 不可变 slug / `displayName` 可变标签 / 顶层 `renames` 自动迁移 / `marketplace.json` 解析。当前 `manager.ts` 的市场仍是硬编码 mock（本切片不动）。
- **本轮切片（有界 · 纯函数 · 可单测）**：
  | 文件 | 类型 | 内容 |
  |---|---|---|
  | `src/plugins/marketplace.ts` | 新增 | 纯函数分发语义：`isValidSlug`（小写 `[a-z0-9._-]`，长度 1~64，拒 `-` 开头）/ `resolveDisplayName`（displayName 优先，缺省/空白回退 name，128 截断）/ `applyRenames`（链式 a→b→c + 环防护 + 步数上限 100，不抛错不死循环）/ `parseMarketplaceManifest`（marketplace.json 防御式解析，市场 name 必须合法 slug，脏插件条目静默剔除）/ `slugFromSkillPath`（取尾段规范化为 slug，Win 反斜杠兼容，退化兜底 `skill`） |
  | `src/plugins/plugin-loader.ts` | 改（非破坏） | `PluginManifest` 补 `displayName?: string`（展示标签，不影响不可变 slug `name`） |
  | `tests/unit/marketplace.test.ts` | 新增 | 16 用例：slug 合法/非法边界、displayName 优先级/回退/截断、renames 单跳/链式/环防护/空、marketplace.json 合法/脏数据剔除/name 非法整体 null/损坏 null、skill 路径 slug 派生/反斜杠/退化 |
- **纯函数 + 零外部依赖**：不读盘 / 不发网 / 不碰 fs，仅做字符串与数据变换，便于 CLI/市场服务/插件管理器复用与单测。
- **验证（亲跑）**：`npx tsc --noEmit` **exit 0**；`tests/unit/marketplace.test.ts` **16/16 全绿**；全量 `node --test tests/unit/*.test.ts` **580/580 全绿**（564 既有 + 新增 16）。

## 十一、P2-2 分发层接入 manager.ts（第二批，本轮追加）
- **目标**：让 `manager.ts` 的 mock 市场**真正消费** `marketplace.ts` 纯函数（形成闭环，非两个孤岛），读真实 `marketplace.json` + 顶层 `renames` 自动迁移，缺失/损坏回退内置默认。
- **改动**：
  | 文件 | 类型 | 内容 |
  |---|---|---|
  | `src/plugins/marketplace.ts` | 改（非破坏） | `MarketplacePlugin` 加**索引签名透传**（marketplace.json 条目可携带宿主 `MarketPlugin` 形状字段：id/keywords/categories/publisher/...），`parseMarketplaceManifest` 改为「校验 name 合法 + 保留整条目」而非只挑几个字段 |
  | `src/plugins/manager.ts` | 改 | `searchMarketPlugins` 由硬编码 4 条 mock → **`resolveMarketSource()`**（读 `<baseDir>/marketplace.json`，命中用真实条目+renames，缺失/损坏/name 非法回退 `BUILTIN_PLUGINS` 内置 4 条 slug 化默认）+ **`toMarketPlugin()`**（透传条目映射 `MarketPlugin`，`applyRenames` 旧名迁移、`resolveDisplayName` 标签优先）；检索支持「旧名经 renames 迁移后命中新名」 |
  | `tests/unit/manager-market.test.ts` | 新增 | 4 用例：无 json 回退内置 4 条且 id 全合法 slug / 读真实 json（透传+renames）/ 旧名迁移检索命中 / 损坏·非法 json 回退 4 条 |
- **契约安全**：`searchMarketPlugins(q, category)` 签名与返回 `MarketPlugin[]` 未变（唯一消费点 `extra-apis.ts:233` `/api/plugins/market` 不受影响）；全库无测试直接调它（grep 证实）；`_p2-smoke.mjs` 只 import `PluginManager` 不碰它。
- **验证（亲跑）**：`npx tsc --noEmit` **exit 0**；`manager-market.test.ts` **4/4**；全量 `node --test tests/unit/*.test.ts` **584/584 全绿**（580 + 新增 4）。
- **运行链路冒烟**：`npm run build`（2000 文件仓 tsc + copy-web）BUILD_EXIT=0；`node scripts/_p2-smoke.mjs` **27/28 通过**（P2-1 TUI / P2-2 插件真实执行 / P2-3 沙箱权限全绿；唯一 ❌ 是「docker 容器执行层真实运行 exit=1」——**docker daemon 未起（client 在、`docker info` exit=1），环境受限，与本次分发层改动无关**，未碰 `tools/sandbox`/`tools/shell/exec`）。
- **遗留**：docker daemon 启动后复跑 `_p2-smoke.mjs` 补齐容器执行层实测（client 29.8.1 在、daemon 未起，`docker info` exit=1，环境受限、与本次改动无关）。
- **样例文件（已补，本轮追加）**：新增 `src/plugins/marketplace.sample.json`（顶层 `name` 不可变 slug `feihong-market` + `displayName` + 顶层 `renames` 旧名迁移 + `plugins[]` 透传宿主 `MarketPlugin` 字段），可作为真实 `marketplace.json` 落盘样例。`tests/unit/manager-market.test.ts` 新增第 5 用例固化闭环：把样例复制到 `<baseDir>/marketplace.json` → `resolveMarketSource` 命中 → 旧名 `feihong-git-helper`/`community-py-helper` 经 `renames` 迁移检索到新名。`manager-market.test.ts` 5/5、全量 **585/585 全绿**、`tsc --noEmit` exit 0。

# 飞虹 Code（对标 Muse Code，自研内核）— 代码审查与修复报告

**项目**：`H:\Muse Code复刻` (feihong-code)
**作者**：吴赐虹 · 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
**日期**：2026-08-11
**方式**：直接边审边修（review-and-fix），每批保持 `typecheck` + `verify:m4` 绿

---

## 一、本次新增修复（接续此前 H1–H4、M1–M3）

### 测试框架打通（阻塞项解除）
| 项 | 文件 | 改动 |
|----|------|------|
| test 脚本 | `package.json` | `"tsx --test tests"` → `"tsx --test tests/unit/*.test.ts"`（原写法把目录当模块导入，报 `ERR_UNSUPPORTED_DIR_IMPORT`） |
| 平台断言 | `tests/unit/safe-path.test.ts` | `safeJoin` 结果比较改用 `path.relative` + `sep` 归一化，修复 Windows 反斜杠导致的 `endsWith('src/app.ts')` 误判 |

新增 5 个核心 unit 测试文件（覆盖此前高危修复的回归基线）：
- `tests/unit/exec.test.ts` — `sanitizeManagedCommand` 允许包管理器脚本 / 拒绝注入字符 / 拒绝危险命令 / 拒绝非包管理器命令（H2）
- `tests/unit/context-compactor.test.ts` — 压缩后保留原 system 指令（H4）
- `tests/unit/commands.test.ts` — `--max-iterations` 等数字 flag 正确解析（H3）
- `tests/unit/safe-path.test.ts` — `safeJoin` 工作区内放行 / `../` 与绝对路径越权拦截
- `tests/unit/policy.test.ts` — RBAC + 危险命令黑名单 + 敏感路径（安全基线回归）

### MED/LOW 真实缺陷修复
| 项 | 级别 | 文件 | 问题 / 修复 |
|----|------|------|------|
| M7 | MED | `src/web/auth.ts` | `m[1] !== token` 非计时安全比较，存在令牌逐字节泄露的计时攻击面 → 改用 `crypto.timingSafeEqual` |
| M4 | MED | `src/tools/safe-path.ts` | `safeJoin` 仅词法校验，`resolve` 不跟随符号链接，工作区内软链可越权 → 对已存在路径用 `realpathSync` 规范化后再校验（新建文件仍走词法检查，不破坏创建场景） |
| L4 | LOW | `src/cli/run.ts` | `runModelStats` 中 `require('../dist/models/model-router')` 引用构建产物，dev 模式（`tsx`）下 `dist` 不存在会运行时崩溃 → 删除该行，复用顶部已 `import` 的 `ModelRouter` |

---

## 二、此前已完成的高危修复（H1–H4、M1–M3，已验证绿）

- **H1** `src/tools/shell/exec.ts`：`child.on('error')` 仅写 stderr 不 `resolve` → spawn 失败时永久挂起；改为 `resolve({code:1,...})`。
- **H2** `exec.ts` + `test-run/build-check.tool.ts`：新增 `sanitizeManagedCommand()`，受管工具只跑 `npm/pnpm/yarn/bun` 脚本并拦截注入字符与危险命令，杜绝沙箱逃逸。
- **H3** `src/cli/commands.ts`：`--max-iterations` 用错数组 `Number(positional[++i])` → 改 `Number(argv[++i])`。
- **H4** `src/agent/context-compactor.ts`：压缩时把 `messages[0]`（system 指令）切掉 → 保留 system 指令在压缩结果最前。
- **M1** `src/tools/shell/run-shell.tool.ts`：shell 注入校验原先嵌套在 allowlist 判断内，关闭白名单即关掉注入防护 → 注入校验改为始终执行。
- **M2** `src/runtime/worktree.ts`：`createWorktree` catch 未清理 `mkdtempSync` 临时目录 → rethrow 前 `rmSync(...,{recursive:true,force:true})`。
- **M3** `src/agent/parallel-orchestrator.ts`：将 `createWorktree` 循环移入 `try`，`finally` 清理已建 worktree，避免部分失败泄漏。

---

## 三、识别但未修改的项（评估结论 + 建议）

| 项 | 级别 | 结论 | 建议 |
|----|------|------|------|
| M5 审计并发 | MED | 审计哈希链并发写可能竞争 | 加文件锁 / 串行化写入 |
| M6 路由统计 | MED | ModelRouter 统计聚合疑似漏算 | 复查 `getStats` 聚合逻辑 |
| M8 body 限制 | MED | Web 请求体无限流 | 加 `express.json({limit})` |
| M9 令牌打印 | LOW | `serve` 命令打印令牌属预期 UX（本地临时令牌供用户使用） | 保持现状即可 |
| M10/M11 `as any` | LOW | code-writer / orchestrator 类型弱化，去掉会触发 `replace` 重载匹配报错，非运行时 bug | 重构 `replace` 入参类型后可去 `as any` |
| M12 脱敏缺口 | MED | 日志脱敏可能漏敏感字段 | 扩充 redact 正则 |
| M13 预算算子 | MED | budget 比较算子疑似不匹配 | 复查预算扣减分支 |
| M14 配额冻结 | MED | 超额后状态可能未冻结 | 补配额冻结路径 |
| M15 ReDoS | LOW | 个别正则需排查回溯 | 复核策略/注入正则 |
| M16 fire-and-forget | LOW | `run.ts` 中 `.then` 为 CLI 命令 void 返回的预期模式 | 保持现状 |
| L1 Windows `~` | LOW | 部分路径未展开 `~` | 用 `os.homedir()` 统一 |
| L2/L3/L5 | LOW | 经验配对 / 轮次计数 / 子代理日志丢失 | 非阻塞，后续迭代 |

> 说明：以上项多为低危或需较大改动、且与「保持验证全绿」约束冲突，本次按「边审边修」节奏先落地已确认的真 bug 与安全项，其余留作后续迭代清单。

---

## 四、最终验证结果

| 检查 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npm run typecheck` | 0 错误 |
| 企业基线 | `npm run verify:m4` | 41 / 41 通过 |
| 单元测试 | `npm test` | 18 / 18 通过 |
| 构建 | `npm run build` | 成功（`dist/cli/index.js`、`dist/web/server.js` 就位） |

**运行方式**：
- 开发：`npm run dev`（即 `tsx src/cli/index.ts`）
- 构建：`npm run build` → `node dist/cli/index.js`
- 测试：`npm test`

署名：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

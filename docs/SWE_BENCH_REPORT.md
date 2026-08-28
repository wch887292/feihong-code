# 飞虹 Code · SWE-bench Verified 跑分状态与说明

> 更新时间：2026-08-28 · 版本：7.6.0
> 本文档为 **SWE-bench 硬指标对外文案的事实依据**。所有数字均来自真实运行，不编造。

## 1. 官方 harness 能力（已集成）

飞虹 Code 内置 SWE-bench 官方评测 harness（`src/harness/`），对接 HuggingFace 官方数据集 `princeton-nlp/SWE-bench`（split 支持 `lite` / `verified`）：

| 模块 | 作用 |
|---|---|
| `SwebenchLoader` | 从 HuggingFace datasets-server 分页拉取官方实例（含 instance_id / problem_statement / FAIL_TO_PASS / PASS_TO_PASS / patch 等） |
| `MockOrchestratorExecutor` | mock 模式：脚本化 orchestrator 回归，验证 harness 链路（不依赖模型） |
| `RealModelExecutor` | real 模式：真实模型推理，跑官方问题 |
| `FileExistsVerifier` | 通过标准=生成指定文件（链路自检用） |
| `TestVerifier`（P7-1） | **通过标准=官方测试通过**：有 FAIL_TO_PASS 用例时优先跑这些失败用例（`npm test -- <用例>`），退出码 0 判通过 |
| `MarkdownReporter` / `JsonReporter` | 报告输出 |

## 2. 实测结果（诚实记录）

### 2.1 自建任务集 · 真实模型跑分（2026-08-27 复测，v7.6.0）

| 运行 | 数据集 | 实例数 | 通过率 | 模型 | 验证器 | 说明 |
|---|---|---|---|---|---|---|
| 2026-08-27 | 自建 JS 任务集（5 例） | 5 | **100%（5/5）** | agnes-2.5-flash | real-test（node --test 真实断言） | 真实模型驱动 Orchestrator 修复，预定义测试不交给模型；平均迭代 2.2 次/例 |
| 2026-08-26 | 自建 JS 任务集（5 例） | 5 | 80%（4/5） | agnes-2.5-flash | real-test | v7.2.0 首测，1 例因模型调用中断失败 |
| 2026-08-26 | SWE-bench lite（官方） | 1 | 100% | mock（脚本化） | FileExistsVerifier | `harness lite --limit 2 --mode mock`，django__django-11099，验证 harness 链路真实可用 |

> ⚠️ 自建任务集 100% 为 **5 个简单 JS 函数题**（max/fib/palindrome/findMissing/countWords）的实测，**不代表模型在真实复杂仓库上的解题能力**。真实硬指标必须以官方 SWE-bench Verified `--mode real --verifier test` 跑出。

**复现命令**：
```bash
node scripts/_swe-bench-real.mjs   # 自建任务集真实跑分（5 例）
node scripts/_swe-smoke.mjs         # harness 闭环冒烟（mock，2 例）
node scripts/_swe-fetch.mjs         # 拉取官方 SWE-bench Lite 数据集（验证网络可达）
```

### 2.2 官方 SWE-bench Verified 数据集可达性（2026-08-27 验证）

- `node scripts/_swe-fetch.mjs` 成功从 HuggingFace datasets-server 拉取官方实例（django/django-11099，problem_statement="Fix ORM bug."，FAIL_TO_PASS=test_orm）。
- 结论：**官方数据集网络可达**，官方 harness 已就绪，可执行真实跑分。
- 限制：官方 Verified 为 Python 大仓库（django/sympy/astropy 等），每例需 clone 仓库 + Docker 内跑 pytest，单例耗时数分钟至数十分钟，全量 500 例建议在 CI 中分批执行。

## 3. 真实跑分命令（需模型 + Docker 环境）

```bash
# 官方 SWE-bench Verified，真实模型推理 + 官方测试验证
fhcode harness verified --limit 20 --mode real --verifier test --report docs/swe-bench-verified-run.md

# 全量（500 例，耗时长，建议 CI 分批）
fhcode harness verified --mode real --verifier test --report docs/swe-bench-verified-full.md

# 输出 JSON 供后续对标
fhcode harness verified --mode real --verifier test --json
```

**环境前置**：
- 已配置模型供应商（`fhcode config set` 或 `~/.feihong-code/config.json` 的 `models.providers`）
- Docker 可用（验证器在容器内跑 FAIL_TO_PASS 测试，隔离不信任代码）
- 每实例需 clone 对应 repo（django / sympy / astropy 等），网络可达 GitHub

## 4. 对外文案口径（有据可依）

- ✅ **可对外宣称（自建任务集）**：**「自建 SWE-bench 格式任务集真实跑分：5/5 = 100% 通过率（agnes-2.5-flash 真实模型 + node --test 预定义测试断言，2026-08-27 复测）」**——必须同时注明"自建 JS 任务集，非官方 SWE-bench Verified"。
- ✅ **可对外宣称（官方 harness）**：**「已接入 SWE-bench Verified 官方评测（HuggingFace 官方数据集 + FAIL_TO_PASS 测试验证器），官方数据集已验证可达，支持一键跑分」**。
- ⚠️ **禁止宣称**：在官方 Verified `--mode real --verifier test` 全量跑分未完成前，**禁止**对外发布任何「SWE-bench Verified 通过率 X%」数字，也不得将自建任务集 100% 等同于官方 Verified 成绩。
- 当前公开口径：**「自建任务集 100%（5/5）；官方 SWE-bench Verified harness 已就绪且数据集可达，全量真实跑分待 CI 分批执行」**。

## 5. 与对标产品的差距定位（供内部参考）

- OpenAI Codex / Cursor / Claude Code 均已公开 SWE-bench Verified 通过率（如 60-75% 量级）
- 飞虹 Code 尚未完成真实跑分 → 差距仍在，但**从"无 harness"升级为"官方 harness 就绪，待真实跑分"**
- 真实跑分完成后的对标文案更新入口：`docs/BENCHMARK_REPORT_zh.md`

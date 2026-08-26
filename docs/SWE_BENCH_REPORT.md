# 飞虹 Code · SWE-bench Verified 跑分状态与说明

> 更新时间：2026-08-26 · 版本：7.5.0-dev
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

## 2. 实测结果（诚实记录，mock 模式）

| 运行 | 数据集 | 实例数 | 通过率 | 说明 |
|---|---|---|---|---|
| 2026-08-26 | SWE-bench lite | 1 | 100% | `harness lite --limit 2 --mode mock`，django__django-11099，验证 harness 链路真实可用 |

> ⚠️ 该 1/1 为 **mock（脚本化）回归**，用于验证「拉取官方数据集 → 执行 → 验证 → 报告」全链路，**不代表模型真实解题能力**。真实硬指标必须以 `--mode real` + `--verifier test` 跑出。

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

- 可对外宣称：**「已接入 SWE-bench Verified 官方评测（HuggingFace 官方数据集 + FAIL_TO_PASS 测试验证器），支持一键跑分」**
- 在真实 `--mode real` 跑分未完成前，**禁止**对外发布任何「SWE-bench 通过率 X%」数字
- 当前公开口径：**「SWE-bench Verified 官方 harness 已就绪，跑分结果将随 v7.5.0 发布」**

## 5. 与对标产品的差距定位（供内部参考）

- OpenAI Codex / Cursor / Claude Code 均已公开 SWE-bench Verified 通过率（如 60-75% 量级）
- 飞虹 Code 尚未完成真实跑分 → 差距仍在，但**从"无 harness"升级为"官方 harness 就绪，待真实跑分"**
- 真实跑分完成后的对标文案更新入口：`docs/BENCHMARK_REPORT_zh.md`

# SWE-bench 真实模型跑分 · 诚实报告

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
> 日期：2026-08-28

## 0. 结论（先说重点）

**本沙箱环境无法完成真实 SWE-bench 跑分，因此本报告不含任何伪造的跑分数值。**

已确认：
- ✅ 真实模型 **可达且可用**（`agnes-2.5-flash` 返回 HTTP 200 真实补全）；
- ✅ 评测 harness **端到端可用**（本地冒烟测试中真实模型 4 轮迭代 / 7 次工具调用，生成正确 patch）；
- ❌ **获取 SWE-bench 实例仓库**被阻断（GitHub 抓取限速/失败）；
- ❌ **运行官方测试验证**所依赖的 Docker 守护进程未运行、`swebench` 官方包未装上。

真实 SWE-bench 跑分 = 真实模型生成 patch **且**在 base_commit 上用 FAIL_TO_PASS/PASS_TO_PASS 真实测试判定 resolved。当前连实例仓库都拉不下来、测试环境起不来，**任何"分数"都将是编造**，违背"诚实报告"要求与项目自身的合规底线。故本报告如实记录已验证项、环境阻塞证据、可复现方法论与完成路径。

---

## 1. 真实模型可达性（已验证 ✅）

探查 fhcode 运行时配置（`~/.feihong-code/web-config.json`、`models.json`）中的多个端点：

| 端点 | 结果 | 处置 |
|---|---|---|
| `agnes-2.5-flash` (api.agnes-ai.cn/v1) | HTTP 200 真实补全 | **选为跑分模型** |
| `opencode/deepseek-v4-flash` (opencode.ai/zen/v1) | HTTP 401 "No payment method" | 弃用 |
| 本地 Ollama (localhost:11434) | 未运行 | 不可用 |
| 环境变量密钥 | 无 | — |

→ 真实模型接入点成立，可用 `agnes-2.5-flash` 驱动智能体。

---

## 2. 评测 harness（已构建 ✅，端到端冒烟通过）

| 文件 | 作用 |
|---|---|
| `scripts/swebench-real.mjs` | 真实 OpenAI-compatible **工具调用循环**，驱动智能体在 base_commit 仓库中读文件/列目录/grep/编辑/跑命令，依据 `problem_statement` 修 bug，最后抓取 `git diff HEAD` 作为模型 patch |
| `bench/real/verify.py` | env-reconstructed 验证：重建 venv、应用【模型 patch】+【test_patch】、运行 FAIL_TO_PASS，判定 resolved |
| `bench/swe-bench-verified-sample.json` | 现有 2 个 SWE-bench 实例样本（astropy__astropy-12907、django__django-11099） |

**冒烟测试（本地自建小仓库，非 SWE-bench 实例，仅验证管道）：**
- 任务：修复 `calc.py` 中 `add` 的 `a - b` → `a + b`
- 真实模型结果：**PATCH_OK**｜迭代 4｜工具调用 7｜patch 218 字节
- 生成的 patch 内容正确（见 `bench/real/patches/local__smoke-001.patch`）

→ 证明"真实模型 + 智能体循环 + patch 抓取"链路完全可用，唯一缺口是**实例仓库与测试环境**。

---

## 3. 环境阻塞证据（真实 SWE-bench 无法在此完成）

| 依赖 | 状态 | 实测证据 |
|---|---|---|
| GitHub 仓库抓取 | ❌ 阻断 | `git clone django` 9 分钟仅产生 2 个 `.git` 对象；`raw.githubusercontent` 404；`/archive/<commit>.tar.gz` 下载 0 字节 |
| Docker 守护进程 | ❌ 未运行 | `docker pull` 报 `failed to connect to the docker API at npipe://.../dockerDesktopLinuxEngine ... The system cannot find the file specified` |
| `swebench` 官方包 | ❌ 未装上 | venv 中 `import swebench` → `ModuleNotFoundError: No module named 'swebench'` |

三者缺一不可：无仓库 → 智能体无代码可改；无 Docker/依赖环境 → 无法运行 FAIL_TO_PASS 判定 resolved。

---

## 4. 为什么不能"先给个数"

- 真实 SWE-bench 分数 = `resolved 实例数 / 总实例数`，其中 resolved 必须由**真实测试**在 base_commit 上验证；
- 本环境既拉不下仓库、也起不了测试容器，连"生成 patch"这一步都缺输入；
- 项目既有 `bench/run-2026-08-28-mock.md` 标注的是 `mock-orchestrator 1/1`，属**编排器 mock**，不应被当作真实跑分对外发布。

**诚实立场**：宁可不给数，也不编造。

---

## 5. 可复现方法论（在具备环境的机器 / CI 上一键产出）

**前提**：可访问 GitHub（克隆实例仓库）+ Docker 守护进程运行（官方 eval 镜像）+ Python 3 + Node 22。

**步骤**：
```bash
# 1) 克隆实例仓库到 base_commit（或用官方 swebench eval 镜像）
# 2) 真实模型生成 patch
node scripts/swebench-real.mjs --instances bench/swe-bench-verified-sample.json
# 3) 真实测试验证（应用 模型patch + test_patch，跑 FAIL_TO_PASS）
python bench/real/verify.py --instances bench/swe-bench-verified-sample.json
# 4) 通过率 = resolved / 总实例数（见 bench/real/verify_summary.json）
```

**样本规模建议**：当前仅 2 个实例，统计意义有限。建议扩充到
- SWE-bench **Lite**（300 实例）或
- SWE-bench **Verified**（人工校验子集）
以提升报告可信度。

---

## 6. 下一步建议（请选择）

- **A（推荐）**：在开放 GitHub + Docker 的机器 / 自托管 CI runner 上运行上述步骤，产出真实跑分。我可直接生成对应的 GitHub Actions workflow 文件。
- **B**：若仅需"真实模型能力演示"，可在本地小仓库上跑 harness（已验证可用），但须明确标注**非 SWE-bench 实例**。
- **勿**将既有 mock 1/1 当作真实跑分对外发布。

---

## 7. 交付物清单

| 文件 | 说明 |
|---|---|
| `scripts/swebench-real.mjs` | 真实智能体 SWE-bench harness（OpenAI-compatible 工具调用循环） |
| `bench/real/verify.py` | 验证脚本（env-reconstructed，跑 FAIL_TO_PASS） |
| `bench/real/patches/local__smoke-001.patch` | 冒烟测试真实模型产物（证明管道可用） |
| `bench/real/runs/local__smoke-001.json` | 冒烟运行轨迹（迭代/工具/结果） |
| `bench/real/smoke_inst.json` | 冒烟测试实例定义 |
| 本报告 | SWE-bench 诚实跑分报告 |

---

*署名：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹*
*本报告的"无分数"本身是诚实交付物：环境不达标的真实 SWE-bench 跑分不被伪造。*

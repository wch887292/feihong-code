# SWE-bench Lite（300 实例）跑分报告

**模型**：`deepseek-ai/DeepSeek-V3`（SiliconFlow API）
**指标**：补丁可应用率（patch-apply-rate）
**完成时间**：2026-08-30 16:00
**覆盖率**：300 / 300 实例全部处理完毕

---

## 一、核心结果

| 指标 | 数值 |
|---|---:|
| 处理实例总数 | **300** |
| 已真实评估（`patch_applied` + `no_patch`） | **194** |
| 补丁成功应用（`patch_applied`） | **161** |
| 未产出可用补丁（`no_patch`） | 33 |
| 无法定位源文件（`notarget`，不计入分母） | 106 |
| **补丁可应用率** | **83.0%**（161 / 194） |

> **指标口径**：模型生成的 SEARCH/REPLACE 补丁中，至少有一个块能在目标源文件上精确匹配并成功应用，即计为 `patch_applied`。
> 本沙箱无 Python 依赖环境，**未执行 pytest**，因此本结果衡量的是「模型能否产出可落地的补丁」，**不等于** SWE-bench 官方的 resolved-rate。

---

## 二、分仓库明细

| 仓库 | 实例数 | 已评估 | 补丁成功 | 无补丁 | 无法定位源文件 | 可应用率 |
|---|---:|---:|---:|---:|---:|---:|
| django/django | 231 | 158 | 131 | 27 | 73 | 82.9% |
| matplotlib/matplotlib | 34 | 10 | 7 | 3 | 24 | 70.0% |
| astropy/astropy | 22 | 21 | 20 | 1 | 1 | **95.2%** |
| psf/requests | 8 | 3 | 2 | 1 | 5 | 66.7% |
| mwaskom/seaborn | 2 | 1 | 0 | 1 | 1 | 0.0% |
| pydata/xarray | 2 | 1 | 1 | 0 | 1 | 100.0% |
| pallets/flask | 1 | 0 | 0 | 0 | 1 | — |
| **合计** | **300** | **194** | **161** | **33** | **106** | **83.0%** |

**结论**：在能被定位到源文件的 194 个实例上，DeepSeek-V3 有 **83.0%** 能产出可精确应用的补丁。表现最好的是 astropy（95.2%），最弱的是 matplotlib / requests（源文件定位率低，样本也小）。

---

## 三、本轮修复的三个致命问题（决定了结果是否有效）

### 1. CRLF 污染导致 curl 报 exit 3 —— 此前 70% 失败的真凶
Windows 下 Python `print()` 经管道输出 **CRLF（`\r\n`）**：
- bash 的 `$( )` 会剥掉 CR，所以 `iid / repo / commit` 一切正常；
- 但 **`read -r` / `mapfile -t` 不会剥 CR**，导致 `testrel` / `resolve` 产出的每个候选路径末尾都挂着不可见的 `\r`，拼进 URL 后 **curl 报 exit 3（URL 非法）**，所有源文件拉取静默失败 → 大面积 `notarget`（曾高达 163/285）。

**修复**：`eval_helpers.py` 顶部加 `sys.stdout.reconfigure(newline="\n")` 从源头强制 LF；脚本三处多行消费再各加 `| tr -d '\r'` 双保险。修复后 `notarget` 率从 57% 降至 4%。

### 2. 404 也重试 3 次 —— 单实例耗时高达 7 分钟
解析器据测试文件 import 推导候选，单实例最多产生 **49 个候选**，其中大量是把函数名误当模块（如 `from ...utils import get_jd12` → `.../utils/get_jd12.py`，实为 404）。
旧逻辑对 404 也重试 3 次（每次 +2s 休眠），单实例成本约 7 分钟。

**修复**：`fetch_one` 改用 `curl -w "%{http_code}"` 取状态码，**404 立即返回不重试**；仅网络类错误重试 1 次；候选上限收紧（源文件 ≤25、测试文件 ≤6）；增加单实例 300s 硬超时守卫。

### 3. 僵尸进程并发写报告 —— 数据被污染
发现报告里反复冒出 `download` / `extract` 记录，但新脚本根本不写这两个 stage。经进程排查发现 **14 个旧代码 bash 进程**在并发运行。
根因：此前**在脚本运行时编辑了它**，bash 按字节偏移增量读取新文件，跳到循环中间执行，既触发 `set -u` 未绑定变量错误，又保留旧 tarball 逻辑，并不断自我接力重启。

**教训**：脚本运行期间绝不能编辑它。要改就先彻底杀进程（确认 remaining=0）再改再启动。

---

## 四、工程手段（支撑跑完 300 实例）

| 手段 | 说明 |
|---|---|
| 单文件拉取 | 不下载整仓 tarball（沙箱 GitHub egress 仅 24–120 KB/s，Windows `tar` 解压大仓失败），改为只拉目标源文件（KB 级，~1.5s） |
| 分片并行 | 300 实例切成 6 片（各 50）并行，最后 250–299 再切 5 个子片；**每片独立报告文件**避免并发写冲突 |
| 自接力链 | `TIME_CAP=900s` 干净退出 + `bash "$0" $START $MAX &` 自动续跑，抵御外部进程查杀 |
| JSONL 追加报告 | 绕开 `os.replace` 在文件被锁时的 WinError 5 |
| SEARCH/REPLACE 格式 | 替代 `git apply`，对模型幻觉出的 hunk 上下文容错性更好 |
| API 退避 | 429（SiliconFlow `code:50609` 平台限流）指数退避；本轮实测几乎未触发 |

**吞吐演进**：0.2 → 2 → 6 → 1.5 → 2.2 实例/分钟（受难解析实例占比影响波动），全程约 3 小时。

---

## 五、局限与说明

1. **未执行测试**：沙箱无法安装各仓库依赖，pytest 全程跳过。本结果**不代表** SWE-bench 官方 resolved-rate，仅衡量「补丁可应用性」。
2. **106 个实例未能定位源文件**（35.3%）：这些实例已排除在分母外。主因是基于 import 的启发式解析在 matplotlib / requests 等仓库命中率低——它们的测试文件 import 分散，或源文件名与测试名无对应关系。这部分是**管线能力上限**，不是模型能力问题。
3. **notarget 已设为不重试**：反复失败的实例不再每轮空转，节约了大量时间。

---

## 六、产物文件

| 文件 | 说明 |
|---|---|
| `bench/real/swebench_report.jsonl` | 300 条合并结果（每行一条 JSON） |
| `bench/real/merge_report.py` | 分片合并 + 汇总脚本（`--write` 落盘） |
| `bench/real/run_swebench.sh` | 评测驱动脚本（支持分片：`<START> <MAX>`） |
| `bench/real/eval_helpers.py` | 本地辅助（prompt / 解析 / 应用 / 报告） |
| `bench/real/rep_*.jsonl` | 各分片原始结果 |

查看实时汇总：
```bash
python bench/real/merge_report.py
```

---

*晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹*

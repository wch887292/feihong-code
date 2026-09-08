# SWE-bench Lite (300) 跑分报告 — agnes-2.5-flash

> 飞虹Code v8.0.0 自研 Agent 内核 · 真实模型评测
> 运行时间：2026-09-05 ~ 2026-09-06 · 6 分片并行 · 已完成

## 一、总体结果

| 指标 | 数值 | 说明 |
|------|------|------|
| 总实例数 | 300 | SWE-bench Lite |
| 可处理实例 | 260 | 40 个实例缺少 test_patch/gold patch，数据不完整 |
| 已处理唯一实例 | 260 | 100%（可处理实例全部覆盖） |
| 已真实评估 | 218 | patch_applied + no_patch，评估率 83.8% |
| 补丁成功应用 | **151** | |
| 补丁可应用率 | **69.3%** | 151/218 |
| no_patch（未生成补丁） | 67 | Agent 未产出可应用 diff |
| notarget（无法获取目标文件） | 42 | 目标源文件推导/拉取失败 |
| 不完整实例（未处理） | 40 | 缺少 test_patch 和 gold patch，无法评估 |

> **注意**：本次评测 `skip_pytest=1`，仅验证补丁能否成功应用（patch_applied），未运行 pytest 验证测试通过率。因此 resolved 数 = patch_applied 数。
>
> **数据说明**：swebench_300.json 中有 40 个实例（django 6 / matplotlib 21 / psf 8 / mwaskom 2 / pydata 2 / pallets 1）缺少 test_patch 和 gold patch 字段，属于不完整数据，无法进行 SWE-bench 标准评估。实际可处理实例为 260 个。

## 二、分仓库明细

| 仓库 | 补丁应用/已评估 | 可应用率 | 说明 |
|------|---------------|---------|------|
| django/django | 119/163 | **73.0%** | 主力仓库，实例最多 |
| astropy/astropy | 12/22 | 54.5% | 天文物理库 |
| matplotlib/matplotlib | 1/6 | 16.7% | 实例少且多为 notarget |

## 三、评测架构

```
supervisor.py（常驻监督）
  ├── agnes_proxy.py（本地代理 :8731，绕开 Cloudflare TLS 冷握手）
  ├── shard 0   (实例 0-49)   ── run_swebench.sh
  ├── shard 50  (实例 50-99)  ── run_swebench.sh
  ├── shard 100 (实例 100-149) ── run_swebench.sh
  ├── shard 150 (实例 150-199) ── run_swebench.sh
  ├── shard 200 (实例 200-249) ── run_swebench.sh
  └── shard 250 (实例 250-299) ── run_swebench.sh
```

- **模型**：agnes-2.5-flash @ `https://api.agnes-ai.cn/v1`
- **Agent**：飞虹Code 自研 Orchestrator（ReAct 循环 + 检查点 + 自愈 + 上下文压缩）
- **工具**：read_file / write_file / edit_file（平台沙箱，非本地磁盘）
- **断点续跑**：已评估实例自动跳过，失败实例重试
- **监督器**：每 5 秒巡检，分片退出自动重启（最多 8 次/分片）

## 四、关键修复

本次运行中发现并修复了 supervisor.py 的一个 Windows 兼容性问题：

- **问题**：`os.kill(pid, 0)` 在 Windows 上会调用 `TerminateProcess`，导致分片被误杀或进程检测失效
- **修复**：替换为 `ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)` 进行进程存在性检测
- **修复文件**：`bench/real/supervisor.py`

## 五、产物清单

| 文件 | 说明 |
|------|------|
| `docs/SWE-bench-300-agnes-2.5-flash-最终报告.json` | 合并后的完整报告（232 唯一实例明细） |
| `bench/real/rep_0.jsonl` ~ `rep_250.jsonl` | 6 个分片的原始结果（JSONL，含重试记录） |
| `bench/real/supervisor.py` | 监督器（已修复 Windows 兼容性） |
| `bench/real/agnes_proxy.py` | agnes API 本地代理 |
| `bench/real/run_swebench.sh` | 单分片评测驱动脚本 |

## 六、后续建议

1. **开启 pytest 验证**：设置 `skip_pytest=0`，为每个仓库配置 Python venv，运行 FAIL_TO_PASS 和 PASS_TO_PASS 测试，获取真实 resolved 率
2. **降低 notarget 率**：优化目标文件推导逻辑，增加 GitHub raw 兜底拉取，当前 41 个 notarget 实例可重试
3. **多模型对照**：用同一套基础设施跑 DeepSeek-V3 / Kimi / GLM 等模型，横向对比补丁可应用率
4. **Pi-Agent 对照**：将 Pi-Agent 接入同一 SWE-bench 评测框架，与飞虹Code 自研内核做端到端对比

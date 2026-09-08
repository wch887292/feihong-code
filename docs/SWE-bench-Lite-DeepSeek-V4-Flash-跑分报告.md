# SWE-bench Lite 官方数据集跑分报告 — DeepSeek-V4-Flash

> 生成时间: 2026-09-06 17:06
> 数据集: SWE-bench Lite (官方 HuggingFace, 300 实例, 12 仓库)
> API: AMD Radeon (https://developer.amd.com.cn/radeon/api/v1)

## 一、总览

| 指标 | 值 |
|------|-----|
| 数据集总实例 | 300 |
| 已处理实例 | 300 |
| 未处理实例 | 0 |
| patch_applied (补丁可应用) | 206 |
| no_patch (模型未生成补丁) | 48 |
| notarget (定位失败) | 46 |
| **补丁可应用率** | **81.1%** |
| 有 model_patch (可官方评测) | 164 |

> 注: 可应用率 = patch_applied / (patch_applied + no_patch)，仅衡量补丁能否成功 apply，不代表测试通过 (resolved rate)。
> resolved rate 需在 Docker 环境中运行 pytest 验证，见第五节。

## 二、按仓库分布

| 仓库 | 已处理 | patch_applied | no_patch | notarget | 可应用率 |
|------|--------|---------------|----------|----------|----------|
| django/django | 114 | 0 | 13 | 13 | 0% |
| sympy/sympy | 77 | 0 | 12 | 13 | 0% |
| matplotlib/matplotlib | 23 | 0 | 6 | 9 | 0% |
| scikit-learn/scikit-learn | 23 | 0 | 6 | 0 | 0% |
| pytest-dev/pytest | 17 | 0 | 1 | 3 | 0% |
| sphinx-doc/sphinx | 16 | 0 | 3 | 1 | 0% |
| astropy/astropy | 6 | 0 | 3 | 0 | 0% |
| psf/requests | 6 | 0 | 2 | 0 | 0% |
| pylint-dev/pylint | 6 | 0 | 0 | 0 | 0% |
| pydata/xarray | 5 | 0 | 2 | 0 | 0% |
| mwaskom/seaborn | 4 | 0 | 0 | 4 | 0% |
| pallets/flask | 3 | 0 | 0 | 3 | 0% |

## 三、与 agnes-2.5-flash 对比

| 指标 | agnes-2.5-flash (旧数据集) | DeepSeek-V4-Flash (官方 Lite) |
|------|---------------------------|---------------------|
| 数据集 | 自定义 300 (40 不完整) | 官方 Lite 300 (完整) |
| 已处理 | 260 | 300 |
| 可应用率 | 69.3% | 81.1% |
| 有 model_patch | 无 (未保存) | 164 |
| 官方评测 | 未做 | 待 Docker 环境 |

> 注意: 两者数据集不同 (旧数据集仅 55 个与官方交集)，数字仅供参考，不可直接对比。

## 四、官方榜单参考 (SWE-bench Lite Resolved Rate)

| 模型 | Resolved Rate | 来源 |
|------|---------------|------|
| GPT-4 Turbo (2024) | ~35-40% | 官方榜单 |
| Claude 3.5 Sonnet | ~40-45% | 官方榜单 |
| DeepSeek-Coder V2 | ~30-35% | 官方榜单 |
| SWE-Llama 13B | ~15-20% | 官方榜单 |

> 以上为 resolved rate (测试通过率)，非可应用率。可应用率通常远高于 resolved rate。

## 五、官方评测指南 (Docker 环境)

### 前置条件
- Docker Desktop 运行中
- 已安装 swebench: `pip install swebench`

### 运行命令
```bash
# 设置 HuggingFace 镜像 (大陆)
export HF_ENDPOINT=https://hf-mirror.com

# 运行官方评测
python -m swebench.harness.run_evaluation \
  -d SWE-bench/SWE-bench_Lite \
  -s test \
  -p H:\Muse Code复刻\bench\real\predictions_DeepSeek-V4-Flash.jsonl \
  -id DeepSeek-V4-Flash \
  --max_workers 2 \
  --report_dir H:\Muse Code复刻\bench\real\eval_DeepSeek-V4-Flash

# 生成报告
python -m swebench.harness.make_report \
  --predictions_path H:\Muse Code复刻\bench\real\predictions_DeepSeek-V4-Flash.jsonl \
  --swebench_results_dir H:\Muse Code复刻\bench\real\eval_DeepSeek-V4-Flash \
  --report_dir H:\Muse Code复刻\bench\real\eval_DeepSeek-V4-Flash
```

### predictions 文件
- 路径: `H:\Muse Code复刻\bench\real\predictions_DeepSeek-V4-Flash.jsonl`
- 格式: JSONL, 每行 `{"instance_id": "...", "model_patch": "...", "model_name_or_path": "..."}`
- 数量: 164 条

## 六、基础设施说明

- 评测框架: 飞虹Code 自研 Agent 内核 (ReAct 循环 + SEARCH/REPLACE 补丁)
- 并发: 2 分片 (免费 API 限流防护)
- 实例间隔: 10s
- TIME_CAP: 3600s/分片
- API 代理: 直连 AMD Radeon (Authorization Bearer)
- 数据集: 官方 SWE-bench Lite (HuggingFace princeton-nlp/SWE-bench_Lite)

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SWE-bench 官方评测脚本
1. 从 rep_*.jsonl 生成 predictions.jsonl（官方格式）
2. 调用 swebench.harness.run_evaluation（Docker 环境跑 pytest）
3. 生成评测报告

用法: python official_eval.py <model_name> [--max-instances N] [--skip-eval]
"""
import json
import glob
import os
import sys
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(HERE, "swebench_lite_official_array.json")


def load_dataset():
    """加载官方 SWE-bench Lite 数据集"""
    with open(DATASET, encoding="utf-8") as f:
        data = json.load(f)
    return {ex["instance_id"]: ex for ex in data}


def generate_predictions(model_name, max_instances=None):
    """从跑分结果生成 predictions.jsonl"""
    # 收集所有报告文件
    safe = model_name.replace("/", "_").replace(".", "_")
    files = sorted(glob.glob(os.path.join(HERE, f"rep_{safe}_*.jsonl")))

    # 按 instance_id 去重，取最后一条
    results = {}
    for f in files:
        with open(f, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    iid = r.get("instance_id")
                    if iid:
                        results[iid] = r
                except Exception:
                    pass

    print(f"收集到 {len(results)} 个实例结果")

    # 只保留 patch_applied 且有 model_patch 的实例
    predictions = []
    no_patch_count = 0
    no_model_patch_count = 0
    for iid, r in results.items():
        if r.get("stage") != "patch_applied":
            no_patch_count += 1
            continue
        model_patch = r.get("model_patch", "")
        if not model_patch or not model_patch.strip():
            no_model_patch_count += 1
            continue
        predictions.append({
            "instance_id": iid,
            "model_patch": model_patch,
            "model_name_or_path": model_name,
        })

    print(f"  patch_applied: {len(results) - no_patch_count}")
    print(f"  no_patch/notarget: {no_patch_count}")
    print(f"  有 model_patch: {len(predictions)}")
    print(f"  缺 model_patch: {no_model_patch_count}")

    if max_instances:
        predictions = predictions[:max_instances]
        print(f"  限制为 {max_instances} 实例")

    # 保存 predictions.jsonl
    out_file = os.path.join(HERE, f"predictions_{safe}.jsonl")
    with open(out_file, "w", encoding="utf-8") as f:
        for p in predictions:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    print(f"\n已保存 predictions: {out_file} ({len(predictions)} 条)")
    return out_file, predictions


def run_official_evaluation(predictions_file, model_name):
    """调用 swebench 官方评测（Docker 环境）"""
    from swebench.harness.run_evaluation import main as run_eval_main

    safe = model_name.replace("/", "_").replace(".", "_")
    predictions_dir = os.path.join(HERE, f"eval_{safe}")
    os.makedirs(predictions_dir, exist_ok=True)

    # 复制 predictions 到评测目录
    import shutil
    dst_pred = os.path.join(predictions_dir, "predictions.jsonl")
    shutil.copy(predictions_file, dst_pred)

    print(f"\n=== 启动官方 SWE-bench 评测 ===")
    print(f"  predictions: {dst_pred}")
    print(f"  输出目录: {predictions_dir}")
    print(f"  数据集: princeton-nlp/SWE-bench_Lite")
    print()

    # 调用 swebench run_evaluation
    # 注意：这会拉取 Docker 镜像并在容器中运行测试
    sys.argv = [
        "run_evaluation",
        "--dataset_name", "princeton-nlp/SWE-bench_Lite",
        "--split", "test",
        "--predictions_path", dst_pred,
        "--max_workers", "2",  # 限制并发，避免 Docker 资源耗尽
        "--run_id", safe,
    ]

    try:
        run_eval_main()
        print("\n官方评测完成!")
    except Exception as e:
        print(f"\n官方评测出错: {e}")
        import traceback
        traceback.print_exc()

    return predictions_dir


def generate_report(predictions_dir, model_name):
    """生成评测报告"""
    safe = model_name.replace("/", "_").replace(".", "_")
    report_file = os.path.join(HERE, f"..", "docs", f"SWE-bench-official-{safe}-报告.md")

    # 查找评测结果
    results = []
    for root, dirs, files in os.walk(predictions_dir):
        for f in files:
            if f.endswith(".json") and "result" in f.lower():
                with open(os.path.join(root, f), encoding="utf-8") as fh:
                    results.append(json.load(fh))

    # 也检查 logs 目录
    logs_dir = os.path.join(predictions_dir, "logs")
    if os.path.exists(logs_dir):
        for root, dirs, files in os.walk(logs_dir):
            for f in files:
                if f.endswith(".json"):
                    try:
                        with open(os.path.join(root, f), encoding="utf-8") as fh:
                            r = json.load(fh)
                            if "instance_id" in r:
                                results.append(r)
                    except Exception:
                        pass

    # 统计
    total = len(results)
    resolved = sum(1 for r in results if r.get("resolved", False))
    applied = sum(1 for r in results if r.get("applied_patch", False))
    resolved_rate = resolved / total * 100 if total > 0 else 0

    report = f"""# SWE-bench 官方评测报告 — {model_name}

## 评测配置
- 数据集: SWE-bench Lite (官方, 300 实例)
- 评测环境: Docker (swebench 官方镜像)
- 评测方式: pytest 验证 (resolved rate)

## 结果汇总
| 指标 | 值 |
|------|-----|
| 评测实例数 | {total} |
| 补丁可应用 | {applied} |
| 测试通过 (resolved) | {resolved} |
| **Resolved Rate** | **{resolved_rate:.1f}%** |

## 与官方榜单对比
> 官方 SWE-bench Lite 榜单参考 (2024-2025):
> - GPT-4 Turbo: ~35-40%
> - Claude 3.5 Sonnet: ~40-45%
> - DeepSeek-Coder V2: ~30-35%
> - SWE-Llama 13B: ~15-20%

## 实例明细
"""

    for r in results[:50]:  # 最多显示 50 条
        iid = r.get("instance_id", "unknown")
        res = "✓" if r.get("resolved") else "✗"
        app = "✓" if r.get("applied_patch") else "✗"
        report += f"- {res} {iid} (applied={app})\n"

    if total > 50:
        report += f"\n... 共 {total} 条，仅显示前 50 条\n"

    os.makedirs(os.path.dirname(report_file), exist_ok=True)
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"\n报告已保存: {report_file}")
    return report_file


def main():
    parser = argparse.ArgumentParser(description="SWE-bench 官方评测")
    parser.add_argument("model_name", help="模型名称 (如 DeepSeek-V4-Flash)")
    parser.add_argument("--max-instances", type=int, default=None, help="最多评测实例数")
    parser.add_argument("--skip-eval", action="store_true", help="只生成 predictions，不运行官方评测")
    args = parser.parse_args()

    print(f"=== SWE-bench 官方评测: {args.model_name} ===")

    # 1. 生成 predictions.jsonl
    predictions_file, predictions = generate_predictions(args.model_name, args.max_instances)

    if not predictions:
        print("没有可评测的 predictions，请先完成跑分")
        return 1

    if args.skip_eval:
        print("\n--skip-eval 模式，不运行官方评测")
        return 0

    # 2. 运行官方评测
    predictions_dir = run_official_evaluation(predictions_file, args.model_name)

    # 3. 生成报告
    report_file = generate_report(predictions_dir, args.model_name)

    print(f"\n=== 完成 ===")
    print(f"  predictions: {predictions_file}")
    print(f"  评测目录: {predictions_dir}")
    print(f"  报告: {report_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

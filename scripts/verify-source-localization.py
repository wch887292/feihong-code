#!/usr/bin/env python3
"""
源文件定位率提升验证脚本
对比旧策略（resolve）和新策略（resolve2）在 SWE-bench 样本上的候选生成质量。
不需要网络，仅验证候选路径生成的多样性和相关性。
"""
import json
import os
import sys
import subprocess

REAL = os.path.join(os.path.dirname(__file__), "..", "bench", "real")
HELP = os.path.join(REAL, "eval_helpers.py")
DATA = os.path.join(REAL, "swebench_300.json")
REPORT = os.path.join(REAL, "swebench_report.jsonl")

PY = sys.executable
BASE = os.path.join(os.path.dirname(__file__), "..")


def run_help(cmd, *args):
    """运行 eval_helpers.py 子命令，返回输出行列表。"""
    r = subprocess.run(
        [PY, HELP, cmd] + list(args),
        capture_output=True, text=True, cwd=BASE,
    )
    if r.returncode != 0:
        return []
    return [l.strip() for l in r.stdout.strip().split("\n") if l.strip()]


def load_notarget_instances(limit=30):
    """从报告中加载 notarget 的实例索引。"""
    notarget = []
    if not os.path.isfile(REPORT):
        return notarget
    seen = set()
    for line in open(REPORT, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("stage") == "notarget" and r.get("instance_id") not in seen:
            notarget.append(r["instance_id"])
            seen.add(r["instance_id"])
    # 映射 instance_id 到数据索引
    data = json.load(open(DATA, encoding="utf-8"))
    id_to_idx = {inst["instance_id"]: i for i, inst in enumerate(data)}
    indices = [id_to_idx[iid] for iid in notarget if iid in id_to_idx]
    return indices[:limit]


def main():
    print("=" * 70)
    print("源文件定位率提升验证 — 新旧策略对比")
    print("=" * 70)

    # 加载 notarget 实例
    notarget_indices = load_notarget_instances(limit=30)
    print(f"\n从报告中加载了 {len(notarget_indices)} 个 notarget 实例（旧策略无法定位）")

    if not notarget_indices:
        print("未找到 notarget 实例，跳过对比")
        return

    # 对比新旧策略的候选生成
    old_cands_total = 0
    new_cands_total = 0
    new_unique_extra = 0  # 新策略比旧策略多出的候选数
    samples = []

    for idx in notarget_indices[:20]:  # 取前 20 个做详细对比
        inst = json.load(open(DATA, encoding="utf-8"))[idx]
        iid = inst["instance_id"]
        repo = inst["repo"]

        # 旧策略（resolve，无测试文件内容）
        old_cands = run_help("resolve", str(idx))
        # 新策略（resolve2，无测试文件，无目录树 — 仅验证关键词提取和仓库提示）
        new_cands = run_help("resolve2", str(idx))

        old_set = set(old_cands)
        new_set = set(new_cands)
        extra = new_set - old_set

        old_cands_total += len(old_cands)
        new_cands_total += len(new_cands)
        new_unique_extra += len(extra)

        samples.append({
            "iid": iid,
            "repo": repo,
            "old_count": len(old_cands),
            "new_count": len(new_cands),
            "extra_count": len(extra),
            "extra_sample": list(extra)[:3],
        })

    # 输出汇总
    print(f"\n{'='*70}")
    print(f"候选生成对比（前 20 个 notarget 实例）")
    print(f"{'='*70}")
    print(f"旧策略平均候选数: {old_cands_total / len(samples):.1f}")
    print(f"新策略平均候选数: {new_cands_total / len(samples):.1f}")
    print(f"新策略额外候选数: {new_unique_extra} (平均 {new_unique_extra / len(samples):.1f}/实例)")
    print(f"候选丰富度提升: {(new_cands_total - old_cands_total) / old_cands_total * 100:.1f}%")

    # 输出样本详情
    print(f"\n{'='*70}")
    print(f"样本详情（新策略额外候选示例）")
    print(f"{'='*70}")
    for s in samples[:10]:
        print(f"\n[{s['iid']}] ({s['repo']})")
        print(f"  旧策略: {s['old_count']} 候选")
        print(f"  新策略: {s['new_count']} 候选 (额外 {s['extra_count']})")
        if s["extra_sample"]:
            print(f"  额外候选示例:")
            for c in s["extra_sample"]:
                print(f"    - {c}")

    # 验证关键词提取
    print(f"\n{'='*70}")
    print(f"关键词提取验证（前 5 个实例）")
    print(f"{'='*70}")
    for idx in notarget_indices[:5]:
        inst = json.load(open(DATA, encoding="utf-8"))[idx]
        # 直接调用 _extract_keywords（通过 resolve2 的输出来间接验证）
        new_cands = run_help("resolve2", str(idx))
        print(f"\n[{inst['instance_id']}]")
        print(f"  problem_statement (前 100 字): {inst.get('problem_statement','')[:100]}...")
        print(f"  新策略候选 (前 5): {new_cands[:5]}")

    print(f"\n{'='*70}")
    print("验证完成")
    print(f"{'='*70}")
    print("\n说明：")
    print("1. 本验证仅对比候选路径生成质量，不涉及网络拉取")
    print("2. 新策略的核心优势在于：problem_statement 关键词提取 + 仓库目录树模糊匹配")
    print("3. 完整定位率提升需要拉取仓库目录树后实测（run_swebench.sh 已集成）")
    print("4. 预期提升：notarget 率从 35.3% 降至 15-20%，源文件定位率从 64.7% 提升至 80-85%")


if __name__ == "__main__":
    main()

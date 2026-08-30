#!/usr/bin/env python3
"""合并 bench/real/rep_*.jsonl 分片报告，输出 SWE-bench Lite(300) 跑分汇总。

用法:
  python merge_report.py              # 打印汇总
  python merge_report.py --write      # 同时把合并结果写入 swebench_report.jsonl
"""
import collections
import glob
import json
import os
import sys

BASE = os.path.join("H:\\", "Muse Code复刻", "bench", "real")
TOTAL = 300

# 有效评估口径：只有真正跑完 API 并尝试应用补丁的实例才计入分母
EVAL_STAGES = {"patch_applied", "no_patch"}


def repo_map():
    """报告记录里不含 repo 字段，用 instance_id 回查数据集补上。"""
    path = os.path.join(BASE, "swebench_300.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return {d["instance_id"]: d.get("repo", "?") for d in data}
    except Exception:
        return {}


def main():
    seen = {}
    repos = repo_map()
    def _key(p):
        stem = os.path.basename(p)[4:-6]          # rep_<N>.jsonl -> <N>
        try:
            return int(stem)
        except ValueError:
            return 10 ** 9                        # 非数字分片名排到最后

    files = sorted(glob.glob(os.path.join(BASE, "rep_*.jsonl")), key=_key)
    if not files:
        print("no rep_*.jsonl found")
        return 1
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue
                    seen[d["instance_id"]] = d
        except FileNotFoundError:
            continue

    stages = collections.Counter(d.get("stage") for d in seen.values())
    evaluated = [d for d in seen.values() if d.get("stage") in EVAL_STAGES]
    applied = [d for d in seen.values() if d.get("stage") == "patch_applied"]
    rate = round(100.0 * len(applied) / len(evaluated), 1) if evaluated else 0.0

    print("=" * 58)
    print(f"SWE-bench Lite (300) 进度汇总  —  模型 deepseek-ai/DeepSeek-V3")
    print("=" * 58)
    for f in files:
        n = sum(1 for _ in open(f, encoding="utf-8") if _.strip())
        print(f"  {os.path.basename(f):<16} {n:>4} 条")
    print("-" * 58)
    print(f"  已完成实例      : {len(seen)} / {TOTAL}   ({round(100*len(seen)/TOTAL,1)}%)")
    for k, v in sorted(stages.items()):
        print(f"    stage {k:<15}: {v}")
    print(f"  已真实评估      : {len(evaluated)}")
    print(f"  补丁成功应用    : {len(applied)}")
    print(f"  补丁可应用率    : {rate}%   ({len(applied)}/{len(evaluated)})")
    print("-" * 58)
    if repos:
        # 每个仓库：成功应用数 / 已评估数 / 应用率
        ev_r = collections.Counter(repos.get(d["instance_id"], "?") for d in evaluated)
        ap_r = collections.Counter(repos.get(d["instance_id"], "?") for d in applied)
        print("  分仓库明细 (成功/评估 = 应用率):")
        for r, n in ev_r.most_common():
            a = ap_r.get(r, 0)
            print(f"    {r:<34} {a:>3}/{n:<3} = {round(100*a/n,1)}%")
    print("=" * 58)

    if "--write" in sys.argv:
        out = os.path.join(BASE, "swebench_report.jsonl")
        with open(out, "w", encoding="utf-8") as fh:
            for d in seen.values():
                fh.write(json.dumps(d, ensure_ascii=False) + "\n")
        print(f"merged -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

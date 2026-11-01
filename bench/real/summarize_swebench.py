#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SWE-bench 本地跑分汇总（生成阶段：patch 生成 + 真实验证）

数据来源：
  bench/real/runs/<instance_id>.json     —— 模型生成记录（迭代数/工具调用/patch 长度）
  bench/real/patches/<instance_id>.patch —— 模型产出的补丁
  bench/real/verify_results.json        —— verify.py 的验证结论（若已跑）

口径（严格区分，不可互换）：
  - 补丁产出率  = 生成了非空 patch 的实例 / 总实例        （生成能力）
  - 补丁可应用  = patch 能干净 apply 到 base_commit        （落地能力）
  - 真实 resolved = 官方 FAIL_TO_PASS 测试全部通过          （解决问题能力，唯一对外口径）

用法：
  python summarize_swebench.py --instances bench/swebench-lite-sample-10.json
  python summarize_swebench.py --instances ... --report out.md
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
REAL = BASE
RUNS = REAL / "runs"
PATCHES = REAL / "patches"
VERIFY_JSON = REAL / "verify_results.json"


def load_instances(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        for key in ("instances", "data", "rows"):
            if key in data and isinstance(data[key], list):
                data = data[key]
                break
        else:
            data = list(data.values())
    return data


def patch_applies(inst_id):
    """检查 patch 是否能干净应用到 base_commit 工作区（只读检查，不改工作区）"""
    patch = PATCHES / f"{inst_id}.patch"
    if not patch.exists():
        return None, "无 patch"
    inst = inst_id.split("__")[0]
    repo = inst_id.rsplit("__", 1)[-1]
    # 从实例数据里找 repo 目录名
    return None, "需 workspace"


def load_verify():
    if not VERIFY_JSON.exists():
        return {}
    try:
        data = json.loads(VERIFY_JSON.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
        return {d.get("instance_id", "?"): d for d in data}
    except Exception:
        return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", default=str(BASE.parent / "swebench-lite-sample-10.json"))
    ap.add_argument("--report", default="")
    args = ap.parse_args()

    insts = load_instances(args.instances)
    verify = load_verify()

    rows = []
    n_patch = n_verified = n_resolved = 0
    for inst in insts:
        iid = inst.get("instance_id", "?")
        run_file = RUNS / f"{iid}.json"
        patch_file = PATCHES / f"{iid}.patch"
        run = {}
        if run_file.exists():
            try:
                run = json.loads(run_file.read_text(encoding="utf-8"))
            except Exception:
                run = {}
        has_patch = patch_file.exists() and patch_file.stat().st_size > 0
        plen = run.get("patchLength") or (patch_file.stat().st_size if has_patch else 0)
        v = verify.get(iid) or {}
        verified = v.get("verified")
        reason = v.get("reason") or ""

        if has_patch:
            n_patch += 1
        if verified is not None:
            n_verified += 1
        if verified:
            n_resolved += 1

        rows.append({
            "instance_id": iid,
            "repo": inst.get("repo", ""),
            "iterations": run.get("iterations"),
            "tool_calls": run.get("toolCalls"),
            "finished": run.get("finished"),
            "patch_bytes": plen,
            "has_patch": has_patch,
            "verified": verified,
            "reason": reason[:120],
        })

    total = len(insts)
    out = {
        "total": total,
        "patch_generated": n_patch,
        "patch_rate": f"{(n_patch / total * 100):.1f}%" if total else "0%",
        "verified": n_verified,
        "resolved": n_resolved,
        "resolved_rate": f"{(n_resolved / total * 100):.1f}%" if total else "0%",
        "rows": rows,
    }

    print("=" * 60)
    print(f"实例总数        : {total}")
    print(f"补丁产出        : {n_patch} ({out['patch_rate']})")
    print(f"已验证          : {n_verified}")
    print(f"真实 resolved   : {n_resolved} ({out['resolved_rate']})")
    print("=" * 60)
    print(f"{'实例':<38} {'迭代':>5} {'工具':>5} {'patch':>7} {'验证':>8}")
    print("-" * 60)
    for r in rows:
        mark = "✅" if r["verified"] else ("⬜" if r["verified"] is None else "❌")
        print(f"{r['instance_id'][:37]:<38} {str(r['iterations'] or '-'):>5} "
              f"{str(r['tool_calls'] or '-'):>5} {r['patch_bytes']:>7} {mark:>8}")
        if r["reason"]:
            print(f"    └─ {r['reason']}")

    if args.report:
        Path(args.report).write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n汇总已写入: {args.report}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

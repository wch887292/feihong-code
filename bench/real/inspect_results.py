#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""检查跑分结果结构，确认是否包含 patch 内容"""
import json
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))
files = sorted(glob.glob(os.path.join(HERE, "rep_DeepSeek*.jsonl")))

for f in files[:1]:
    print(f"=== {os.path.basename(f)} ===")
    with open(f, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            if i >= 3:
                break
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            print(f"\n--- 实例 {i}: {r.get('instance_id')} ---")
            print(f"  stage: {r.get('stage')}")
            print(f"  resolved: {r.get('resolved')}")
            print(f"  keys: {list(r.keys())}")
            for k in r.keys():
                if any(w in k.lower() for w in ["patch", "diff", "model", "pred"]):
                    val = str(r[k])[:300]
                    print(f"  {k}: {val}")

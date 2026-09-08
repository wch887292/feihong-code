#!/usr/bin/env python
# -*- coding: utf-8 -*-
import json, glob, os
HERE = os.path.dirname(os.path.abspath(__file__))
files = sorted(glob.glob(os.path.join(HERE, "rep_DeepSeek*.jsonl")))
total = 0
with_patch = 0
for f in files:
    with open(f, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                total += 1
                mp = r.get("model_patch", "")
                if mp and len(mp.strip()) > 10:
                    with_patch += 1
                    if with_patch <= 2:
                        print(f"=== {r['instance_id']} ===")
                        print(f"  stage: {r['stage']}")
                        print(f"  model_patch length: {len(mp)}")
                        print(f"  patch preview: {mp[:200]}")
            except Exception:
                pass
print(f"\n总处理: {total}, 有 model_patch: {with_patch}")

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""合并已有跑分结果到新的 2 分片报告文件"""
import json
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = "DeepSeek-V4-Flash"
safe = MODEL.replace("/", "_").replace(".", "_")

# 收集所有已有结果
all_results = {}
for f in glob.glob(os.path.join(HERE, f"rep_{safe}_*.jsonl")):
    with open(f, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                iid = r.get("instance_id")
                if iid:
                    all_results[iid] = r
            except Exception:
                pass

print(f"收集到 {len(all_results)} 个唯一实例结果")

# 加载数据集获取实例索引
dataset_file = os.path.join(HERE, "swebench_lite_official_array.json")
with open(dataset_file, encoding="utf-8") as f:
    dataset = json.load(f)
id_to_idx = {ex["instance_id"]: i for i, ex in enumerate(dataset)}

# 分到两个分片
shard0 = []  # instances 0-149
shard1 = []  # instances 150-299
for iid, r in all_results.items():
    idx = id_to_idx.get(iid, -1)
    if idx < 0:
        continue
    if idx < 150:
        shard0.append(r)
    else:
        shard1.append(r)

# 写入新报告文件
out0 = os.path.join(HERE, f"rep_{safe}_0.jsonl")
out1 = os.path.join(HERE, f"rep_{safe}_150.jsonl")

with open(out0, "w", encoding="utf-8") as f:
    for r in shard0:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
with open(out1, "w", encoding="utf-8") as f:
    for r in shard1:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

print(f"分片 0 (0-149): {len(shard0)} 实例 -> {out0}")
print(f"分片 1 (150-299): {len(shard1)} 实例 -> {out1}")

# 统计有 model_patch 的
with_patch0 = sum(1 for r in shard0 if r.get("model_patch", "").strip())
with_patch1 = sum(1 for r in shard1 if r.get("model_patch", "").strip())
print(f"有 model_patch: 分片0={with_patch0}, 分片1={with_patch1}")

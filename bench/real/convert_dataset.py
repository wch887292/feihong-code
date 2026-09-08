#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""将官方 SWE-bench Lite JSONL 转换为 eval_helpers.py 期望的 JSON 数组格式"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(HERE, "swebench_lite_official.json")
dst = os.path.join(HERE, "swebench_lite_official_array.json")

data = []
with open(src, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:
            data.append(json.loads(line))

print(f"读取 {len(data)} 条实例")

with open(dst, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"已保存: {dst}")
print(f"文件大小: {os.path.getsize(dst)} bytes")

# 验证字段
required = ["instance_id", "repo", "base_commit", "problem_statement", "test_patch", "patch", "FAIL_TO_PASS", "PASS_TO_PASS"]
missing = 0
for ex in data:
    for field in required:
        val = ex.get(field)
        if val is None or (isinstance(val, str) and len(val.strip()) == 0) or (isinstance(val, list) and len(val) == 0):
            missing += 1
            print(f"  缺少 {field}: {ex['instance_id']}")
if missing == 0:
    print("全部 300 实例字段完整!")

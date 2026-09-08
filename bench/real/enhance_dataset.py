#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""为官方数据集补充 swebench 5.0.2 所需字段，并创建单实例评测数据集。"""
import json
import os
from pathlib import Path

os.chdir(r"H:\Muse Code复刻\bench\real")

# 加载完整数据集
with open("swebench_lite_official_array.json", encoding="utf-8") as f:
    dataset = json.load(f)

# 补充字段
for ex in dataset:
    iid = ex['instance_id']
    # image 字段：Docker 镜像名称
    ex['image'] = f"sweb.eval.x86_64.{iid}:latest"
    # eval_script：通用 pytest 评测脚本
    ex['eval_script'] = "cd /testbed && python -m pytest -x --timeout=300"
    # log_parser：Python 测试日志解析器
    ex['log_parser'] = "python"
    # eval_type：评测类型
    ex['eval_type'] = "python"

# 保存补充后的完整数据集
with open("swebench_lite_v2.json", "w", encoding="utf-8") as f:
    json.dump(dataset, f, ensure_ascii=False, indent=2)

# 创建单实例数据集（astropy__astropy-14182）
single = [ex for ex in dataset if ex['instance_id'] == 'astropy__astropy-14182']
with open("swebench_single_astropy.json", "w", encoding="utf-8") as f:
    json.dump(single, f, ensure_ascii=False, indent=2)

print(f"完整数据集: {len(dataset)} 实例，已保存到 swebench_lite_v2.json")
print(f"单实例数据集: {len(single)} 实例，已保存到 swebench_single_astropy.json")
print(f"\n单实例字段:")
for k in sorted(single[0].keys()):
    v = single[0][k]
    if isinstance(v, str) and len(v) > 80:
        print(f"  {k}: {v[:80]}...")
    elif isinstance(v, list):
        print(f"  {k}: list[{len(v)}]")
    else:
        print(f"  {k}: {v}")

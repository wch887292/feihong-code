#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从官方数据集生成本地 task_repo（swebench 5.0.2 格式）。"""
import json, os, yaml
from pathlib import Path

os.chdir(r"H:\Muse Code复刻\bench\real")

# 加载数据集
with open("swebench_lite_official_array.json", encoding="utf-8") as f:
    dataset = json.load(f)

# 创建 task_repo 目录
repo_root = Path(r"H:\Muse Code复刻\bench\real\task_repo")
tasks_dir = repo_root / "tasks"
tasks_dir.mkdir(parents=True, exist_ok=True)

# 创建 sweb.yaml
sweb_config = {
    "datasets": {
        "SWE-bench/SWE-bench_Lite": {
            "splits": ["test"],
            "description": "SWE-bench Lite - locally generated"
        }
    }
}
with open(repo_root / "sweb.yaml", "w", encoding="utf-8") as f:
    yaml.dump(sweb_config, f, allow_unicode=True, default_flow_style=False)

# 为每个实例创建任务目录（先只创建 astropy__astropy-14182 用于测试）
target_ids = ["astropy__astropy-14182"]

for ex in dataset:
    if ex['instance_id'] not in target_ids:
        continue

    iid = ex['instance_id']
    task_dir = tasks_dir / iid
    task_dir.mkdir(parents=True, exist_ok=True)

    # task.yaml
    task_meta = {
        "instance_id": iid,
        "repo": ex['repo'],
        "base_commit": ex['base_commit'],
        "environment_setup_commit": ex.get('environment_setup_commit', ''),
        "version": ex.get('version', ''),
        "split": "test",
    }
    with open(task_dir / "task.yaml", "w", encoding="utf-8") as f:
        yaml.dump(task_meta, f, allow_unicode=True, default_flow_style=False)

    # tests.json
    tests = {
        "FAIL_TO_PASS": ex.get('FAIL_TO_PASS', []),
        "PASS_TO_PASS": ex.get('PASS_TO_PASS', []),
    }
    with open(task_dir / "tests.json", "w", encoding="utf-8") as f:
        json.dump(tests, f, indent=2, ensure_ascii=False)

    # problem_statement.md
    with open(task_dir / "problem_statement.md", "w", encoding="utf-8") as f:
        f.write(ex.get('problem_statement', ''))

    # gold.patch
    with open(task_dir / "gold.patch", "w", encoding="utf-8", newline="") as f:
        f.write(ex.get('patch', ''))

    # test.patch
    with open(task_dir / "test.patch", "w", encoding="utf-8", newline="") as f:
        f.write(ex.get('test_patch', ''))

    # eval.sh
    eval_script = """#!/bin/bash
set -e
cd /testbed
# 应用测试补丁
git apply /test_patch.patch || true
# 运行测试
python -m pytest $FAIL_TO_PASS -x --timeout=300 || true
"""
    with open(task_dir / "eval.sh", "w", encoding="utf-8", newline="") as f:
        f.write(eval_script)

    # Dockerfile - 通用模板（基于 repo 类型选择基础镜像）
    repo = ex['repo']
    base_commit = ex['base_commit']

    if 'astropy' in repo:
        dockerfile = f"""FROM python:3.9-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /testbed
RUN git clone --depth 1 https://github.com/{repo}.git . || git clone https://github.com/{repo}.git .
RUN git fetch origin {base_commit} && git checkout {base_commit}
RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir numpy scipy pytest cython pytest-astropy
RUN pip install --no-cache-dir -e .
ENV PYTHONUNBUFFERED=1
"""
    else:
        dockerfile = f"""FROM python:3.9-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /testbed
RUN git clone https://github.com/{repo}.git .
RUN git fetch origin {base_commit} && git checkout {base_commit}
RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir pytest
RUN pip install --no-cache-dir -e . || true
ENV PYTHONUNBUFFERED=1
"""

    with open(task_dir / "Dockerfile", "w", encoding="utf-8", newline="") as f:
        f.write(dockerfile)

    print(f"已创建: {iid}")

print(f"\ntask_repo 创建完成: {repo_root}")
print(f"包含实例: {target_ids}")
